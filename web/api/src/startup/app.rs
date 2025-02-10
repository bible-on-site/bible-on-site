use std::{env, io, net::TcpListener};

use actix_web::guard;
use actix_web::{dev::Server, web, App, HttpServer};
use anyhow::Error;
use tracing_actix_web::TracingLogger;

use crate::providers::Database;

use super::schema_builder::{build_schema, graphql_playground, graphql_request};

pub struct ActixApp {
    server: Server,
}

impl ActixApp {
    pub async fn new() -> Result<Self, Error> {
        if let Err(e) = dotenvy::dotenv() {
            tracing::warn!("Failed to load .env file: {}", e);
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
        let server = HttpServer::new(move || {
            App::new()
                .wrap(TracingLogger::default())
                .configure(Self::build_app_config(&db))
        })
        .listen(listener)?
        .run();
        tracing::info!("Server running on port {}", port);
        Ok(Self { server })
    }

    pub async fn start_server(self) -> Result<(), io::Error> {
        self.server.await
    }

    pub fn build_app_config(db: &Database) -> impl Fn(&mut web::ServiceConfig) {
        let db = db.clone();
        move |cfg: &mut web::ServiceConfig| {
            cfg.app_data(web::Data::new(build_schema(&db)))
                .service(
                    web::resource("/api/graphql")
                        .guard(guard::Post())
                        .to(graphql_request),
                )
                .service(
                    web::resource("/api/graphql")
                        .guard(guard::Get())
                        .to(graphql_playground),
                );
        }
    }
}
