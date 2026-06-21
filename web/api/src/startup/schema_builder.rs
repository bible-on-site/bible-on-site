use async_graphql::{EmptySubscription, MergedObject, Schema};

use crate::common::auth::ApiAuth;
use crate::providers::Database;
use crate::resolvers::articles_resolver;
use crate::resolvers::authors_resolver;
use crate::resolvers::perakim_resolver;
use crate::resolvers::sefarim_resolver;
use crate::resolvers::starter_resolver;
use crate::resolvers::tanahpedia_revisions_resolver;

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    articles_resolver::ArticlesQuery,
    authors_resolver::AuthorsQuery,
    perakim_resolver::PerakimQuery,
    sefarim_resolver::SefarimQuery,
    starter_resolver::StarterQuery,
    tanahpedia_revisions_resolver::TanahpediaRevisionsQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(tanahpedia_revisions_resolver::TanahpediaRevisionsMutation);

pub fn build_schema(database: &Database) -> Schema<QueryRoot, MutationRoot, EmptySubscription> {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(database.to_owned())
    .finish()
}

use actix_web::{HttpRequest, HttpResponse, Result, web::Data};
use async_graphql::{
    http::{GraphQLPlaygroundConfig, playground_source},
    // ...
};
use async_graphql_actix_web::{GraphQLRequest, GraphQLResponse};

// ...

/// Extracts a `Authorization: Bearer <token>` header value, if present.
fn extract_bearer(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get(actix_web::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

pub async fn graphql_request(
    schema: Data<Schema<QueryRoot, MutationRoot, EmptySubscription>>,
    req: HttpRequest,
    gql_req: GraphQLRequest,
) -> GraphQLResponse {
    let auth = ApiAuth::new(extract_bearer(&req));
    schema.execute(gql_req.into_inner().data(auth)).await.into()
}

pub async fn graphql_playground() -> Result<HttpResponse> {
    let source = playground_source(GraphQLPlaygroundConfig::new("/"));
    Ok(HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(source))
}
