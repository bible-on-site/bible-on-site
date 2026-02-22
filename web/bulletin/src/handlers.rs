//! Request handlers — Lambda (production) and CLI stdin/stdout (dev).
//! Both share the same core logic via `generate_pdf_core`.

use std::env;
use std::io::{self, Read, Write};
use std::path::PathBuf;

use bulletin::pdf;

use bulletin::tanach;

use crate::db::Database;
use crate::models::GeneratePdfRequest;
use crate::services;

// ──────────────────── Shared core logic ────────────────────────

/// Core PDF generation: resolve perek data → fetch articles per perek → build PDF → return bytes.
async fn generate_pdf_core(req: GeneratePdfRequest) -> Result<(Vec<u8>, String), String> {
    if req.perakim_ids.is_empty() {
        return Err("perakimIds must not be empty".into());
    }

    // Optionally connect to DB for articles
    let db = if req.include_articles {
        Some(
            Database::new()
                .await
                .map_err(|e| format!("DB connection failed: {}", e))?,
        )
    } else {
        None
    };

    // Resolve perek data from embedded Tanach text and attach articles per-perek
    let mut perakim: Vec<pdf::PdfPerekInput> = Vec::with_capacity(req.perakim_ids.len());
    for &id in &req.perakim_ids {
        let data = tanach::get_perek(id).ok_or_else(|| format!("Unknown perekId: {}", id))?;

        let articles = if let Some(ref db) = db {
            fetch_articles_for_perek(db, id, &req)
                .await
                .map_err(|e| format!("Failed to fetch articles: {}", e))?
        } else {
            vec![]
        };

        perakim.push(pdf::PdfPerekInput {
            perek_heb: tanach::perek_to_hebrew(data.perek_in_sefer),
            header: data.header.clone(),
            pesukim: data.pesukim.clone(),
            articles,
        });
    }

    // Derive sefer name from request or first perek's embedded data
    let sefer_name = req.sefer_name.clone().unwrap_or_else(|| {
        tanach::get_perek(req.perakim_ids[0])
            .map(|d| d.sefer_name.clone())
            .unwrap_or_default()
    });

    let fonts_dir: PathBuf = env::var("FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts"));

    let pdf_req = pdf::PdfRequest {
        sefer_name: sefer_name.clone(),
        perakim,
    };

    let buf = pdf::build_pdf(&pdf_req, &fonts_dir)
        .map_err(|e| format!("PDF generation failed: {}", e))?;

    let filename = build_filename(&sefer_name, &req.perakim_ids);

    tracing::info!(
        "Generated PDF: {} bytes, {} perakim",
        buf.len(),
        req.perakim_ids.len()
    );

    Ok((buf, filename))
}

/// Fetch articles for a single perek, applying optional filters.
async fn fetch_articles_for_perek(
    db: &Database,
    perek_id: i32,
    req: &GeneratePdfRequest,
) -> anyhow::Result<Vec<(String, String, String)>> {
    let mut perek_articles = services::get_articles_by_perek(db, perek_id).await?;

    if !req.article_ids.is_empty() {
        perek_articles.retain(|a| req.article_ids.contains(&a.id));
    }
    if !req.author_ids.is_empty() {
        perek_articles.retain(|a| req.author_ids.contains(&(a.author_id as i32)));
    }

    let mut articles = Vec::new();
    for article in perek_articles {
        let author = services::get_author(db, article.author_id as i32).await?;
        articles.push((
            article.name.clone(),
            author.name.clone(),
            article.content.clone().unwrap_or_default(),
        ));
    }

    Ok(articles)
}

fn build_filename(sefer_name: &str, perakim_ids: &[i32]) -> String {
    if perakim_ids.is_empty() {
        return format!("{}.pdf", sefer_name);
    }

    let first_heb = perakim_ids
        .first()
        .and_then(|&id| tanach::get_perek(id))
        .map(|d| tanach::perek_to_hebrew(d.perek_in_sefer))
        .unwrap_or_default();
    let last_heb = perakim_ids
        .last()
        .and_then(|&id| tanach::get_perek(id))
        .map(|d| tanach::perek_to_hebrew(d.perek_in_sefer))
        .unwrap_or_default();

    if perakim_ids.len() == 1 {
        format!("{}-{}.pdf", sefer_name, first_heb)
    } else {
        format!("{}-{}-{}.pdf", sefer_name, first_heb, last_heb)
    }
}

// ──────────────────── CLI handler (dev) ────────────────────────

/// Read JSON request from stdin, generate PDF, write bytes to stdout.
/// This is the on-demand equivalent of a Lambda invocation.
pub async fn cli_handler() -> anyhow::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;

    let req: GeneratePdfRequest = serde_json::from_str(&input)
        .map_err(|e| anyhow::anyhow!("Invalid request JSON: {}", e))?;

    match generate_pdf_core(req).await {
        Ok((buf, filename)) => {
            tracing::info!("Generated: {}", filename);
            io::stdout().write_all(&buf)?;
            io::stdout().flush()?;
            Ok(())
        }
        Err(e) => {
            anyhow::bail!("PDF generation failed: {}", e);
        }
    }
}

// ──────────────────── Lambda handler (production) ──────────────

use lambda_http::{Body, Request as LambdaRequest, Response as LambdaResponse};

/// Lambda handler — dispatches by path.
pub async fn lambda_handler(
    event: LambdaRequest,
) -> Result<LambdaResponse<Body>, lambda_http::Error> {
    let path = event.uri().path();

    match path {
        "/api/generate-pdf" => lambda_generate_pdf(event).await,
        "/health" => Ok(LambdaResponse::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(Body::Text(
                r#"{"status":"ok","service":"bulletin"}"#.into(),
            ))
            .unwrap()),
        _ => Ok(LambdaResponse::builder()
            .status(404)
            .header("content-type", "application/json")
            .body(Body::Text(r#"{"error":"not_found"}"#.into()))
            .unwrap()),
    }
}

async fn lambda_generate_pdf(
    event: LambdaRequest,
) -> Result<LambdaResponse<Body>, lambda_http::Error> {
    let body_str = match event.body() {
        Body::Text(s) => s.clone(),
        Body::Binary(b) => String::from_utf8_lossy(b).into_owned(),
        Body::Empty => {
            return Ok(LambdaResponse::builder()
                .status(400)
                .body(Body::Text(r#"{"error":"Missing request body"}"#.into()))
                .unwrap());
        }
    };

    let req: GeneratePdfRequest = match serde_json::from_str(&body_str) {
        Ok(r) => r,
        Err(e) => {
            return Ok(LambdaResponse::builder()
                .status(400)
                .body(Body::Text(format!(r#"{{"error":"{}"}}"#, e)))
                .unwrap());
        }
    };

    match generate_pdf_core(req).await {
        Ok((buf, filename)) => Ok(LambdaResponse::builder()
            .status(200)
            .header("content-type", "application/pdf")
            .header(
                "content-disposition",
                format!("attachment; filename=\"{}\"", filename),
            )
            .body(Body::Binary(buf))
            .unwrap()),
        Err(e) => Ok(LambdaResponse::builder()
            .status(500)
            .body(Body::Text(format!(r#"{{"error":"{}"}}"#, e)))
            .unwrap()),
    }
}
