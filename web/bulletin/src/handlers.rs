//! Request handlers — Lambda (production) and Actix-web (local dev).
//! Both share the same core logic via `generate_pdf_core`.

use std::env;
use std::path::PathBuf;

use bulletin::pdf;

use crate::db::Database;
use crate::models::GeneratePdfRequest;
use crate::services;

// ──────────────────── Shared core logic ────────────────────────

/// Core PDF generation: parse request → fetch articles → build PDF → return bytes.
async fn generate_pdf_core(req: GeneratePdfRequest) -> Result<(Vec<u8>, String), String> {
    let db = Database::new()
        .await
        .map_err(|e| format!("DB connection failed: {}", e))?;

    let articles = fetch_articles(&db, &req)
        .await
        .map_err(|e| format!("Failed to fetch articles: {}", e))?;

    let fonts_dir: PathBuf = env::var("FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts"));

    // Convert HTTP model to PDF model
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

// ──────────────────── Lambda handler ───────────────────────────

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

// ──────────────────── Actix-web handlers (local dev) ───────────

#[cfg(feature = "local")]
pub async fn actix_generate_pdf(
    body: actix_web::web::Json<GeneratePdfRequest>,
) -> actix_web::HttpResponse {
    let req = body.into_inner();

    match generate_pdf_core(req).await {
        Ok((buf, filename)) => actix_web::HttpResponse::Ok()
            .content_type("application/pdf")
            .insert_header((
                "Content-Disposition",
                format!("attachment; filename=\"{}\"", filename),
            ))
            .body(buf),
        Err(e) => actix_web::HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": e})),
    }
}

#[cfg(feature = "local")]
pub async fn actix_health() -> actix_web::HttpResponse {
    actix_web::HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "bulletin",
        "mode": "local"
    }))
}
