use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::common::website_revalidate::WebsiteRevalidator;
use crate::dtos::article_relationships::{
    ArticleRelationshipCapability, ArticleRelationshipContract, ArticleRelationshipTarget,
    ArticleRelationshipTargetKind, ArticleRelationships, UpdateArticleRelationshipsInput,
    UpdateArticleRelationshipsResult,
};
use crate::providers::Database;
use crate::services::article_relationships_service::{self, RegistryEntry, UpdateOutcome};

/// One catalogue entry → its GraphQL capability shape.
impl From<&RegistryEntry> for ArticleRelationshipCapability {
    fn from(entry: &RegistryEntry) -> Self {
        Self {
            key: entry.key.clone(),
            label: entry.label.clone(),
            meaning: entry.meaning.clone(),
            target_kind: entry.target_kind.clone(),
            cardinality: entry.cardinality.clone(),
            link_metadata: entry.link_metadata.clone(),
            ownership: entry.ownership.clone(),
            permission: entry.permission.clone(),
            operations: entry.operations.clone(),
            write_contract: entry.write_contract.clone(),
            read_contract: entry.read_contract.clone(),
            invalidates: entry.invalidates.clone(),
            status: entry.status.clone(),
            pending_issue: entry.pending_issue.map(|issue| issue as i32),
        }
    }
}

#[derive(Default)]
pub struct ArticleRelationshipsQuery;

#[Object]
impl ArticleRelationshipsQuery {
    /// The typed relationship catalogue — every DB-supported article
    /// relationship with its cardinality, editable metadata, write contract,
    /// permission scope and status (#3102). This is the contract the admin
    /// and the LLM proposal pipeline (#3103) program against.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn article_relationship_capabilities(
        &self,
        ctx: &Context<'_>,
    ) -> Result<ArticleRelationshipContract> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        Ok(ArticleRelationshipContract {
            contract_version: article_relationships_service::contract_version(),
            capabilities: article_relationships_service::relationship_registry()
                .iter()
                .map(ArticleRelationshipCapability::from)
                .collect(),
        })
    }

    /// The article's current relationship state — links with stable ids and
    /// the freshness tokens (`contentHash`) the mutation expects back.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn article_relationships(
        &self,
        ctx: &Context<'_>,
        article_id: i32,
    ) -> Result<ArticleRelationships> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        Ok(
            article_relationships_service::load_relationships(ctx.data::<Database>()?, article_id)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }

    /// Human-readable target lookup for pickers — search perakim, authors
    /// or dedications by label substring; returns validated candidates the
    /// write contract accepts, never raw ids.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn article_relationship_targets(
        &self,
        ctx: &Context<'_>,
        kind: ArticleRelationshipTargetKind,
        query: Option<String>,
        limit: Option<i32>,
    ) -> Result<Vec<ArticleRelationshipTarget>> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        Ok(article_relationships_service::search_targets(
            ctx.data::<Database>()?,
            kind,
            query.as_deref().unwrap_or(""),
            limit,
        )
        .await
        .map_err(|e| e.extend())?
        .into_iter()
        .map(|hit| ArticleRelationshipTarget {
            kind,
            id: hit.id,
            label: hit.label,
            hint: hit.hint,
        })
        .collect())
    }
}

#[derive(Default)]
pub struct ArticleRelationshipsMutation;

#[Object]
impl ArticleRelationshipsMutation {
    /// Replaces/updates the article's managed relationships in one
    /// transaction: `perekId`/`authorId` single-valued replacements and/or
    /// the `coveringSources` + `coverageVerified` set. Omitted fields keep
    /// their stored state; an explicit empty covering list clears it.
    /// Freshness guards (`expectedContentHash`, `expectedCoveringSources`)
    /// reject stale edits so a newer link is never overwritten by an unseen
    /// one. `previous` in the result is the supported undo record.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn update_article_relationships(
        &self,
        ctx: &Context<'_>,
        article_id: i32,
        input: UpdateArticleRelationshipsInput,
    ) -> Result<UpdateArticleRelationshipsResult> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        let UpdateOutcome {
            relationships,
            previous,
            revalidation,
        } = article_relationships_service::update_relationships(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            article_id,
            input,
        )
        .await
        .map_err(|e| e.extend())?;
        Ok(UpdateArticleRelationshipsResult {
            relationships,
            previous,
            revalidation: revalidation.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Request, Schema, Value};
    use sea_orm::{DatabaseBackend, MockDatabase, Value as DbValue};
    use std::collections::BTreeMap;

    fn auth(token: Option<&str>) -> ApiAuth {
        ApiAuth::with_article_api_key(token.map(str::to_owned), Some("article-key".into()))
    }

    fn schema(
        db: Database,
    ) -> Schema<ArticleRelationshipsQuery, ArticleRelationshipsMutation, EmptySubscription> {
        Schema::build(
            ArticleRelationshipsQuery,
            ArticleRelationshipsMutation,
            EmptySubscription,
        )
        .data(db)
        .finish()
    }

    fn article_model(id: i32) -> entities::article::Model {
        entities::article::Model {
            id,
            perek_id: 1,
            author_id: 2,
            article_abstract: None,
            name: format!("article-{id}"),
            priority: 1,
            content: Some("content".to_string()),
            coverage_verified: true,
        }
    }

    fn hash_row(hash: &str) -> BTreeMap<String, DbValue> {
        [("h".to_string(), hash.to_string().into())]
            .into_iter()
            .collect()
    }

    /// The queries of `load_relationships` for a fixture article with one
    /// covering row, one dedication link and one mention annotation.
    fn relationships_mock() -> MockDatabase {
        let expiry =
            chrono::NaiveDateTime::parse_from_str("2030-01-02 03:04:05", "%Y-%m-%d %H:%M:%S")
                .unwrap();
        MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::article::Model, Vec<_>, _>([vec![article_model(7)]])
            .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
            .append_query_results::<entities::article_covering_source::Model, Vec<_>, _>([vec![
                entities::article_covering_source::Model {
                    article_id: 7,
                    perek_id: 1,
                    pasuk: 3,
                    created_at: chrono::Utc::now(),
                },
            ]])
            .append_query_results::<entities::article_dedication::Model, Vec<_>, _>([vec![
                entities::article_dedication::Model {
                    article_id: 7,
                    dedication_id: 5,
                    expires_at: Some(expiry),
                },
            ]])
            .append_query_results::<entities::dedication::Model, Vec<_>, _>([vec![
                entities::dedication::Model {
                    id: 5,
                    subject: "subject".to_string(),
                    expires_at: None,
                },
            ]])
            .append_query_results([vec![
                [
                    ("id".to_string(), "ann-1".to_string().into()),
                    ("intended_name".to_string(), "אברהם".to_string().into()),
                    ("entity_type".to_string(), "PERSON".to_string().into()),
                    ("disambiguation".to_string(), Option::<String>::None.into()),
                    ("confidence".to_string(), "0.92".to_string().into()),
                    ("acceptance".to_string(), "manual".to_string().into()),
                    ("model_revision".to_string(), "rev-1".to_string().into()),
                    ("span_start".to_string(), 3_i32.into()),
                    ("span_end".to_string(), 9_i32.into()),
                    ("surface".to_string(), "אברהם אבינו".to_string().into()),
                    ("content_hash".to_string(), "c".repeat(64).as_str().into()),
                    ("current_content".to_string(), 1_i64.into()),
                ]
                .into_iter()
                .collect::<BTreeMap<String, DbValue>>(),
            ]])
            .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![
                entities::article_moed::Model {
                    article_id: 7,
                    moed_id: 3,
                    created_at: chrono::NaiveDate::from_ymd_opt(2020, 1, 1)
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap(),
                },
            ]])
            .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![
                entities::moed::Model {
                    id: 3,
                    slug: "ראש-השנה".to_string(),
                    name: "ראש השנה".to_string(),
                    summary: None,
                    hebrew_month: Some("תשרי".to_string()),
                    date_label: None,
                    annual_order: 1,
                    published: true,
                },
            ]])
    }

    #[tokio::test]
    async fn every_operation_rejects_wrong_and_missing_bearer_before_database_access() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = schema(db.clone());
        for token in [None, Some("wrong-key")] {
            for operation in [
                "{ articleRelationshipCapabilities { contractVersion } }",
                "{ articleRelationships(articleId: 7) { articleId } }",
                "{ articleRelationshipTargets(kind: PEREK, query: \"בראשית\") { id } }",
                "mutation { updateArticleRelationships(articleId: 7, input: { source: \"x\" }) { revalidation } }",
            ] {
                let response = schema
                    .execute(Request::new(operation).data(auth(token)))
                    .await;
                assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
                assert_eq!(response.errors[0].message, "Invalid or missing API key");
                let extensions = response.errors[0].extensions.as_ref().unwrap();
                assert_eq!(extensions.get("code"), Some(&Value::from("UNAUTHORIZED")));
            }
        }
        assert!(
            db.get_connection()
                .clone()
                .into_transaction_log()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn capabilities_returns_the_shared_registry_verbatim() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let response = schema(db)
            .execute(
                Request::new(
                    "{ articleRelationshipCapabilities { contractVersion capabilities { key cardinality operations status pendingIssue } } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let contract = response.data.into_json().unwrap();
        let contract = &contract["articleRelationshipCapabilities"];
        assert_eq!(contract["contractVersion"], 1);
        let keys: Vec<&str> = contract["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["key"].as_str().unwrap())
            .collect();
        assert_eq!(
            keys,
            [
                "primaryPerek",
                "author",
                "coveringSources",
                "dedicationAssignments",
                "mentionAnnotations",
                "recurringHebrewDate",
                "moadim"
            ]
        );
        let capabilities = contract["capabilities"].as_array().unwrap();
        assert_eq!(capabilities[0]["cardinality"], "exactly-one");
        assert_eq!(
            capabilities[4]["operations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|op| op.as_str().unwrap())
                .collect::<Vec<_>>(),
            ["read"]
        );
        assert_eq!(capabilities[5]["status"], "pending-schema");
        assert_eq!(capabilities[5]["pendingIssue"], 3098);
        // #3101 landed — moadim is supported with replace/clear operations.
        assert_eq!(capabilities[6]["status"], "supported");
        assert!(capabilities[6]["pendingIssue"].is_null());
        assert_eq!(
            capabilities[6]["operations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|op| op.as_str().unwrap())
                .collect::<Vec<_>>(),
            ["read", "replace", "clear"]
        );
    }

    #[tokio::test]
    async fn relationships_returns_the_article_aggregate() {
        let db = Database::from_connection(relationships_mock().into_connection());
        let response = schema(db)
            .execute(
                Request::new(
                    "{ articleRelationships(articleId: 7) { articleId perekId authorId coverageVerified contentHash coveringSources { perekId pasuk } dedications { dedicationId subject expiresAt dedicationExpiresAt } mentionAnnotations { id intendedName entityType confidence acceptance spanStart spanEnd surface contentHash currentContent } moadim { moedId slug name } } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let aggregate = response.data.into_json().unwrap();
        let aggregate = &aggregate["articleRelationships"];
        assert_eq!(aggregate["articleId"], 7);
        assert_eq!(aggregate["perekId"], 1);
        assert_eq!(aggregate["authorId"], 2);
        assert_eq!(aggregate["coverageVerified"], true);
        assert_eq!(aggregate["contentHash"], "a".repeat(32));
        assert_eq!(aggregate["coveringSources"][0]["pasuk"], 3);
        assert_eq!(aggregate["dedications"][0]["dedicationId"], 5);
        assert_eq!(aggregate["dedications"][0]["subject"], "subject");
        assert_eq!(
            aggregate["dedications"][0]["expiresAt"],
            "2030-01-02T03:04:05Z"
        );
        let annotation = &aggregate["mentionAnnotations"][0];
        assert_eq!(annotation["id"], "ann-1");
        assert_eq!(annotation["acceptance"], "manual");
        assert_eq!(annotation["currentContent"], true);
        assert_eq!(annotation["confidence"], "0.92");
        let moed = &aggregate["moadim"][0];
        assert_eq!(moed["moedId"], 3);
        assert_eq!(moed["slug"], "ראש-השנה");
        assert_eq!(moed["name"], "ראש השנה");
    }

    #[tokio::test]
    async fn relationship_targets_searches_labels_and_rejects_bad_limits() {
        let perek = |id: i32, sefer_name: &str| entities::perek::Model {
            id,
            perek_id: Some(id),
            sefer_id: Some(1),
            sefer_name: Some(sefer_name.to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(1),
            perek_in_context: Some(1),
            date: None,
            hebdate: None,
            tseit: None,
            header: None,
            pasuk_count: Some(31),
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::perek::Model, Vec<_>, _>([vec![
                    perek(1, "בראשית"),
                    perek(2, "שמות"),
                ]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new(
                    "{ articleRelationshipTargets(kind: PEREK, query: \"שמות\") { kind id label hint } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let targets = response.data.into_json().unwrap();
        let targets = &targets["articleRelationshipTargets"];
        assert_eq!(targets.as_array().unwrap().len(), 1);
        assert_eq!(targets[0]["kind"], "PEREK");
        assert_eq!(targets[0]["id"], 2);
        assert_eq!(targets[0]["label"], "שמות א");
        assert_eq!(targets[0]["hint"], "31 פסוקים");

        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let response = schema(db)
            .execute(
                Request::new(
                    "{ articleRelationshipTargets(kind: AUTHOR, query: \"\", limit: 0) { id } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert_eq!(response.errors.len(), 1);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&Value::from("BAD_REQUEST"))
        );
    }

    #[tokio::test]
    async fn update_validation_failure_surfaces_the_graphql_error_code() {
        // A stale expectedContentHash rejects before any write.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::article::Model, Vec<_>, _>([vec![article_model(
                    7,
                )]])
                .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new(
                    "mutation { updateArticleRelationships(articleId: 7, input: { source: \"admin\", expectedContentHash: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" }) { revalidation } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&Value::from("BAD_REQUEST"))
        );
    }

    #[tokio::test]
    async fn update_returns_the_new_state_previous_and_revalidation() {
        let covering = |pasuk: i16| entities::article_covering_source::Model {
            article_id: 7,
            perek_id: 1,
            pasuk,
            created_at: chrono::Utc::now(),
        };
        let perek_bound = entities::perek::Model {
            id: 1,
            perek_id: Some(1),
            sefer_id: Some(1),
            sefer_name: Some("בראשית".to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(1),
            perek_in_context: Some(1),
            date: None,
            hebdate: None,
            tseit: None,
            header: None,
            pasuk_count: Some(31),
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // lock read + previous covering set {1:3}
                .append_query_results::<entities::article::Model, Vec<_>, _>([vec![article_model(
                    7,
                )]])
                .append_query_results::<entities::article_covering_source::Model, Vec<_>, _>([
                    vec![covering(3)],
                ])
                // previous moed link set (unconditional pre-write read)
                .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![]])
                // covering-source canonical bound check
                .append_query_results::<entities::perek::Model, Vec<_>, _>([vec![perek_bound]])
                // delete + insert + flag update + search-index enqueue
                .append_exec_results((0..4).map(|_| sea_orm::MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                .append_query_results::<entities::article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results([Vec::<BTreeMap<String, DbValue>>::new()])
                // post-commit reload
                .append_query_results::<entities::article::Model, Vec<_>, _>([vec![{
                    let mut after = article_model(7);
                    after.coverage_verified = false;
                    after
                }]])
                .append_query_results([vec![hash_row("c".repeat(32).as_str())]])
                .append_query_results::<entities::article_covering_source::Model, Vec<_>, _>([
                    vec![covering(2)],
                ])
                .append_query_results::<entities::article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results([Vec::<BTreeMap<String, DbValue>>::new()])
                .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new(
                    r#"mutation { updateArticleRelationships(articleId: 7, input: { source: "admin", coveringSources: [{ perekId: 1, pasuk: 2 }] }) { revalidation relationships { coverageVerified coveringSources { perekId pasuk } } previous { coveringSources { perekId pasuk } contentHash } } }"#,
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let result = response.data.into_json().unwrap();
        let result = &result["updateArticleRelationships"];
        assert_eq!(result["revalidation"], "SKIPPED");
        // `previous` is the pre-write snapshot — the undo record.
        assert_eq!(result["previous"]["coveringSources"][0]["pasuk"], 3);
        assert_eq!(result["previous"]["contentHash"], "b".repeat(32));
        let relationships = &result["relationships"];
        assert_eq!(relationships["coverageVerified"], false);
        assert_eq!(relationships["coveringSources"][0]["pasuk"], 2);
    }
}
