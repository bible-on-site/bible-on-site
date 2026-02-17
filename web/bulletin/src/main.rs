mod db;
mod handlers;
mod models;
mod services;

use tracing_subscriber::EnvFilter;

/// Two modes:
/// 1. Lambda — when AWS_LAMBDA_RUNTIME_API is set (production)
/// 2. CLI    — read JSON request from stdin, write PDF bytes to stdout (dev)
///
/// The CLI mode is the on-demand equivalent of Lambda invocation.
/// The website spawns this binary as a subprocess per PDF request.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    if std::env::var("AWS_LAMBDA_RUNTIME_API").is_ok() {
        // Production: Lambda handler
        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .init();

        tracing::info!("Running in Lambda mode");
        lambda_http::run(lambda_http::service_fn(handlers::lambda_handler))
            .await
            .map_err(|e| anyhow::anyhow!("Lambda runtime error: {}", e))?;
    } else {
        // Dev: CLI mode — stdin → PDF → stdout
        // Logging goes to stderr so stdout stays clean for PDF bytes
        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .with_writer(std::io::stderr)
            .init();

        handlers::cli_handler().await?;
    }

    Ok(())
}
