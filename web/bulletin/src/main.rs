mod db;
mod handlers;
mod models;
mod services;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // If AWS_LAMBDA_RUNTIME_API is set, we're running inside Lambda.
    // Otherwise, start a local HTTP server for development.
    if std::env::var("AWS_LAMBDA_RUNTIME_API").is_ok() {
        tracing::info!("Running in Lambda mode");
        lambda_http::run(lambda_http::service_fn(handlers::lambda_handler))
            .await
            .map_err(|e| anyhow::anyhow!("Lambda runtime error: {}", e))?;
    } else {
        tracing::info!("Running in local HTTP server mode");
        run_local_server().await?;
    }

    Ok(())
}

/// Local HTTP server for development — mirrors the Lambda handler via Actix-web.
#[cfg(feature = "local")]
async fn run_local_server() -> anyhow::Result<()> {
    use actix_web::{web, App, HttpServer};
    use std::env;
    use std::path::PathBuf;

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = env::var("BULLETIN_PORT")
        .unwrap_or_else(|_| "9000".to_string())
        .parse()?;

    let fonts_dir: PathBuf = env::var("FONTS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts"));

    tracing::info!("Bulletin dev server on http://{}:{}", host, port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(fonts_dir.clone()))
            .app_data(web::JsonConfig::default().limit(10 * 1024 * 1024))
            .route(
                "/api/generate-pdf",
                web::post().to(handlers::actix_generate_pdf),
            )
            .route("/health", web::get().to(handlers::actix_health))
    })
    .bind(format!("{}:{}", host, port))?
    .run()
    .await?;

    Ok(())
}

/// Stub when running without the "local" feature — shouldn't happen in dev.
#[cfg(not(feature = "local"))]
async fn run_local_server() -> anyhow::Result<()> {
    anyhow::bail!(
        "Local server requires the 'local' feature. Run with: cargo run --features local"
    )
}
