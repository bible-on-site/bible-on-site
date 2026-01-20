use std::{
    env, io,
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use actix_web::guard;
use actix_web::middleware::Compress;
use actix_web::{App, HttpServer, dev::Server, web};
use anyhow::Error;
use tracing_actix_web::TracingLogger;

use crate::providers::Database;

use super::schema_builder::{build_schema, graphql_playground, graphql_request};
use tokio::time::Duration;

pub struct ActixApp {
    server: Server,
    shutdown_signal: Arc<AtomicBool>,
}

impl ActixApp {
    pub async fn new() -> Result<Self, Error> {
        let profile: String = env::var("PROFILE").unwrap_or_else(|_| "prod".to_string());
        let env_file_name = if profile == "prod" {
            ".env".to_string()
        } else {
            format!(".{}.env", profile)
        };
        if let Err(e) = dotenvy::from_filename_override(env_file_name.clone()) {
            tracing::warn!("Failed to load {} file: {}", env_file_name, e);
            tracing::warn!("Using default environment variables");
        }

        let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "3003".to_string())
            .parse::<u16>()
            .unwrap_or(3003);
        let listener = TcpListener::bind(format!("{}:{}", &host, &port))?;
        let port = listener.local_addr().unwrap().port();
        let db: Database = Database::new().await?;
        let shutdown_signal = Arc::new(AtomicBool::new(false));
        let server = HttpServer::new({
            let shutdown_signal = shutdown_signal.clone();
            move || {
                App::new()
                    .wrap(Compress::default())
                    .wrap(TracingLogger::default())
                    .configure(Self::build_app_config(&db, shutdown_signal.clone()))
            }
        })
        .listen_auto_h2c(listener)?
        .run();
        tracing::info!("Server running on port {}", port);
        Ok(Self {
            server,
            shutdown_signal,
        })
    }

    pub async fn start_server(self) -> Result<(), io::Error> {
        let shutdown_signal = self.shutdown_signal.clone();
        let handle = self.server.handle();
        // Poll the shutdown flag and stop the server when it's true.
        tokio::spawn(async move {
            loop {
                if shutdown_signal.load(Ordering::SeqCst) {
                    handle.stop(true).await;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
        self.server.await
    }

    pub fn build_app_config(
        db: &Database,
        shutdown_signal: Arc<AtomicBool>,
    ) -> impl Fn(&mut web::ServiceConfig) {
        let db = db.clone();
        move |cfg: &mut web::ServiceConfig| {
            cfg.app_data(web::Data::new(build_schema(&db)))
                .service(
                    web::resource("/")
                        .guard(guard::Post())
                        .to(graphql_request),
                )
                .service(
                    web::resource("/")
                        .guard(guard::Get())
                        .to(graphql_playground),
                );

            if env::var("PROFILE").unwrap_or_default() != "prod" {
                cfg.service(web::resource("/api/shutdown").guard(guard::Post()).to({
                    let shutdown_signal = shutdown_signal.clone();
                    move || {
                        let shutdown_signal = shutdown_signal.clone();
                        async move {
                            tokio::spawn(async move {
                                // Optionally add a small timeout here if needed.
                                tokio::time::sleep(Duration::from_secs(1)).await;
                                shutdown_signal.store(true, Ordering::SeqCst);
                            });
                            "Shutting down..."
                        }
                    }
                }));
            }
        }
    }
}
