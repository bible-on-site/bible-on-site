//! QA service: embedding-based RAG over articles + all perushim.
//! INGEST → RETRIEVE (MiniLM cosine) → REASON (XLM-RoBERTa QA) → VALIDATE → SURFACE.
//!
//! Both articles and all perushim notes are in the RAG corpus.
//! When the QA pair generation pipeline (plan §4) is built, perushim notes
//! will additionally serve as training data for fine-tuning BEREL/ParshanBERT.

use std::path::PathBuf;
use std::time::Instant;

use actix_web::{web, App, HttpServer};
use tracing::info;

mod config;
mod models;
mod pipeline;
mod routes;

use config::{bind_address, db_url};
use models::embedder::Embedder;
use models::qa_model::QaModel;
use pipeline::ingest;

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let models_dir = PathBuf::from(
        std::env::var("MODELS_DIR").unwrap_or_else(|_| "models".to_string()),
    );

    info!("Loading embedding model...");
    let embedder = Embedder::load(&models_dir.join("embedder"))?;
    info!("Loading QA model...");
    let qa_model = QaModel::load(&models_dir.join("qa"))?;

    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .connect(&db_url())
        .await?;
    info!("Connected to MySQL");

    let perushim = ingest::load_perush_chunks(&pool).await?;
    info!("Loaded {} perush chunks (all parshanim)", perushim.len());

    let articles = ingest::load_article_chunks(&pool).await?;
    info!("Loaded {} article chunks", articles.len());

    let mut chunks: Vec<ingest::Chunk> = perushim;
    chunks.extend(articles);

    // Optional perek range filter for fast dev iterations (e.g. PEREK_RANGE=51-90 for Shemot)
    if let Ok(range) = std::env::var("PEREK_RANGE") {
        if let Some((lo, hi)) = range.split_once('-') {
            if let (Ok(lo), Ok(hi)) = (lo.parse::<i32>(), hi.parse::<i32>()) {
                let before = chunks.len();
                chunks.retain(|c| c.perek_id >= lo && c.perek_id <= hi);
                info!("PEREK_RANGE={range}: filtered {before} → {} chunks", chunks.len());
            }
        }
    }
    info!("Total {} chunks", chunks.len());

    info!("Embedding {} chunks...", chunks.len());
    let t0 = Instant::now();
    let texts: Vec<&str> = chunks.iter().map(|c| c.text.as_str()).collect();
    let embeddings = embedder.embed_passages_cached(&texts, 8)?;
    info!(
        "Embedded {} chunks in {:.1}s → [{}, {}] matrix",
        chunks.len(),
        t0.elapsed().as_secs_f64(),
        embeddings.nrows(),
        embeddings.ncols(),
    );

    let chunks = web::Data::new(chunks);
    let embeddings = web::Data::new(embeddings);
    let embedder = web::Data::new(embedder);
    let qa_model = web::Data::new(qa_model);

    let bind = bind_address();
    info!("Listening on http://{bind}");

    HttpServer::new(move || {
        App::new()
            .app_data(chunks.clone())
            .app_data(embeddings.clone())
            .app_data(embedder.clone())
            .app_data(qa_model.clone())
            .route("/health/ready", web::get().to(routes::health::ready))
            .route("/ask", web::post().to(routes::ask::ask))
            .route("/debug/stats", web::get().to(routes::debug::stats))
    })
    .bind(&bind)?
    .run()
    .await?;

    Ok(())
}
