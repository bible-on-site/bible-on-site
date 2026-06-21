use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_entry_revision::SubmitEntryRevisionInput,
    providers::Database,
};
use entities::tanahpedia::{entry, entry_revision};
use sea_orm::{ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder};

const REVISION_STATUS_PENDING: &str = "PENDING";

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
}
