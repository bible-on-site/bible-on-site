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

    // Create sand start the Actix application.
    let application = ActixApp::new().await?;
    let application_task = tokio::spawn(application.start_server());

    // Monitor the application's exit status.
    tokio::select! {
        outcome = application_task => report_exit("API", outcome),
    };
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
