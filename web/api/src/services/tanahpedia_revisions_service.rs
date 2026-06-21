use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_entry_revision::SubmitEntryRevisionInput,
    providers::Database,
};
use entities::tanahpedia::{entry, entry_revision};
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder};

const REVISION_STATUS_PENDING: &str = "PENDING";
const REVISION_STATUS_APPLIED: &str = "APPLIED";

/// Normalizes an optional, possibly-blank string into `Some(trimmed)` or `None`.
fn normalize(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Persists a revision proposed by an external AI client for human triage.
///
/// Validation:
/// - `source` is required (non-blank).
/// - at least one of `proposed_unique_name` / `proposed_title` /
///   `proposed_content` must be present.
/// - when `entry_id` is supplied it must reference an existing entry; omit it to
///   propose a brand-new entry.
///
/// The revision is always stored with status `PENDING`; nothing is applied to
/// `tanahpedia_entry` here — a human reviews it later.
pub async fn create_revision(
    db: &Database,
    input: SubmitEntryRevisionInput,
) -> Result<entry_revision::Model, ServiceError> {
    tracing::info_span!("tanahpedia_revisions_service::create_revision");

    let source = normalize(Some(input.source))
        .ok_or_else(|| ServiceError::bad_request("source is required"))?;
    let proposed_unique_name = normalize(input.proposed_unique_name);
    let proposed_title = normalize(input.proposed_title);
    let proposed_content = normalize(input.proposed_content);
    let notes = normalize(input.notes);
    let entry_id = normalize(input.entry_id);

    if proposed_unique_name.is_none() && proposed_title.is_none() && proposed_content.is_none() {
        return Err(ServiceError::bad_request(
            "at least one of proposedUniqueName, proposedTitle or proposedContent is required",
        ));
    }

    // When targeting an existing entry, it must exist.
    if let Some(ref id) = entry_id {
        let existing = entry::Entity::find_by_id(id.clone())
            .one(db.get_connection())
            .await
            .map_err(|db_err| {
                ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
            })?;
        if existing.is_none() {
            return Err(ServiceError::bad_request(
                "entryId does not reference an existing entry",
            ));
        }
    }

    let now = chrono::Utc::now().naive_utc();
    let model = entry_revision::Model {
        id: uuid::Uuid::new_v4().to_string(),
        entry_id,
        proposed_unique_name,
        proposed_title,
        proposed_content,
        source,
        notes,
        status: REVISION_STATUS_PENDING.to_string(),
        created_at: now,
        updated_at: now,
    };

    entry_revision::Entity::insert(model.clone().into_active_model())
        .exec(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    tracing::info!(revision_id = %model.id, source = %model.source, "Stored entry revision");
    Ok(model)
}

/// Lists entry revisions, newest first, optionally filtered by status and/or the
/// targeted entry. Intended for the admin triage view.
pub async fn find_revisions(
    db: &Database,
    status: Option<String>,
    entry_id: Option<String>,
) -> Result<Vec<entry_revision::Model>, ServiceError> {
    tracing::info_span!("tanahpedia_revisions_service::find_revisions");

    let mut query = entry_revision::Entity::find();
    if let Some(status) = normalize(status) {
        query = query.filter(entry_revision::Column::Status.eq(status));
    }
    if let Some(entry_id) = normalize(entry_id) {
        query = query.filter(entry_revision::Column::EntryId.eq(entry_id));
    }

    let revisions = query
        .order_by_desc(entry_revision::Column::CreatedAt)
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    tracing::info!("Found {} entry revisions", revisions.len());
    Ok(revisions)
}

/// Applies a stored revision to the live `tanahpedia_entry`, then marks the
/// revision `APPLIED`. Gated by the same API key that authorizes submission, so
/// an authorized client can apply directly; the revision row is retained as the
/// audit/history record for the change.
///
/// - When the revision targets an existing entry, its present `proposed_*`
///   fields overwrite that entry (absent fields are left untouched).
/// - When the revision has no `entry_id`, a brand-new entry is created — this
///   requires both `proposed_unique_name` and `proposed_title` (the entry's
///   non-null columns) — and the revision is linked to the new entry.
///
/// Re-applying an already-`APPLIED` revision is rejected.
pub async fn apply_revision(
    db: &Database,
    revision_id: String,
) -> Result<entry_revision::Model, ServiceError> {
    tracing::info_span!("tanahpedia_revisions_service::apply_revision");

    let conn = db.get_connection();

    let revision = entry_revision::Entity::find_by_id(revision_id.clone())
        .one(conn)
        .await
        .map_err(|db_err| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err)))?
        .ok_or_else(|| ServiceError::not_found("revision not found", Option::<String>::None))?;

    if revision.status == REVISION_STATUS_APPLIED {
        return Err(ServiceError::bad_request(
            "revision has already been applied",
        ));
    }

    let now = chrono::Utc::now().naive_utc();

    let target_entry_id = match revision.entry_id.clone() {
        Some(entry_id) => {
            entry::Entity::find_by_id(entry_id.clone())
                .one(conn)
                .await
                .map_err(|db_err| {
                    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
                })?
                .ok_or_else(|| {
                    ServiceError::not_found(
                        "the entry targeted by this revision no longer exists",
                        Option::<String>::None,
                    )
                })?;

            let mut update =
                entry::Entity::update_many().filter(entry::Column::Id.eq(entry_id.clone()));
            if let Some(unique_name) = revision.proposed_unique_name.clone() {
                update = update.col_expr(entry::Column::UniqueName, Expr::value(unique_name));
            }
            if let Some(title) = revision.proposed_title.clone() {
                update = update.col_expr(entry::Column::Title, Expr::value(title));
            }
            if let Some(content) = revision.proposed_content.clone() {
                update = update.col_expr(entry::Column::Content, Expr::value(content));
            }
            update = update.col_expr(entry::Column::UpdatedAt, Expr::value(now));
            update.exec(conn).await.map_err(|db_err| {
                ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
            })?;

            entry_id
        }
        None => {
            let unique_name = revision.proposed_unique_name.clone().ok_or_else(|| {
                ServiceError::bad_request(
                    "applying a new-entry revision requires proposedUniqueName",
                )
            })?;
            let title = revision.proposed_title.clone().ok_or_else(|| {
                ServiceError::bad_request("applying a new-entry revision requires proposedTitle")
            })?;

            let new_entry = entry::Model {
                id: uuid::Uuid::new_v4().to_string(),
                unique_name,
                title,
                content: revision.proposed_content.clone(),
                created_at: now,
                updated_at: now,
            };
            let new_id = new_entry.id.clone();
            entry::Entity::insert(new_entry.into_active_model())
                .exec(conn)
                .await
                .map_err(|db_err| {
                    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
                })?;

            new_id
        }
    };

    entry_revision::Entity::update_many()
        .col_expr(
            entry_revision::Column::Status,
            Expr::value(REVISION_STATUS_APPLIED.to_string()),
        )
        .col_expr(
            entry_revision::Column::EntryId,
            Expr::value(target_entry_id.clone()),
        )
        .col_expr(entry_revision::Column::UpdatedAt, Expr::value(now))
        .filter(entry_revision::Column::Id.eq(revision.id.clone()))
        .exec(conn)
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let mut applied = revision;
    applied.status = REVISION_STATUS_APPLIED.to_string();
    applied.entry_id = Some(target_entry_id);
    applied.updated_at = now;

    tracing::info!(revision_id = %applied.id, "Applied entry revision");
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

    fn input_with_title(title: &str) -> SubmitEntryRevisionInput {
        SubmitEntryRevisionInput {
            source: "gpt-4o".to_string(),
            proposed_title: Some(title.to_string()),
            ..Default::default()
        }
    }

    fn entry_model(id: &str) -> entry::Model {
        entry::Model {
            id: id.to_string(),
            unique_name: "avraham".to_string(),
            title: "אברהם".to_string(),
            content: None,
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        }
    }

    #[tokio::test]
    async fn create_revision_rejects_blank_source() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let input = SubmitEntryRevisionInput {
            source: "   ".to_string(),
            proposed_title: Some("x".to_string()),
            ..Default::default()
        };

        let err = create_revision(&db, input).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_revision_rejects_when_no_proposed_fields() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let input = SubmitEntryRevisionInput {
            source: "gpt-4o".to_string(),
            proposed_title: Some("  ".to_string()),
            ..Default::default()
        };

        let err = create_revision(&db, input).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_revision_rejects_unknown_entry_id() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock_db);
        let input = SubmitEntryRevisionInput {
            source: "gpt-4o".to_string(),
            entry_id: Some("does-not-exist".to_string()),
            proposed_title: Some("x".to_string()),
            ..Default::default()
        };

        let err = create_revision(&db, input).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_revision_stores_new_entry_proposal() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let revision = create_revision(&db, input_with_title("ערך חדש"))
            .await
            .expect("revision should be created");

        assert_eq!(revision.source, "gpt-4o");
        assert_eq!(revision.status, "PENDING");
        assert_eq!(revision.proposed_title.as_deref(), Some("ערך חדש"));
        assert!(revision.entry_id.is_none());
        assert!(!revision.id.is_empty());
    }

    #[tokio::test]
    async fn create_revision_stores_revision_for_existing_entry() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                "entry-1",
            )]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock_db);
        let input = SubmitEntryRevisionInput {
            source: "claude".to_string(),
            entry_id: Some("entry-1".to_string()),
            proposed_content: Some("<p>טקסט</p>".to_string()),
            ..Default::default()
        };

        let revision = create_revision(&db, input)
            .await
            .expect("revision should be created");

        assert_eq!(revision.entry_id.as_deref(), Some("entry-1"));
        assert_eq!(revision.proposed_content.as_deref(), Some("<p>טקסט</p>"));
    }

    #[tokio::test]
    async fn create_revision_surfaces_db_errors() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_errors([sea_orm::DbErr::Custom("insert failed".to_string())])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = create_revision(&db, input_with_title("x"))
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }

    #[tokio::test]
    async fn find_revisions_returns_rows() {
        let row = entry_revision::Model {
            id: "rev-1".to_string(),
            entry_id: None,
            proposed_unique_name: None,
            proposed_title: Some("t".to_string()),
            proposed_content: None,
            source: "gpt-4o".to_string(),
            notes: None,
            status: "PENDING".to_string(),
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        };
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                row,
            ]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let revisions = find_revisions(&db, Some("PENDING".to_string()), None)
            .await
            .expect("should query");
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].id, "rev-1");
    }

    #[tokio::test]
    async fn find_revisions_surfaces_db_errors() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([sea_orm::DbErr::Custom("boom".to_string())])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = find_revisions(&db, None, None).await.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }

    fn revision_model(entry_id: Option<&str>, status: &str) -> entry_revision::Model {
        entry_revision::Model {
            id: "rev-1".to_string(),
            entry_id: entry_id.map(|s| s.to_string()),
            proposed_unique_name: Some("avraham".to_string()),
            proposed_title: Some("אברהם".to_string()),
            proposed_content: Some("<p>תוכן</p>".to_string()),
            source: "gpt-4o".to_string(),
            notes: None,
            status: status.to_string(),
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        }
    }

    #[tokio::test]
    async fn apply_revision_rejects_unknown_revision() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = apply_revision(&db, "missing".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn apply_revision_rejects_already_applied() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                revision_model(Some("entry-1"), "APPLIED"),
            ]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = apply_revision(&db, "rev-1".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn apply_revision_new_entry_requires_unique_name() {
        let mut revision = revision_model(None, "PENDING");
        revision.proposed_unique_name = None;
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                revision,
            ]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = apply_revision(&db, "rev-1".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn apply_revision_creates_new_entry() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                revision_model(None, "PENDING"),
            ]])
            .append_exec_results([
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let applied = apply_revision(&db, "rev-1".to_string())
            .await
            .expect("revision should apply");

        assert_eq!(applied.status, "APPLIED");
        assert!(applied.entry_id.is_some());
        assert!(!applied.entry_id.unwrap().is_empty());
    }

    #[tokio::test]
    async fn apply_revision_updates_existing_entry() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                revision_model(Some("entry-1"), "PENDING"),
            ]])
            .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                "entry-1",
            )]])
            .append_exec_results([
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let applied = apply_revision(&db, "rev-1".to_string())
            .await
            .expect("revision should apply");

        assert_eq!(applied.status, "APPLIED");
        assert_eq!(applied.entry_id.as_deref(), Some("entry-1"));
    }

    #[tokio::test]
    async fn apply_revision_rejects_when_target_entry_missing() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entry_revision::Model, Vec<entry_revision::Model>, _>([vec![
                revision_model(Some("gone"), "PENDING"),
            ]])
            .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = apply_revision(&db, "rev-1".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn apply_revision_surfaces_db_errors() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([sea_orm::DbErr::Custom("boom".to_string())])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = apply_revision(&db, "rev-1".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }
}
