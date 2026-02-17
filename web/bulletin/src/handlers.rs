//! Request handlers — Lambda (production) and CLI stdin/stdout (dev).
//! Both share the same core logic via `generate_pdf_core`.

use std::env;
use std::io::{self, Read, Write};
use std::path::PathBuf;

use bulletin::pdf;

use crate::db::Database;
use crate::models::GeneratePdfRequest;
use crate::services;

// ──────────────────── Shared core logic ────────────────────────

/// Core PDF generation: parse request → fetch articles → build PDF → return bytes.
async fn generate_pdf_core(req: GeneratePdfRequest) -> Result<(Vec<u8>, String), String> {
    // Only connect to DB if we need articles
    let articles = if req.include_articles {
        let db = Database::new()
            .await
            .map_err(|e| format!("DB connection failed: {}", e))?;
        fetch_articles(&db, &req)
            .await
            .map_err(|e| format!("Failed to fetch articles: {}", e))?
    } else {
        vec![]
    };

    let fonts_dir: PathBuf = env::var("FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts"));

    let pdf_req = pdf::PdfRequest {
        sefer_name: req.sefer_name.clone(),
        perakim: req
            .perakim
            .iter()
            .map(|p| pdf::PdfPerekInput {
                perek_heb: p.perek_heb.clone(),
                header: p.header.clone(),
                pesukim: p.pesukim.clone(),
            })
            .collect(),
    };

    let doc = pdf::build_pdf(&pdf_req, &articles, &fonts_dir)
        .map_err(|e| format!("PDF generation failed: {}", e))?;

    let mut buf = Vec::new();
    doc.render(&mut buf)
        .map_err(|e| format!("PDF render failed: {}", e))?;

    let filename = build_filename(&req);

    tracing::info!(
        "Generated PDF: {} bytes, {} perakim",
        buf.len(),
        req.perakim.len()
    );

    Ok((buf, filename))
}

async fn fetch_articles(
    db: &Database,
    req: &GeneratePdfRequest,
) -> anyhow::Result<Vec<(String, String, String)>> {
    let mut articles: Vec<(String, String, String)> = Vec::new();

    if !req.include_articles {
        return Ok(articles);
    }

    for perek_input in &req.perakim {
        let mut perek_articles = services::get_articles_by_perek(db, perek_input.perek_id).await?;

        if !req.article_ids.is_empty() {
            perek_articles.retain(|a| req.article_ids.contains(&a.id));
        }
        if !req.author_ids.is_empty() {
            perek_articles.retain(|a| req.author_ids.contains(&(a.author_id as i32)));
        }

        for article in perek_articles {
            let author = services::get_author(db, article.author_id as i32).await?;
            articles.push((
                article.name.clone(),
                author.name.clone(),
                article.content.clone().unwrap_or_default(),
            ));
        }
    }

    Ok(articles)
}

fn build_filename(req: &GeneratePdfRequest) -> String {
    if req.perakim.is_empty() {
        return format!("{}.pdf", req.sefer_name);
    }
    let first = &req.perakim[0].perek_heb;
    let last = &req.perakim[req.perakim.len() - 1].perek_heb;
    if req.perakim.len() == 1 {
        format!("{}-{}׳.pdf", req.sefer_name, first)
    } else {
        format!("{}-{}׳-{}׳.pdf", req.sefer_name, first, last)
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
