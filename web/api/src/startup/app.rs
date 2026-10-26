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
use crate::services::article_search::{self, ArticleSearchIndex};

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
        // Explicit launch configuration (CI, containers, local DB overrides) takes precedence.
        if let Err(e) = dotenvy::from_filename(env_file_name.clone()) {
            tracing::warn!("Failed to load {} file: {}", env_file_name, e);
            tracing::warn!("Using default environment variables");
        }

        let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "3003".to_string())
            .parse::<u16>()
            .unwrap_or(3003);
        let listener = TcpListener::bind(format!("{}:{}", host, port))?;
        let port = listener.local_addr().unwrap().port();
        let db: Database = Database::new().await?;
        // Derived article-search index: loads its persisted snapshot, then a
        // background worker keeps it in sync with tanah_article via the queue
        // table and periodic hash reconcile.
        let article_index = ArticleSearchIndex::new(db.clone());
        tokio::spawn(article_search::run_worker(article_index.clone()));
        let shutdown_signal = Arc::new(AtomicBool::new(false));
        let server = HttpServer::new({
            let shutdown_signal = shutdown_signal.clone();
            let article_index = article_index.clone();
            move || {
                App::new()
                    .wrap(Compress::default())
                    .wrap(TracingLogger::default())
                    .configure(Self::build_app_config(
                        &db,
                        &article_index,
                        shutdown_signal.clone(),
                    ))
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
        article_index: &ArticleSearchIndex,
        shutdown_signal: Arc<AtomicBool>,
    ) -> impl Fn(&mut web::ServiceConfig) {
        let db = db.clone();
        let article_index = article_index.clone();
        move |cfg: &mut web::ServiceConfig| {
            cfg.app_data(web::Data::new(build_schema(&db, &article_index)))
                .service(web::resource("/").guard(guard::Post()).to(graphql_request))
                .service(
                    web::resource("/")
                        .guard(guard::Get())
                        .to(graphql_playground),
                )
                .service(
                    web::resource("/health")
                        .guard(guard::Any(guard::Get()).or(guard::Head()))
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

/// GET/HEAD /health — returns API status and version (embedded at compile time).
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
        http::{Method, StatusCode, header},
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
    async fn health_route_accepts_head_and_rejects_other_methods() {
        let db = mock_database();
        let article_index = ArticleSearchIndex::new(db.clone());
        let app = test::init_service(App::new().configure(ActixApp::build_app_config(
            &db,
            &article_index,
            Arc::new(AtomicBool::new(false)),
        )))
        .await;

        let response = test::call_service(
            &app,
            test::TestRequest::default()
                .method(Method::HEAD)
                .uri("/health")
                .to_request(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );

        for method in [
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
            Method::TRACE,
            Method::CONNECT,
        ] {
            let response = test::call_service(
                &app,
                test::TestRequest::default()
                    .method(method.clone())
                    .uri("/health")
                    .to_request(),
            )
            .await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method}");
        }
    }

    #[actix_web::test]
    async fn health_head_has_no_body_over_http() {
        let db = mock_database();
        let article_index = ArticleSearchIndex::new(db.clone());
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind health test listener");
        let address = listener.local_addr().expect("health test address");
        let server = HttpServer::new(move || {
            App::new().configure(ActixApp::build_app_config(
                &db,
                &article_index,
                Arc::new(AtomicBool::new(false)),
            ))
        })
        .workers(1)
        .disable_signals()
        .listen(listener)
        .expect("listen for health test")
        .run();
        let handle = server.handle();
        let server_task = actix_web::rt::spawn(server);
        let response = tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};

            let timeout = Duration::from_secs(5);
            let mut stream = std::net::TcpStream::connect_timeout(&address, timeout)?;
            stream.set_read_timeout(Some(timeout))?;
            stream.set_write_timeout(Some(timeout))?;
            stream.write_all(
                b"HEAD /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )?;
            let mut response = String::new();
            stream.read_to_string(&mut response)?;
            Ok::<_, io::Error>(response)
        })
        .await;
        handle.stop(true).await;
        server_task
            .await
            .expect("health server task")
            .expect("health server");
        let response = response
            .expect("health client task")
            .expect("health request");
        let (headers, body) = response.split_once("\r\n\r\n").expect("HTTP response");
        assert!(headers.starts_with("HTTP/1.1 200 OK"));
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("content-type: application/json")
        );
        assert!(body.is_empty(), "HEAD must not send the GET response body");
    }

    #[actix_web::test]
    async fn build_app_config_wires_health_playground_and_graphql_post() {
        let db = mock_database();
        let article_index = ArticleSearchIndex::new(db.clone());
        let shutdown_signal = Arc::new(AtomicBool::new(false));
        let app = test::init_service(App::new().configure(ActixApp::build_app_config(
            &db,
            &article_index,
            shutdown_signal,
        )))
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
