use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::author::{Entity, Model};
use sea_orm::EntityTrait;

pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("authors_service::find_all");
    let authors = Entity::find()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} authors", authors.len());
    Ok(authors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase};

    fn create_mock_db_with_query_error(error_message: &str) -> Database {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([DbErr::Custom(error_message.to_string())])
            .into_connection();
        Database::from_connection(mock_db)
    }

    #[tokio::test]
    async fn find_all_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Database timeout");

        let result = find_all(&db).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }
}
