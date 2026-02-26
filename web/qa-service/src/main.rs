//! QA service: RAG over perushim (Malbim + Or HaChaim) + articles.
//! Local-first: MySQL → in-memory chunks, keyword retrieval, no vector DB/ONNX in Phase 0.

use actix_web::{web, App, HttpServer};
use tracing::info;

mod config;
mod pipeline;
mod routes;

use config::{bind_address, db_url};
use pipeline::ingest;

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .connect(&db_url())
        .await?;
    info!("Connected to MySQL");

    let perushim = ingest::load_perush_chunks(&pool).await?;
    info!("Loaded {} perush chunks (Malbim + Or HaChaim)", perushim.len());

    let articles = ingest::load_article_chunks(&pool).await?;
    info!("Loaded {} article chunks", articles.len());

    let mut chunks: Vec<ingest::Chunk> = perushim;
    chunks.extend(articles);
    info!("Total {} chunks", chunks.len());

    let chunks = web::Data::new(chunks);

    let bind = bind_address();
    info!("Listening on http://{bind}");

    HttpServer::new(move || {
        App::new()
            .app_data(chunks.clone())
            .route("/health/ready", web::get().to(routes::health::ready))
            .route("/ask", web::post().to(routes::ask::ask))
            .route("/debug/stats", web::get().to(routes::debug::stats))
    })
    .bind(&bind)?
    .run()
    .await?;

    Ok(())
}
