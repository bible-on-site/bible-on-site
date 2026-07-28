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
use crate::resolvers::tanahpedia_family_resolver;
use crate::resolvers::tanahpedia_revisions_resolver;

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    articles_resolver::ArticlesQuery,
    authors_resolver::AuthorsQuery,
    perakim_resolver::PerakimQuery,
    sefarim_resolver::SefarimQuery,
    starter_resolver::StarterQuery,
    tanahpedia_family_resolver::TanahpediaFamilyQuery,
    tanahpedia_revisions_resolver::TanahpediaRevisionsQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    tanahpedia_family_resolver::TanahpediaFamilyMutation,
    tanahpedia_revisions_resolver::TanahpediaRevisionsMutation,
);

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
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
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
    async fn schema_executes_all_tanahpedia_family_resolvers() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = build_schema(&db);

        let response = schema
            .execute(
                Request::new(
                    r#"{
                        persons: tanahpediaFindPersons(name: " ") { personId }
                        entities: tanahpediaFindEntities(name: " ") { entityId }
                        sources: tanahpediaEntityTanahSources(entityId: " ") { citation }
                        unions: tanahpediaPersonUnions(personId: " ") { id }
                        parentChild: tanahpediaPersonParentChild(personId: " ") { id }
                        details: tanahpediaPersonDetails(personId: " ") { personId }
                    }"#,
                )
                .data(crate::common::auth::ApiAuth::with_revision_api_key(
                    Some("family-test-key".to_string()),
                    Some("family-test-key".to_string()),
                )),
            )
            .await;

        assert_eq!(response.errors.len(), 6, "{:?}", response.errors);
        assert!(
            response
                .errors
                .iter()
                .all(|error| error.message.contains("is required")),
            "{:?}",
            response.errors
        );
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

    #[tokio::test]
    async fn schema_rejects_family_mutations_without_api_auth() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = build_schema(&db);
        let operations = [
            r#"mutation { putTanahpediaEntryEntityLink(input: { id: "ee", entryUniqueName: "entry", entityId: "e" }) { id } }"#,
            r#"mutation { deleteTanahpediaEntryEntityLink(id: "ee") { id } }"#,
            r#"mutation { putTanahpediaPersonNode(input: { entityId: "e", personId: "p", displayName: "Name", sexId: "s", sex: "MALE" }) { personId } }"#,
            r#"mutation { deleteTanahpediaOrphanPersonNode(input: { entityId: "e", personId: "p", sexId: "s" }) { personId } }"#,
            r#"mutation { putTanahpediaParentChildLink(input: { id: "pc", parentPersonId: "p", childPersonId: "c", relationshipType: "BIOLOGICAL", parentRole: "FATHER" }) { id } }"#,
            r#"mutation { deleteTanahpediaParentChildLink(id: "pc") { id } }"#,
            r#"mutation { putTanahpediaPersonUnion(input: { id: "u", person1Id: "p1", person2Id: "p2", unionType: "MARRIAGE" }) { id } }"#,
            r#"mutation { deleteTanahpediaPersonUnion(id: "u") { id } }"#,
        ];

        for operation in operations {
            let response = schema
                .execute(Request::new(operation).data(crate::common::auth::ApiAuth::new(None)))
                .await;
            assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
            assert_eq!(response.errors[0].message, "Revision API is not configured");
        }
    }

    #[tokio::test]
    async fn schema_executes_authorized_entry_entity_link_mutation() {
        use entities::tanahpedia::{entity, entry, entry_entity};

        let now = chrono::Utc::now().naive_utc();
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry::Model {
                    id: "entry-1".to_string(),
                    unique_name: "שמשון".to_string(),
                    title: "שמשון".to_string(),
                    content: None,
                    created_at: now,
                    updated_at: now,
                }]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![
                    entity::Model {
                        id: "entity-1".to_string(),
                        entity_type: "PERSON".to_string(),
                        name: "שמשון".to_string(),
                        created_at: now,
                        updated_at: now,
                    },
                ]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .into_connection(),
        );
        let response = build_schema(&db)
            .execute(
                Request::new(
                    r#"mutation { putTanahpediaEntryEntityLink(input: { id: "entry-entity-1", entryUniqueName: "שמשון", entityId: "entity-1" }) { id entryId entityId } }"#,
                )
                .data(crate::common::auth::ApiAuth::with_revision_api_key(
                    Some("family-test-key".to_string()),
                    Some("family-test-key".to_string()),
                )),
            )
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.into_json().unwrap()["putTanahpediaEntryEntityLink"]["entryId"],
            "entry-1"
        );
    }

    #[tokio::test]
    async fn schema_executes_authorized_person_node_mutation() {
        let exec_result = MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::tanahpedia::entity::Model, Vec<entities::tanahpedia::entity::Model>, _>([vec![]])
                .append_query_results::<entities::tanahpedia::person::Model, Vec<entities::tanahpedia::person::Model>, _>([vec![]])
                .append_query_results::<entities::tanahpedia::person::Model, Vec<entities::tanahpedia::person::Model>, _>([vec![]])
                .append_query_results::<entities::tanahpedia::person_sex::Model, Vec<entities::tanahpedia::person_sex::Model>, _>([vec![]])
                .append_exec_results([
                    exec_result.clone(),
                    exec_result.clone(),
                    exec_result,
                ])
                .into_connection(),
        );
        let schema = build_schema(&db);
        let response = schema
            .execute(
                Request::new(
                    r#"mutation { putTanahpediaPersonNode(input: { entityId: "entity-1", personId: "person-1", displayName: "שמשון", sexId: "sex-1", sex: "MALE" }) { entityId personId sexId } }"#,
                )
                .data(crate::common::auth::ApiAuth::with_revision_api_key(
                    Some("family-test-key".to_string()),
                    Some("family-test-key".to_string()),
                )),
            )
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
    }

    #[tokio::test]
    async fn schema_executes_authorized_family_mutations() {
        use entities::tanahpedia::{
            lookup_parent_child_type, lookup_parent_role, lookup_union_type, person,
        };

        let person_model = |id: &str| person::Model {
            id: id.to_string(),
            entity_id: format!("entity-{id}"),
        };
        let exec_result = MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "parent",
                )]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "child",
                )]])
                .append_query_results::<lookup_parent_child_type::Model, Vec<lookup_parent_child_type::Model>, _>(
                    [vec![lookup_parent_child_type::Model {
                        id: "pct-biological".to_string(),
                        name: "BIOLOGICAL".to_string(),
                    }]],
                )
                .append_query_results::<lookup_parent_role::Model, Vec<lookup_parent_role::Model>, _>([vec![
                    lookup_parent_role::Model {
                        id: "pr-father".to_string(),
                        name: "FATHER".to_string(),
                    },
                ]])
                .append_exec_results([exec_result.clone()])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "person-1",
                )]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "person-2",
                )]])
                .append_query_results::<lookup_union_type::Model, Vec<lookup_union_type::Model>, _>([vec![
                    lookup_union_type::Model {
                        id: "ut-marriage".to_string(),
                        name: "MARRIAGE".to_string(),
                    },
                ]])
                .append_exec_results([exec_result.clone(), exec_result.clone(), exec_result])
                .into_connection(),
        );
        let schema = build_schema(&db);
        let auth = || {
            crate::common::auth::ApiAuth::with_revision_api_key(
                Some("family-test-key".to_string()),
                Some("family-test-key".to_string()),
            )
        };
        let operations = [
            r#"mutation { putTanahpediaParentChildLink(input: { id: "pc", parentPersonId: "parent", childPersonId: "child", relationshipType: "BIOLOGICAL", parentRole: "FATHER" }) { id } }"#,
            r#"mutation { putTanahpediaPersonUnion(input: { id: "u", person1Id: "person-1", person2Id: "person-2", unionType: "MARRIAGE" }) { id } }"#,
            r#"mutation { deleteTanahpediaParentChildLink(id: "pc") { id } }"#,
            r#"mutation { deleteTanahpediaPersonUnion(id: "u") { id } }"#,
        ];

        for operation in operations {
            let response = schema.execute(Request::new(operation).data(auth())).await;
            assert!(response.errors.is_empty(), "{:?}", response.errors);
        }
    }
}
