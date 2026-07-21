use actix_web::{HttpRequest, HttpResponse, Result, web::Data};
use async_graphql::{
    EmptySubscription, MergedObject, Schema,
    http::{GraphQLPlaygroundConfig, playground_source},
};
use async_graphql_actix_web::{GraphQLRequest, GraphQLResponse};

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

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::Request;
    use sea_orm::{DatabaseBackend, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn article_model(id: i32, perek_id: i16, author_id: i16) -> entities::article::Model {
        entities::article::Model {
            id,
            perek_id,
            author_id,
            article_abstract: Some(format!("abstract-{id}")),
            name: format!("Article {id}"),
            priority: id as i8,
            content: Some(format!("content-{id}")),
        }
    }

    fn author_model(id: i32) -> entities::author::Model {
        entities::author::Model {
            id,
            name: format!("Author {id}"),
            details: format!("Details {id}"),
        }
    }

    fn perek_model(id: i32, perek_id: i32, sefer_id: i32) -> entities::perek::Model {
        entities::perek::Model {
            id,
            perek_id: Some(perek_id),
            sefer_id: Some(sefer_id),
            sefer_name: Some("Genesis".to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(1),
            perek_in_context: Some(1),
            date: None,
            hebdate: None,
            tseit: None,
            header: Some("Header".to_string()),
        }
    }

    fn revision_model(
        id: &str,
        entry_id: Option<&str>,
    ) -> entities::tanahpedia::entry_revision::Model {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        entities::tanahpedia::entry_revision::Model {
            id: id.to_string(),
            entry_id: entry_id.map(str::to_string),
            proposed_unique_name: Some("avraham".to_string()),
            proposed_title: Some("Avraham".to_string()),
            proposed_content: Some("<p>Body</p>".to_string()),
            source: "gpt-test".to_string(),
            notes: Some("review note".to_string()),
            status: "PENDING".to_string(),
            created_at: now,
            updated_at: now,
        }
    }

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    #[tokio::test]
    async fn schema_executes_article_resolver_queries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![article_model(7, 42, 3)]],
                )
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![article_model(8, 42, 3), article_model(9, 42, 4)]],
                )
                .into_connection(),
        );
        let schema = build_schema(&db);

        let by_id = schema
            .execute(Request::new(
                "{ articleById(id: 7) { id perekId authorId name articleContent } }",
            ))
            .await;
        assert!(by_id.errors.is_empty(), "{:?}", by_id.errors);
        let by_id_json = by_id.data.into_json().unwrap();
        assert_eq!(by_id_json["articleById"]["id"], 7);
        assert_eq!(by_id_json["articleById"]["articleContent"], "content-7");

        let by_perek = schema
            .execute(Request::new(
                "{ articlesByPerekId(perekId: 42) { id authorId name } }",
            ))
            .await;
        assert!(by_perek.errors.is_empty(), "{:?}", by_perek.errors);
        let by_perek_json = by_perek.data.into_json().unwrap();
        assert_eq!(by_perek_json["articlesByPerekId"][0]["id"], 8);
        assert_eq!(by_perek_json["articlesByPerekId"][1]["authorId"], 4);
    }

    #[tokio::test]
    async fn schema_executes_perek_resolver_queries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                    vec![perek_model(1, 1, 1)],
                ])
                .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                    vec![perek_model(2, 2, 1), perek_model(3, 3, 1)],
                ])
                .into_connection(),
        );
        let schema = build_schema(&db);

        let one = schema
            .execute(Request::new(
                "{ perekByPerekId(perekId: 1) { id perekId seferId compiledSource } }",
            ))
            .await;
        assert!(one.errors.is_empty(), "{:?}", one.errors);
        let one_json = one.data.into_json().unwrap();
        assert_eq!(one_json["perekByPerekId"]["perekId"], 1);
        assert_eq!(one_json["perekByPerekId"]["compiledSource"], "Genesis א'");

        let by_sefer = schema
            .execute(Request::new(
                "{ perakimBySeferId(seferId: 1) { id perekId header } }",
            ))
            .await;
        assert!(by_sefer.errors.is_empty(), "{:?}", by_sefer.errors);
        let by_sefer_json = by_sefer.data.into_json().unwrap();
        assert_eq!(
            by_sefer_json["perakimBySeferId"].as_array().unwrap().len(),
            2
        );
    }

    #[tokio::test]
    async fn schema_executes_starter_query_with_precomputed_author_counts() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::author::Model, Vec<entities::author::Model>, _>([
                    vec![author_model(3), author_model(4)],
                ])
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![article_model(1, 1, 3), article_model(2, 2, 4)]],
                )
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([("author_id", 3_i16.into()), ("count", 5_i64.into())]),
                        mock_row([("author_id", 4_i16.into()), ("count", 0_i64.into())]),
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([("perek_id", 1_i16.into()), ("count", 2_i64.into())]),
                        mock_row([("perek_id", 929_i16.into()), ("count", 7_i64.into())]),
                    ],
                ])
                .into_connection(),
        );
        let schema = build_schema(&db);

        let response = schema
            .execute(Request::new(
                "{ starter { authors { id name articlesCount } articles { id name } perekArticlesCounters } }",
            ))
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["starter"]["authors"][0]["articlesCount"], 5);
        assert_eq!(json["starter"]["authors"][1]["articlesCount"], 0);
        assert_eq!(json["starter"]["articles"][1]["id"], 2);
        assert_eq!(
            json["starter"]["perekArticlesCounters"]
                .as_array()
                .unwrap()
                .len(),
            929
        );
        assert_eq!(json["starter"]["perekArticlesCounters"][0], 2);
        assert_eq!(json["starter"]["perekArticlesCounters"][928], 7);
    }

    #[tokio::test]
    async fn schema_executes_tanahpedia_revision_query() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<
                    entities::tanahpedia::entry_revision::Model,
                    Vec<entities::tanahpedia::entry_revision::Model>,
                    _,
                >([vec![revision_model("rev-1", Some("entry-1"))]])
                .into_connection(),
        );
        let schema = build_schema(&db);

        let response = schema
            .execute(Request::new(
                r#"{ tanahpediaEntryRevisions(status: "PENDING", entryId: "entry-1") { id entryId proposedTitle source notes status createdAt } }"#,
            ))
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        let revision = &json["tanahpediaEntryRevisions"][0];
        assert_eq!(revision["id"], "rev-1");
        assert_eq!(revision["entryId"], "entry-1");
        assert_eq!(revision["proposedTitle"], "Avraham");
        assert_eq!(revision["source"], "gpt-test");
        assert_eq!(revision["status"], "PENDING");
    }

    #[tokio::test]
    async fn schema_rejects_revision_mutations_without_api_auth() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = build_schema(&db);

        let submit = schema
            .execute(
                Request::new(
                    r#"mutation { submitEntryRevision(input: { source: "gpt-test", proposedTitle: "Title" }) { id } }"#,
                )
                .data(crate::common::auth::ApiAuth::new(None)),
            )
            .await;
        assert!(!submit.errors.is_empty());

        let apply = schema
            .execute(
                Request::new(r#"mutation { applyEntryRevision(id: "rev-1") { id } }"#)
                    .data(crate::common::auth::ApiAuth::new(None)),
            )
            .await;
        assert!(!apply.errors.is_empty());
    }
}
