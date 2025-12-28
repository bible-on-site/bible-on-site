use async_graphql::{EmptyMutation, EmptySubscription, MergedObject, Schema};

use crate::providers::Database;
use crate::resolvers::articles_resolver;
use crate::resolvers::authors_resolver;
use crate::resolvers::perakim_resolver;
use crate::resolvers::sefarim_resolver;
use crate::resolvers::starter_resolver;

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    articles_resolver::ArticlesQuery,
    authors_resolver::AuthorsQuery,
    perakim_resolver::PerakimQuery,
    sefarim_resolver::SefarimQuery,
    starter_resolver::StarterQuery,
);

pub fn build_schema(database: &Database) -> Schema<QueryRoot, EmptyMutation, EmptySubscription> {
    Schema::build(QueryRoot::default(), EmptyMutation, EmptySubscription)
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

pub async fn graphql_request(
    schema: Data<Schema<QueryRoot, EmptyMutation, EmptySubscription>>,
    _req: HttpRequest,
    gql_req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(gql_req.into_inner()).await.into()
}

pub async fn graphql_playground() -> Result<HttpResponse> {
    let source = playground_source(GraphQLPlaygroundConfig::new("/api/graphql"));
    Ok(HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(source))
}
