use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::common::website_revalidate::WebsiteRevalidator;
use crate::dtos::moed::{Moed, UpsertMoedInput, UpsertMoedResult};
use crate::providers::Database;
use crate::services::moed_service;

#[derive(Default)]
pub struct MoedQuery;

#[Object]
impl MoedQuery {
    /// The public מועדים על הפרק catalogue — published moadim in annual
    /// wheel order (#3101). Each moed carries its ordered labelled sections
    /// and `articles` resolves the deduplicated union of explicit links and
    /// scripture-range matches.
    async fn moadim(&self, ctx: &Context<'_>) -> Result<Vec<Moed>> {
        moed_service::list_published(ctx.data::<Database>()?.get_connection())
            .await
            .map_err(|e| e.extend())
    }

    /// One published moed by its canonical slug — null when no published
    /// moed owns the slug (the website's detail page maps that to 404).
    async fn moed(&self, ctx: &Context<'_>, slug: String) -> Result<Option<Moed>> {
        Ok(
            moed_service::load_by_slug(ctx.data::<Database>()?.get_connection(), slug.trim(), true)
                .await
                .map_err(|e| e.extend())?
                .map(Into::into),
        )
    }

    /// Every moed including unpublished drafts, in wheel order — the
    /// catalogue-management view.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn moadim_admin(&self, ctx: &Context<'_>) -> Result<Vec<Moed>> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        moed_service::list_all(ctx.data::<Database>()?.get_connection())
            .await
            .map_err(|e| e.extend())
    }
}

#[derive(Default)]
pub struct MoedMutation;

#[Object]
impl MoedMutation {
    /// Creates or updates one moed — `input.id` selects the row, omitted
    /// creates. `sections` (when supplied) replaces the full ordered
    /// section/range set; every range coordinate is validated against the
    /// canonical perek bounds inside the transaction. The result carries
    /// the website-invalidation outcome.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn upsert_moed(
        &self,
        ctx: &Context<'_>,
        input: UpsertMoedInput,
    ) -> Result<UpsertMoedResult> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        let (moed, revalidation) = moed_service::upsert_moed(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            input,
        )
        .await
        .map_err(|e| e.extend())?;
        Ok(UpsertMoedResult {
            moed: Some(moed),
            revalidation: revalidation.to_string(),
        })
    }

    /// Deletes a moed — sections, ranges and article links cascade. The
    /// deleted slug rides the invalidation so its prerendered page expires.
    /// Requires `Authorization: Bearer <ARTICLE_API_KEY>`.
    async fn delete_moed(&self, ctx: &Context<'_>, id: i32) -> Result<UpsertMoedResult> {
        ctx.data::<ApiAuth>()?
            .authorize_article_manager()
            .map_err(|e| e.extend())?;
        let revalidation =
            moed_service::delete_moed(ctx.data::<Database>()?, &WebsiteRevalidator::from_env(), id)
                .await
                .map_err(|e| e.extend())?;
        Ok(UpsertMoedResult {
            moed: None,
            revalidation: revalidation.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Request, Schema, Value};
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult};
    use std::collections::BTreeMap;

    fn auth(token: Option<&str>) -> ApiAuth {
        ApiAuth::with_article_api_key(token.map(str::to_owned), Some("article-key".into()))
    }

    fn schema(db: Database) -> Schema<MoedQuery, MoedMutation, EmptySubscription> {
        Schema::build(MoedQuery, MoedMutation, EmptySubscription)
            .data(db)
            .finish()
    }

    fn moed_model(id: i32) -> entities::moed::Model {
        entities::moed::Model {
            id,
            slug: format!("moed-{id}"),
            name: format!("Moed {id}"),
            summary: None,
            hebrew_month: Some("תשרי".to_string()),
            date_label: None,
            annual_order: id as i16,
            published: true,
        }
    }

    /// The queries a one-moed catalogue row runs: the moed itself, its
    /// sections, the ranges of those sections and its explicit links.
    fn moed_with_reading_mock() -> MockDatabase {
        MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![moed_model(3)]])
            .append_query_results::<entities::moed_section::Model, Vec<_>, _>([vec![
                entities::moed_section::Model {
                    id: 9,
                    moed_id: 3,
                    label: "הפטרה".to_string(),
                    position: 1,
                },
            ]])
            .append_query_results::<entities::moed_range::Model, Vec<_>, _>([vec![
                entities::moed_range::Model {
                    id: 4,
                    section_id: 9,
                    position: 1,
                    perek_id_start: 344,
                    pasuk_start: 14,
                    perek_id_end: 345,
                    pasuk_end: 14,
                },
            ]])
            .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![]])
    }

    #[tokio::test]
    async fn management_operations_reject_wrong_and_missing_bearer_before_database_access() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = schema(db.clone());
        for token in [None, Some("wrong-key")] {
            for operation in [
                "{ moadimAdmin { id } }",
                "mutation { upsertMoed(input: { name: \"x\", annualOrder: 1, published: true }) { revalidation } }",
                "mutation { deleteMoed(id: 1) { revalidation } }",
            ] {
                let response = schema
                    .execute(Request::new(operation).data(auth(token)))
                    .await;
                assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
                assert_eq!(response.errors[0].message, "Invalid or missing API key");
                let extensions = response.errors[0].extensions.as_ref().unwrap();
                assert_eq!(extensions.get("code"), Some(&Value::from("UNAUTHORIZED")));
                assert_eq!(extensions.get("statusCode"), Some(&Value::from(401)));
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
    async fn public_catalogue_and_detail_resolve_without_a_key() {
        // The public `moadim` list: one moed with one section and one range.
        let db = Database::from_connection(moed_with_reading_mock().into_connection());
        let response = schema(db)
            .execute(Request::new(
                "{ moadim { id slug name hebrewMonth annualOrder published sections { label position ranges { perekIdStart pasukStart perekIdEnd pasukEnd } } explicitArticleIds } }",
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        let moed = &json["moadim"][0];
        assert_eq!(moed["id"], 3);
        assert_eq!(moed["slug"], "moed-3");
        assert_eq!(moed["annualOrder"], 3);
        assert_eq!(moed["published"], true);
        assert_eq!(moed["sections"][0]["label"], "הפטרה");
        assert_eq!(moed["sections"][0]["ranges"][0]["perekIdStart"], 344);
        assert_eq!(moed["sections"][0]["ranges"][0]["pasukEnd"], 14);

        // `moed(slug)` detail — same read, filtered by slug.
        let db = Database::from_connection(moed_with_reading_mock().into_connection());
        let response = schema(db)
            .execute(Request::new("{ moed(slug: \"moed-3\") { id name } }"))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(response.data.into_json().unwrap()["moed"]["id"], 3);
    }

    #[tokio::test]
    async fn unknown_slug_resolves_to_null() {
        // A slug no published moed owns resolves to null — the website maps
        // that to its 404 surface (draft moadim are filtered in SQL, which a
        // mock cannot distinguish).
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(Request::new("{ moed(slug: \"missing\") { id } }"))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert!(response.data.into_json().unwrap()["moed"].is_null());
    }

    #[tokio::test]
    async fn articles_resolves_the_explicit_link_union_without_range_matches() {
        // A moed with no sections: the union read degenerates to explicit
        // links only — the union SQL still returns the linked article.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // load_by_slug: moed + sections (empty) + explicit ids
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![moed_model(3)]])
                .append_query_results::<entities::moed_section::Model, Vec<_>, _>([vec![]])
                .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![
                    entities::article_moed::Model {
                        article_id: 42,
                        moed_id: 3,
                        created_at: chrono::NaiveDate::from_ymd_opt(2020, 1, 1)
                            .unwrap()
                            .and_hms_opt(0, 0, 0)
                            .unwrap(),
                    },
                ]])
                // articles_for_moed: perek bound read (no ranges → empty),
                // the union SELECT, the article rows and their covering read.
                .append_query_results::<entities::perek::Model, Vec<_>, _>([vec![]])
                .append_query_results([vec![
                    [("id".to_string(), 42_i32.into())]
                        .into_iter()
                        .collect::<BTreeMap<String, sea_orm::Value>>(),
                ]])
                .append_query_results::<entities::article::Model, Vec<_>, _>([vec![
                    entities::article::Model {
                        id: 42,
                        perek_id: 1,
                        author_id: 2,
                        article_abstract: None,
                        name: "linked".to_string(),
                        priority: 1,
                        content: Some("content".to_string()),
                        coverage_verified: false,
                    },
                ]])
                .append_query_results::<entities::article_covering_source::Model, Vec<_>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let response = schema(db)
            .execute(Request::new(
                "{ moed(slug: \"moed-3\") { id articles { id name } } }",
            ))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["moed"]["articles"][0]["id"], 42);
        assert_eq!(json["moed"]["articles"][0]["name"], "linked");
    }

    #[tokio::test]
    async fn upsert_validation_and_lookup_failures_surface_error_codes() {
        // An invalid slug fails before any database access.
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let response = schema(db)
            .execute(
                Request::new(
                    "mutation { upsertMoed(input: { name: \"x\", slug: \"bad--slug\", annualOrder: 1, published: true }) { revalidation } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&Value::from("BAD_REQUEST"))
        );

        // Updating an unknown moed is NOT_FOUND.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new(
                    "mutation { upsertMoed(input: { id: 404, name: \"x\", annualOrder: 1, published: true }) { revalidation } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert_eq!(response.errors.len(), 1);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&Value::from("NOT_FOUND"))
        );

        // Deleting an unknown moed is NOT_FOUND too.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new("mutation { deleteMoed(id: 404) { revalidation } }")
                    .data(auth(Some("article-key"))),
            )
            .await;
        assert_eq!(response.errors.len(), 1);
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&Value::from("NOT_FOUND"))
        );
    }

    #[tokio::test]
    async fn create_and_delete_return_the_invalidation_outcome() {
        // Create: conflict check → insert + last-insert-id re-read →
        // aggregate reload (moed, empty sections, empty links). The
        // revalidator is unconfigured → SKIPPED.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 3,
                    rows_affected: 1,
                }])
                // ActiveModel::insert re-reads the inserted row (MySQL has no
                // RETURNING), then load_by_id re-reads the aggregate.
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![moed_model(3)]])
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![moed_model(3)]])
                .append_query_results::<entities::moed_section::Model, Vec<_>, _>([vec![]])
                .append_query_results::<entities::article_moed::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new(
                    "mutation { upsertMoed(input: { name: \"פסח\", annualOrder: 7, published: true }) { moed { id slug published } revalidation } }",
                )
                .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["upsertMoed"]["moed"]["id"], 3);
        // The result re-reads the persisted row — its stored slug.
        assert_eq!(json["upsertMoed"]["moed"]["slug"], "moed-3");
        assert_eq!(json["upsertMoed"]["revalidation"], "SKIPPED");

        // Delete: locked read → delete → invalidation carries the dead slug.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entities::moed::Model, Vec<_>, _>([vec![moed_model(3)]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .into_connection(),
        );
        let response = schema(db)
            .execute(
                Request::new("mutation { deleteMoed(id: 3) { moed { id } revalidation } }")
                    .data(auth(Some("article-key"))),
            )
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert!(json["deleteMoed"]["moed"].is_null());
        assert_eq!(json["deleteMoed"]["revalidation"], "SKIPPED");
    }

    #[tokio::test]
    async fn service_failures_expose_graphql_error_codes() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom("private database detail".into())])
                .into_connection(),
        );
        let response = schema(db).execute(Request::new("{ moadim { id } }")).await;
        assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
        let error = &response.errors[0];
        assert!(!error.message.contains("private database detail"));
        let extensions = error.extensions.as_ref().unwrap();
        assert_eq!(
            extensions.get("code"),
            Some(&Value::from("INTERNAL_SERVER_ERROR"))
        );
        assert_eq!(extensions.get("statusCode"), Some(&Value::from(500)));
    }
}
