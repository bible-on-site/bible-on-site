// Bible on Site API Server
mod common;
mod dtos;
mod providers;
mod resolvers;
mod services;
mod startup;

use crate::startup::{ActixApp, Telemetry};
use std::fmt::{Debug, Display};
use tokio::task::JoinError;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize telemetry for structured logging.
    let subscriber = Telemetry::get_subscriber("api", "info"); // Customize the application name and log level as needed.
    Telemetry::init_subscriber(subscriber);

    // One-shot maintenance mode: rebuild the derived article-search index from
    // the authoritative tables and exit. Used for first backfill and for
    // operator-triggered rebuilds (`cargo make rebuild-article-search` sets
    // REBUILD_ARTICLE_SEARCH=1 — an env flag, not a CLI arg, so operators do not
    // depend on mutable process argv).
    if std::env::var("REBUILD_ARTICLE_SEARCH").ok().as_deref() == Some("1") {
        return rebuild_article_search_index().await;
    }

    // Create sand start the Actix application.
    let application = ActixApp::new().await?;
    let application_task = tokio::spawn(application.start_server());

    // Monitor the application's exit status.
    tokio::select! {
        outcome = application_task => report_exit("API", outcome),
    };
    Ok(())
}

/// Rebuilds the article-search index from `tanah_article` and exits.
/// Mirrors `ActixApp`'s env loading so PROFILE-targeted env files apply.
async fn rebuild_article_search_index() -> anyhow::Result<()> {
    let profile: String = std::env::var("PROFILE").unwrap_or_else(|_| "prod".to_string());
    let env_file = if profile == "prod" {
        ".env".to_string()
    } else {
        format!(".{}.env", profile)
    };
    if let Err(e) = dotenvy::from_filename(&env_file) {
        tracing::warn!("Failed to load {} file: {}", env_file, e);
    }
    let db = crate::providers::Database::new().await?;
    let conn = db.get_connection();
    services::article_search::store::ensure_schema(conn).await?;
    match services::article_search::retrain(conn).await? {
        Some(docs) => {
            tracing::info!(docs, "article search index rebuilt");
            println!("Rebuilt article search index over {docs} articles");
        }
        None => {
            anyhow::bail!("another API instance holds the article-search retrain lock");
        }
    }
    Ok(())
}

// Helper function to log the outcome of the application task.
fn report_exit(task_name: &str, outcome: Result<Result<(), impl Debug + Display>, JoinError>) {
    match outcome {
        Ok(Ok(())) => {
            tracing::info!("{} has exited", task_name)
        }
        Ok(Err(e)) => {
            tracing::error!(
                error.cause_chain = ?e,
                error.message = %e,
                "{} failed",
                task_name
            )
        }
        Err(e) => {
            tracing::error!(
                error.cause_chain = ?e,
                error.message = %e,
                "{}' task failed to complete",
                task_name
            )
        }
    }
}
