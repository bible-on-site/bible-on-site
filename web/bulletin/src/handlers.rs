//! HTTP handlers for the bulletin service.

use actix_web::{web, HttpResponse};
use std::path::PathBuf;

use crate::db::Database;
use crate::models::GeneratePdfRequest;
use crate::pdf;
use crate::services;

/// POST /api/generate-pdf
///
/// Accepts a JSON body describing the perakim to include, fetches articles
/// from the DB, generates a PDF, and returns it as `application/pdf`.
pub async fn generate_pdf(
    body: web::Json<GeneratePdfRequest>,
    db: web::Data<Database>,
    fonts_dir: web::Data<PathBuf>,
) -> actix_web::Result<HttpResponse> {
    let req = body.into_inner();

    // Fetch articles for the requested perakim (from DB — shared layer)
    let mut articles: Vec<(String, String, String)> = Vec::new();

    if req.include_articles {
        for perek_input in &req.perakim {
            let mut perek_articles = services::get_articles_by_perek(&db, perek_input.perek_id)
                .await
                .map_err(actix_web::error::ErrorInternalServerError)?;

            // Filter by article_ids if specified
            if !req.article_ids.is_empty() {
                perek_articles.retain(|a| req.article_ids.contains(&a.id));
            }

            // Filter by author_ids if specified
            if !req.author_ids.is_empty() {
                perek_articles.retain(|a| req.author_ids.contains(&(a.author_id as i32)));
            }

            for article in perek_articles {
                let author = services::get_author(&db, article.author_id as i32)
                    .await
                    .map_err(actix_web::error::ErrorInternalServerError)?;

                articles.push((
                    article.name.clone(),
                    author.name.clone(),
                    article.content.clone().unwrap_or_default(),
                ));
            }
        }
    }

    // Generate PDF
    let doc = pdf::build_pdf(&req, &articles, &fonts_dir)
        .map_err(actix_web::error::ErrorInternalServerError)?;

    // Render to bytes
    let mut buf = Vec::new();
    doc.render(&mut buf)
        .map_err(actix_web::error::ErrorInternalServerError)?;

    // Build filename
    let filename = build_filename(&req);

    Ok(HttpResponse::Ok()
        .content_type("application/pdf")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"{}\"", filename),
        ))
        .body(buf))
}

/// GET /health
pub async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "bulletin"
    }))
}

/// Build a Hebrew filename like "במדבר-א'-ג'.pdf"
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
