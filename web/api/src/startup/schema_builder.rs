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
use crate::resolvers::tanahpedia_entity_resolver;
use crate::resolvers::tanahpedia_entries_resolver;
use crate::resolvers::tanahpedia_family_resolver;
use crate::resolvers::tanahpedia_revisions_resolver;
use crate::services::article_search::ArticleSearchIndex;

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    articles_resolver::ArticlesQuery,
    authors_resolver::AuthorsQuery,
    perakim_resolver::PerakimQuery,
    sefarim_resolver::SefarimQuery,
    starter_resolver::StarterQuery,
    tanahpedia_entries_resolver::TanahpediaEntriesQuery,
    tanahpedia_entity_resolver::TanahpediaEntityQuery,
    tanahpedia_family_resolver::TanahpediaFamilyQuery,
    tanahpedia_revisions_resolver::TanahpediaRevisionsQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    tanahpedia_family_resolver::TanahpediaFamilyMutation,
    tanahpedia_revisions_resolver::TanahpediaRevisionsMutation,
);

pub fn build_schema(
    database: &Database,
    index: &ArticleSearchIndex,
) -> Schema<QueryRoot, MutationRoot, EmptySubscription> {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(database.to_owned())
    .data(index.to_owned())
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
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult, Value};
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
            coverage_verified: false,
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
            pasuk_count: Some(31),
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
            base_revision_id: None,
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

    fn article_metric_model(id: i32) -> entities::tanah_article_metric::Model {
        entities::tanah_article_metric::Model {
            article_id: id,
            word_count: Some(500),
            estimated_seconds: Some(137),
            words_per_minute: 220,
            calc_version: 1,
            source_hash: "c".repeat(64),
            computed_at: chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap(),
        }
    }

    #[tokio::test]
    async fn schema_executes_article_resolver_queries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![article_model(7, 42, 3)]],
                )
                // articleById metric attach
                .append_query_results::<
                    entities::tanah_article_metric::Model,
                    Vec<entities::tanah_article_metric::Model>,
                    _,
                >([vec![article_metric_model(7)]])
                // articleById progressUnits
                .append_query_results::<
                    entities::tanah_article_metric_block::Model,
                    Vec<entities::tanah_article_metric_block::Model>,
                    _,
                >([vec![
                    entities::tanah_article_metric_block::Model {
                        article_id: 7,
                        block_idx: 0,
                        word_count: 200,
                        cumulative_words: 200,
                        calc_version: 1,
                    },
                    entities::tanah_article_metric_block::Model {
                        article_id: 7,
                        block_idx: 1,
                        word_count: 300,
                        cumulative_words: 500,
                        calc_version: 1,
                    },
                ]])
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![article_model(8, 42, 3), article_model(9, 42, 4)]],
                )
                // articlesByPerekId metric attach
                .append_query_results::<
                    entities::tanah_article_metric::Model,
                    Vec<entities::tanah_article_metric::Model>,
                    _,
                >([vec![article_metric_model(9)]])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let by_id = schema
            .execute(Request::new(
                "{ articleById(id: 7) { id perekId authorId name articleContent readingMetric { wordCount estimatedSeconds wordsPerMinute calcVersion sourceHash } progressUnits { key wordCount cumulativeWords } } }",
            ))
            .await;
        assert!(by_id.errors.is_empty(), "{:?}", by_id.errors);
        let by_id_json = by_id.data.into_json().unwrap();
        assert_eq!(by_id_json["articleById"]["id"], 7);
        assert_eq!(by_id_json["articleById"]["articleContent"], "content-7");
        let metric = &by_id_json["articleById"]["readingMetric"];
        assert_eq!(metric["wordCount"], 500);
        assert_eq!(metric["estimatedSeconds"], 137);
        assert_eq!(metric["wordsPerMinute"], 220);
        assert_eq!(metric["calcVersion"], 1);
        let units = by_id_json["articleById"]["progressUnits"]
            .as_array()
            .unwrap();
        assert_eq!(units.len(), 2);
        assert_eq!(units[0]["key"], "0");
        assert_eq!(units[1]["cumulativeWords"], 500);

        let by_perek = schema
            .execute(Request::new(
                "{ articlesByPerekId(perekId: 42) { id authorId name readingMetric { wordCount } } }",
            ))
            .await;
        assert!(by_perek.errors.is_empty(), "{:?}", by_perek.errors);
        let by_perek_json = by_perek.data.into_json().unwrap();
        assert_eq!(by_perek_json["articlesByPerekId"][0]["id"], 8);
        assert_eq!(by_perek_json["articlesByPerekId"][1]["authorId"], 4);
        // Only article 9 has a metric row in the mock; article 8 degrades to null.
        assert!(by_perek_json["articlesByPerekId"][0]["readingMetric"].is_null());
        assert_eq!(
            by_perek_json["articlesByPerekId"][1]["readingMetric"]["wordCount"],
            500
        );
    }

    #[tokio::test]
    async fn schema_article_by_id_exposes_verified_covering_sources() {
        let mut verified_article = article_model(7, 42, 3);
        verified_article.coverage_verified = true;
        let created_at = chrono::NaiveDate::from_ymd_opt(2026, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>(
                    [vec![verified_article]],
                )
                // Metric attach — no rows means readingMetric resolves null.
                .append_query_results::<
                    entities::tanah_article_metric::Model,
                    Vec<entities::tanah_article_metric::Model>,
                    _,
                >([vec![]])
                .append_query_results::<
                    entities::article_covering_source::Model,
                    Vec<entities::article_covering_source::Model>,
                    _,
                >([vec![
                    entities::article_covering_source::Model {
                        article_id: 7,
                        perek_id: 42,
                        pasuk: 3,
                        created_at,
                    },
                    entities::article_covering_source::Model {
                        article_id: 7,
                        perek_id: 43,
                        pasuk: 1,
                        created_at,
                    },
                ]])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let response = schema
            .execute(Request::new(
                "{ articleById(id: 7) { id perekId coverageVerified coveringSources { perekId pasuk } } }",
            ))
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        let article = &json["articleById"];
        assert_eq!(article["coverageVerified"], true);
        assert_eq!(article["coveringSources"].as_array().unwrap().len(), 2);
        assert_eq!(article["coveringSources"][0]["perekId"], 42);
        assert_eq!(article["coveringSources"][0]["pasuk"], 3);
        assert_eq!(article["coveringSources"][1]["perekId"], 43);
    }

    #[tokio::test]
    async fn schema_executes_article_search_on_empty_index() {
        // No persisted state row → the snapshot stays empty and the query
        // resolves to an empty page rather than erroring.
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let response = schema
            .execute(Request::new(
                "{ searchArticles(phrase: \"בראשית\") { total hits { articleId name score excerpt } } }",
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["searchArticles"]["total"], 0);
        assert_eq!(json["searchArticles"]["hits"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn schema_article_search_serves_warm_snapshot_when_probe_fails() {
        // A failing state probe must not fail the query — the warm (here
        // empty) snapshot is served instead.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom("probe down".to_string())])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let response = schema
            .execute(Request::new(
                "{ searchArticles(phrase: \"בראשית\") { total } }",
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.into_json().unwrap()["searchArticles"]["total"],
            0
        );
    }

    #[tokio::test]
    async fn schema_article_search_rejects_invalid_arguments() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        for query in [
            "{ searchArticles(phrase: \"x\", limit: 0) { total } }",
            "{ searchArticles(phrase: \"x\", limit: 51) { total } }",
            "{ searchArticles(phrase: \"x\", offset: -1) { total } }",
            "{ searchArticles(phrase: \"x\", offset: 1001) { total } }",
        ] {
            let response = schema.execute(Request::new(query)).await;
            assert!(!response.errors.is_empty(), "{query} should fail");
        }
        let long_phrase = format!(
            "{{ searchArticles(phrase: \"{}\") {{ total }} }}",
            "א".repeat(257)
        );
        let response = schema.execute(Request::new(long_phrase)).await;
        assert!(!response.errors.is_empty());
    }

    #[tokio::test]
    async fn schema_executes_perek_resolver_queries() {
        let perek_metric = entities::tanah_perek_metric::Model {
            perek_id: 1,
            word_count: Some(361),
            estimated_seconds: Some(99),
            words_per_minute: 220,
            calc_version: 1,
            source_hash: "d".repeat(64),
            computed_at: chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap(),
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                    vec![perek_model(1, 1, 1)],
                ])
                // perekByPerekId metric attach
                .append_query_results::<
                    entities::tanah_perek_metric::Model,
                    Vec<entities::tanah_perek_metric::Model>,
                    _,
                >([vec![perek_metric]])
                // perekByPerekId progressUnits
                .append_query_results::<
                    entities::tanah_perek_pasuk_metric::Model,
                    Vec<entities::tanah_perek_pasuk_metric::Model>,
                    _,
                >([vec![
                    entities::tanah_perek_pasuk_metric::Model {
                        perek_id: 1,
                        pasuk: 1,
                        word_count: 7,
                        cumulative_words: 7,
                        calc_version: 1,
                    },
                    entities::tanah_perek_pasuk_metric::Model {
                        perek_id: 1,
                        pasuk: 2,
                        word_count: 11,
                        cumulative_words: 18,
                        calc_version: 1,
                    },
                ]])
                .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                    vec![perek_model(2, 2, 1), perek_model(3, 3, 1)],
                ])
                // perakimBySeferId metric attach — no rows
                .append_query_results::<
                    entities::tanah_perek_metric::Model,
                    Vec<entities::tanah_perek_metric::Model>,
                    _,
                >([vec![]])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let one = schema
            .execute(Request::new(
                "{ perekByPerekId(perekId: 1) { id perekId seferId compiledSource readingMetric { wordCount estimatedSeconds } progressUnits { key wordCount cumulativeWords } } }",
            ))
            .await;
        assert!(one.errors.is_empty(), "{:?}", one.errors);
        let one_json = one.data.into_json().unwrap();
        assert_eq!(one_json["perekByPerekId"]["perekId"], 1);
        assert_eq!(one_json["perekByPerekId"]["compiledSource"], "Genesis א'");
        assert_eq!(
            one_json["perekByPerekId"]["readingMetric"]["wordCount"],
            361
        );
        let units = one_json["perekByPerekId"]["progressUnits"]
            .as_array()
            .unwrap();
        assert_eq!(units.len(), 2);
        assert_eq!(units[0]["key"], "1");
        assert_eq!(units[1]["cumulativeWords"], 18);

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
                // Starter article metric attach — one batched IN query.
                .append_query_results::<
                    entities::tanah_article_metric::Model,
                    Vec<entities::tanah_article_metric::Model>,
                    _,
                >([vec![article_metric_model(2)]])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

        let response = schema
            .execute(Request::new(
                "{ starter { authors { id name articlesCount } articles { id name readingMetric { wordCount estimatedSeconds } } perekArticlesCounters } }",
            ))
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["starter"]["authors"][0]["articlesCount"], 5);
        assert_eq!(json["starter"]["authors"][1]["articlesCount"], 0);
        assert_eq!(json["starter"]["articles"][1]["id"], 2);
        // Only article 2 has a metric row in the mock; article 1 → null.
        assert!(json["starter"]["articles"][0]["readingMetric"].is_null());
        assert_eq!(
            json["starter"]["articles"][1]["readingMetric"]["wordCount"],
            500
        );
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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));

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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));
        let operations = [
            r#"mutation { putTanahpediaEntryEntityLink(input: { id: "ee", entryUniqueName: "entry", entityId: "e" }) { id } }"#,
            r#"mutation { deleteTanahpediaEntryEntityLink(id: "ee") { id } }"#,
            r#"mutation { putTanahpediaPersonNode(input: { entityId: "e", personId: "p", displayName: "Name", sexId: "s", sex: "MALE" }) { personId } }"#,
            r#"mutation { deleteTanahpediaOrphanPersonNode(input: { entityId: "e", personId: "p", sexId: "s" }) { personId } }"#,
            r#"mutation { deleteTanahpediaOrphanEntity(input: { entityId: "e", entityType: "PERSON", displayName: "Name" }) { entityId } }"#,
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
        let response = build_schema(&db, &ArticleSearchIndex::new(db.clone()))
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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));
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
    async fn schema_executes_authorized_family_cleanup_mutations() {
        use entities::tanahpedia::{entity, entry_entity, person, person_sex};

        let now = chrono::Utc::now().naive_utc();
        let exec_result = MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    entry_entity::Model {
                        id: "entry-entity-1".to_string(),
                        entry_id: "entry-1".to_string(),
                        entity_id: "entity-duplicate".to_string(),
                    },
                ]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![
                    entity::Model {
                        id: "entity-duplicate".to_string(),
                        entity_type: "PERSON".to_string(),
                        name: "שמשון".to_string(),
                        created_at: now,
                        updated_at: now,
                    },
                ]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![
                    person::Model {
                        id: "person-duplicate".to_string(),
                        entity_id: "entity-duplicate".to_string(),
                    },
                ]])
                .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![
                    person_sex::Model {
                        id: "sex-duplicate".to_string(),
                        person_id: "person-duplicate".to_string(),
                        sex: "MALE".to_string(),
                        alt_group_id: None,
                    },
                ]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![BTreeMap::from([(
                        "dependency_count".to_string(),
                        0_i64.into(),
                    )])],
                ])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![
                    entity::Model {
                        id: "entity-duplicate".to_string(),
                        entity_type: "PERSON".to_string(),
                        name: "שמשון".to_string(),
                        created_at: now,
                        updated_at: now,
                    },
                ]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![BTreeMap::from([(
                        "dependency_count".to_string(),
                        0_i64.into(),
                    )])],
                ])
                .append_exec_results([
                    exec_result.clone(),
                    exec_result.clone(),
                    exec_result.clone(),
                    exec_result,
                ])
                .into_connection(),
        );
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));
        let auth = || {
            crate::common::auth::ApiAuth::with_revision_api_key(
                Some("family-test-key".to_string()),
                Some("family-test-key".to_string()),
            )
        };

        let delete_link = schema
            .execute(
                Request::new(
                    r#"mutation { deleteTanahpediaEntryEntityLink(id: "entry-entity-1") { id entryId entityId } }"#,
                )
                .data(auth()),
            )
            .await;
        assert!(delete_link.errors.is_empty(), "{:?}", delete_link.errors);

        let delete_person = schema
            .execute(
                Request::new(
                    r#"mutation { deleteTanahpediaOrphanPersonNode(input: { entityId: "entity-duplicate", personId: "person-duplicate", sexId: "sex-duplicate" }) { entityId personId sexId } }"#,
                )
                .data(auth()),
            )
            .await;
        assert!(
            delete_person.errors.is_empty(),
            "{:?}",
            delete_person.errors
        );

        let delete_entity = schema
            .execute(
                Request::new(
                    r#"mutation { deleteTanahpediaOrphanEntity(input: { entityId: "entity-duplicate", entityType: "PERSON", displayName: "שמשון" }) { entityId entityType displayName } }"#,
                )
                .data(auth()),
            )
            .await;
        assert!(
            delete_entity.errors.is_empty(),
            "{:?}",
            delete_entity.errors
        );
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
        let schema = build_schema(&db, &ArticleSearchIndex::new(db.clone()));
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
