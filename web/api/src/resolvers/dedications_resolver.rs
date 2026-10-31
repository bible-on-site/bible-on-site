use async_graphql::{Context, ErrorExtensions, Object, Result};
use chrono::Utc;

use crate::common::auth::ApiAuth;
use crate::dtos::dedication::{
    CreateDedicationInput, Dedication, DedicationContextInput, UpdateDedicationInput,
};
use crate::providers::Database;
use crate::services::dedications_service::{self, DedicationContext};

#[derive(Default)]
pub struct DedicationsQuery;

fn context_of(input: DedicationContextInput) -> DedicationContext {
    DedicationContext {
        perek_ids: input.perek_ids.unwrap_or_default(),
        sefer_ids: input.sefer_ids.unwrap_or_default(),
        helek_ids: input.helek_ids.unwrap_or_default(),
        parasha_ids: input.parasha_ids.unwrap_or_default(),
        entry_ids: input.entry_ids.unwrap_or_default(),
        article_ids: input.article_ids.unwrap_or_default(),
        masora: input.masora.unwrap_or(false),
    }
}

#[Object]
impl DedicationsQuery {
    /// Active dedications applicable to a reading context (#2731). Pass every
    /// identity the context carries; perek → sefer → helek ancestors resolve
    /// inside the API. Expired assignments are excluded.
    async fn dedications(
        &self,
        ctx: &Context<'_>,
        context: DedicationContextInput,
    ) -> Result<Vec<Dedication>> {
        Ok(dedications_service::resolve(
            ctx.data::<Database>()?,
            context_of(context),
            Utc::now().naive_utc(),
        )
        .await
        .map_err(|e| e.extend())?
        .into_iter()
        .map(Into::into)
        .collect())
    }

    /// Every dedication with every assignment, including expired — management
    /// view. Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn dedications_admin(&self, ctx: &Context<'_>) -> Result<Vec<Dedication>> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(dedications_service::list_all(ctx.data::<Database>()?)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect())
    }
}

#[derive(Default)]
pub struct DedicationsMutation;

#[Object]
impl DedicationsMutation {
    /// Creates a dedication with purposes and validated targets.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn create_dedication(
        &self,
        ctx: &Context<'_>,
        input: CreateDedicationInput,
    ) -> Result<Dedication> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(dedications_service::create(
            ctx.data::<Database>()?,
            input.subject,
            input.expires_at,
            input.purpose_type_ids.unwrap_or_default(),
            input.targets.unwrap_or_default(),
        )
        .await
        .map_err(|e| e.extend())?
        .into())
    }

    /// Updates subject/expiry and optionally replaces the purpose and target
    /// sets of a dedication, atomically.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn update_dedication(
        &self,
        ctx: &Context<'_>,
        id: i32,
        input: UpdateDedicationInput,
    ) -> Result<Dedication> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(
            dedications_service::update(ctx.data::<Database>()?, id, input)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }

    /// Deletes a dedication and all its assignments. Returns false when the
    /// id did not exist.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn delete_dedication(&self, ctx: &Context<'_>, id: i32) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        dedications_service::remove(ctx.data::<Database>()?, id)
            .await
            .map_err(|e| e.extend())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptySubscription, Request, Schema, Value};
    use entities::{
        article_dedication, dedication, dedication_dedication_type, dedication_type,
        helek_dedication, masora_dedication, parasha_dedication, perek_dedication,
        sefer_dedication, tanahpedia_entry_dedication,
    };
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult};

    fn auth(token: Option<&str>) -> ApiAuth {
        ApiAuth::with_dedication_api_key(token.map(str::to_owned), Some("manager-key".into()))
    }

    fn schema(db: Database) -> Schema<DedicationsQuery, DedicationsMutation, EmptySubscription> {
        Schema::build(DedicationsQuery, DedicationsMutation, EmptySubscription)
            .data(db)
            .finish()
    }

    fn all_scopes_mock() -> MockDatabase {
        let expiry =
            chrono::NaiveDateTime::parse_from_str("2020-01-02 03:04:05", "%Y-%m-%d %H:%M:%S")
                .unwrap();
        MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![perek_dedication::Model {
                perek_id_low: 1,
                perek_id_high: 3,
                dedication_id: 7,
                expires_at: Some(expiry),
            }]])
            .append_query_results([vec![sefer_dedication::Model {
                sefer_id: 1,
                dedication_id: 7,
                expires_at: None,
                created_at: expiry.and_utc(),
            }]])
            .append_query_results([vec![helek_dedication::Model {
                helek_id: 1,
                dedication_id: 7,
                expires_at: None,
                created_at: expiry.and_utc(),
            }]])
            .append_query_results([vec![parasha_dedication::Model {
                parasha_id: 2,
                dedication_id: 7,
                expires_at: None,
                created_at: expiry.and_utc(),
            }]])
            .append_query_results([vec![article_dedication::Model {
                article_id: 19,
                dedication_id: 7,
                expires_at: None,
            }]])
            .append_query_results([vec![tanahpedia_entry_dedication::Model {
                entry_id: "entry-1".into(),
                dedication_id: 7,
                expires_at: None,
                created_at: expiry.and_utc(),
            }]])
            .append_query_results([vec![masora_dedication::Model {
                dedication_id: 7,
                expires_at: None,
                created_at: expiry.and_utc(),
            }]])
            .append_query_results([vec![dedication::Model {
                id: 7,
                subject: "subject".into(),
                expires_at: Some(expiry),
            }]])
            .append_query_results([vec![dedication_dedication_type::Model {
                dedication_id: 7,
                dedication_type_id: 1,
            }]])
            .append_query_results([vec![dedication_type::Model {
                id: 1,
                description: "purpose".into(),
            }]])
    }

    #[tokio::test]
    async fn management_operations_reject_wrong_and_missing_bearer_before_database_access() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let schema = schema(db.clone());
        for token in [None, Some("wrong-key")] {
            for operation in [
                "{ dedicationsAdmin { id } }",
                "mutation { createDedication(input: { subject: \"subject\" }) { id } }",
                "mutation { updateDedication(id: 7, input: {}) { id } }",
                "mutation { deleteDedication(id: 7) }",
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
    async fn admin_returns_expired_dedications_with_all_scope_identities() {
        let db = Database::from_connection(all_scopes_mock().into_connection());
        let response = schema(db).execute(Request::new("{ dedicationsAdmin { id subject purposes expiresAt scopes { kind perekIdLow perekIdHigh seferId helekId parashaId articleId entryId expiresAt } } }").data(auth(Some("manager-key")))).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        let rows = json["dedicationsAdmin"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row["id"], 7);
        assert_eq!(row["subject"], "subject");
        assert_eq!(row["purposes"][0], "purpose");
        assert_eq!(row["expiresAt"], "2020-01-02T03:04:05Z");
        let scopes = row["scopes"].as_array().unwrap();
        assert_eq!(
            scopes
                .iter()
                .map(|scope| scope["kind"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "PEREK",
                "SEFER",
                "HELEK",
                "PARASHA",
                "ARTICLE",
                "TANAHPEDIA_ENTRY",
                "MASORA"
            ]
        );
        assert_eq!(scopes[0]["perekIdLow"], 1);
        assert_eq!(scopes[0]["perekIdHigh"], 3);
        assert_eq!(scopes[0]["expiresAt"], "2020-01-02T03:04:05Z");
        assert_eq!(scopes[1]["seferId"], 1);
        assert_eq!(scopes[2]["helekId"], 1);
        assert_eq!(scopes[3]["parashaId"], 2);
        assert_eq!(scopes[4]["articleId"], 19);
        assert_eq!(scopes[5]["entryId"], "entry-1");
        assert!(scopes[6]["expiresAt"].is_null());
    }

    #[tokio::test]
    async fn authorized_update_returns_the_updated_aggregate() {
        // Update needs the stored model before its aggregate reload.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results([vec![dedication::Model {
                    id: 7,
                    subject: "old".into(),
                    expires_at: None,
                }]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .append_query_results::<perek_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<sefer_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<helek_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<parasha_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<tanahpedia_entry_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<masora_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results([vec![dedication::Model {
                    id: 7,
                    subject: "new".into(),
                    expires_at: None,
                }]])
                .append_query_results::<dedication_dedication_type::Model, Vec<_>, _>([vec![]])
                .append_query_results::<dedication_type::Model, Vec<_>, _>([vec![]])
                .into_connection(),
        );
        let response = schema(db).execute(Request::new("mutation { updateDedication(id: 7, input: { subject: \"new\", clearExpiresAt: true }) { id subject expiresAt scopes { kind } } }").data(auth(Some("manager-key")))).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let json = response.data.into_json().unwrap();
        assert_eq!(json["updateDedication"]["id"], 7);
        assert_eq!(json["updateDedication"]["subject"], "new");
        assert!(json["updateDedication"]["expiresAt"].is_null());
    }

    #[tokio::test]
    async fn authorized_delete_returns_whether_the_row_existed() {
        for rows_affected in [0, 1] {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_exec_results((0..9).map(|_| MockExecResult {
                        last_insert_id: 0,
                        rows_affected,
                    }))
                    .into_connection(),
            );
            let response = schema(db)
                .execute(
                    Request::new("mutation { deleteDedication(id: 7) }")
                        .data(auth(Some("manager-key"))),
                )
                .await;
            assert!(response.errors.is_empty(), "{:?}", response.errors);
            assert_eq!(
                response.data.into_json().unwrap()["deleteDedication"],
                rows_affected > 0
            );
        }
    }

    #[tokio::test]
    async fn service_failures_expose_graphql_error_codes() {
        for (operation, mock, code, status) in [
            (
                "{ dedications(context: { articleIds: [19] }) { id } }",
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_errors([DbErr::Custom("private database detail".into())]),
                "INTERNAL_SERVER_ERROR",
                500,
            ),
            (
                "{ dedicationsAdmin { id } }",
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_errors([DbErr::Custom("private database detail".into())]),
                "INTERNAL_SERVER_ERROR",
                500,
            ),
            (
                "mutation { createDedication(input: { subject: \"   \" }) { id } }",
                MockDatabase::new(DatabaseBackend::MySql),
                "BAD_REQUEST",
                400,
            ),
            (
                "mutation { updateDedication(id: 404, input: {}) { id } }",
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<dedication::Model, Vec<_>, _>([vec![]]),
                "NOT_FOUND",
                404,
            ),
            (
                "mutation { deleteDedication(id: 7) }",
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_exec_errors([DbErr::Custom("private database detail".into())]),
                "INTERNAL_SERVER_ERROR",
                500,
            ),
        ] {
            let db = Database::from_connection(mock.into_connection());
            let response = schema(db)
                .execute(Request::new(operation).data(auth(Some("manager-key"))))
                .await;
            assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
            let error = &response.errors[0];
            assert!(!error.message.contains("private database detail"));
            let extensions = error.extensions.as_ref().unwrap();
            assert_eq!(extensions.get("code"), Some(&Value::from(code)));
            assert_eq!(extensions.get("statusCode"), Some(&Value::from(status)));
        }
    }

    #[test]
    fn context_conversion_preserves_every_identity_and_defaults_missing_fields() {
        let empty = context_of(DedicationContextInput::default());
        assert!(
            empty.perek_ids.is_empty()
                && empty.sefer_ids.is_empty()
                && empty.helek_ids.is_empty()
                && empty.parasha_ids.is_empty()
                && empty.entry_ids.is_empty()
                && empty.article_ids.is_empty()
        );
        assert!(!empty.masora);
        let context = context_of(DedicationContextInput {
            perek_ids: Some(vec![1, 2]),
            sefer_ids: Some(vec![1]),
            helek_ids: Some(vec![2]),
            parasha_ids: Some(vec![3]),
            entry_ids: Some(vec!["entry-1".into()]),
            article_ids: Some(vec![19]),
            masora: Some(true),
        });
        assert_eq!(context.perek_ids, [1, 2]);
        assert_eq!(context.sefer_ids, [1]);
        assert_eq!(context.helek_ids, [2]);
        assert_eq!(context.parasha_ids, [3]);
        assert_eq!(context.entry_ids, ["entry-1"]);
        assert_eq!(context.article_ids, [19]);
        assert!(context.masora);
    }
}
