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
use actix_web::{App, HttpResponse, HttpServer, dev::Server, web};
use anyhow::Error;
use serde::Serialize;
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
                .service(web::resource("/").guard(guard::Post()).to(graphql_request))
                .service(
                    web::resource("/")
                        .guard(guard::Get())
                        .to(graphql_playground),
                )
                .service(
                    web::resource("/health")
                        .guard(guard::Get())
                        .to(health_check),
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

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// GET /health — returns API status and version (embedded at compile time).
/// Used by ECS health checks and for version introspection.
async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{
        App,
        body::to_bytes,
        http::{StatusCode, header},
        test,
    };
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn mock_database() -> Database {
        Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![]],
                )
                .into_connection(),
        )
    }

    #[actix_web::test]
    async fn health_check_returns_status_and_version() {
        let response = health_check().await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body())
            .await
            .expect("health body should be readable");
        let body = std::str::from_utf8(&body).expect("health body should be utf8");
        assert!(body.contains(r#""status":"ok""#));
        assert!(body.contains(env!("CARGO_PKG_VERSION")));
    }

    #[actix_web::test]
    async fn build_app_config_wires_health_playground_and_graphql_post() {
        let db = mock_database();
        let shutdown_signal = Arc::new(AtomicBool::new(false));
        let app = test::init_service(
            App::new().configure(ActixApp::build_app_config(&db, shutdown_signal)),
        )
        .await;

        let health_response =
            test::call_service(&app, test::TestRequest::get().uri("/health").to_request()).await;
        assert_eq!(health_response.status(), StatusCode::OK);

        let playground_response =
            test::call_service(&app, test::TestRequest::get().uri("/").to_request()).await;
        assert_eq!(playground_response.status(), StatusCode::OK);
        assert_eq!(
            playground_response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/html; charset=utf-8")
        );

        let graphql_response = test::call_service(
            &app,
            test::TestRequest::post()
                .uri("/")
                .insert_header((header::CONTENT_TYPE, "application/json"))
                .set_payload(r#"{"query":"{ __typename }"}"#)
                .to_request(),
        )
        .await;
        assert_eq!(graphql_response.status(), StatusCode::OK);
    }
}
