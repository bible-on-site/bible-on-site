use actix_web::{guard, web, App, HttpResponse, HttpServer, Responder};
use async_graphql::http::GraphQLPlaygroundConfig;
use async_graphql_actix_web::{GraphQLRequest, GraphQLResponse};
use dotenv::dotenv;
use sqlx::MySqlPool;
use std::env;

mod schema;
use schema::{create_schema, AppSchema};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    let db_user = env::var("DB_USER").expect("DB_USER must be set");
    let db_pass = env::var("DB_PASS").expect("DB_PASS must be set");
    let options = sqlx::mysql::MySqlConnectOptions::new()
        .username(&db_user)
        .password(&db_pass)
        .database("tanah")
        .port(3306)
        .host("localhost");
    let pool = MySqlPool::connect_with(options)
        .await
        .expect("Failed to connect to MySQL");

    let schema: AppSchema = create_schema(pool);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(schema.clone()))
            .service(
                web::resource("/graphql")
                    .guard(guard::Post())
                    .to(graphql_handler),
            )
            .service(web::resource("/").guard(guard::Get()).to(playground))
    })
    .bind("127.0.0.1:8000")?
    .run()
    .await
}

async fn graphql_handler(schema: web::Data<AppSchema>, req: GraphQLRequest) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

async fn playground() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(async_graphql::http::playground_source(
            GraphQLPlaygroundConfig::new("/graphql"),
        ))
}
