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
    // the flag).
    if rebuild_requested(std::env::var("REBUILD_ARTICLE_SEARCH").ok().as_deref()) {
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

/// `REBUILD_ARTICLE_SEARCH=1` — an env flag, not a CLI arg, so operators do
/// not depend on mutable process argv.
fn rebuild_requested(value: Option<&str>) -> bool {
    value == Some("1")
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
    rebuild_article_search_on(db.get_connection()).await
}

/// Schema ensure + full retrain over an already-open connection.
async fn rebuild_article_search_on(conn: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    #[test]
    fn rebuild_requested_accepts_only_the_enabled_flag() {
        assert!(rebuild_requested(Some("1")));
        assert!(!rebuild_requested(Some("0")));
        assert!(!rebuild_requested(Some("true")));
        assert!(!rebuild_requested(None));
    }

    #[tokio::test]
    async fn rebuild_on_retrains_over_the_connection() {
        // ensure_schema execs, then retrain: lock acquire + one-article corpus
        // + doc upsert + state save + epoch stamp + lock release.
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                7
            ])
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("acquired", 1_i64.into())])],
                vec![mock_row([
                    ("id", 1_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", "beta".into()),
                ])],
            ])
            .into_connection();
        rebuild_article_search_on(&conn)
            .await
            .expect("rebuild should succeed");
    }

    #[tokio::test]
    async fn rebuild_on_fails_when_the_retrain_lock_is_held() {
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                3
            ])
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("acquired", 0_i64.into())])],
            ])
            .into_connection();
        let err = rebuild_article_search_on(&conn)
            .await
            .expect_err("lock contention must fail");
        assert!(err.to_string().contains("retrain lock"));
    }
}
