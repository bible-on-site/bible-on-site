mod db;
mod handlers;
mod models;
mod pdf;
mod services;

use std::env;
use std::path::PathBuf;

use actix_web::{web, App, HttpServer};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env (same convention as API)
    dotenvy::dotenv().ok();

    // Structured logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = env::var("BULLETIN_PORT")
        .unwrap_or_else(|_| "3004".to_string())
        .parse()?;

    // Database connection (shared layer from API)
    let database = db::Database::new().await?;

    // Fonts directory — resolve relative to the binary or from env
    let fonts_dir: PathBuf = env::var("FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
        });

    tracing::info!("Starting bulletin service on {}:{}", host, port);
    tracing::info!("Fonts directory: {}", fonts_dir.display());

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(database.clone()))
            .app_data(web::Data::new(fonts_dir.clone()))
            .app_data(web::JsonConfig::default().limit(10 * 1024 * 1024)) // 10 MB
            .route("/api/generate-pdf", web::post().to(handlers::generate_pdf))
            .route("/health", web::get().to(handlers::health_check))
    })
    .bind(format!("{}:{}", host, port))?
    .run()
    .await?;

    Ok(())
}
