use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::perek::{Entity, Model};
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter};

pub async fn find_one_by_perek_id(db: &Database, perek_id: i32) -> Result<Model, ServiceError> {
    tracing::info_span!("perakim_service::find_one_by_perek_id", %perek_id);
    let perek = Entity::find()
        .filter(entities::perek::Column::PerekId.eq(perek_id))
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    pub const PEREK_NOT_FOUND: &str = "Perek Not Found";
    match perek {
        Some(value) => {
            tracing::info!("Perek found");
            Ok(value)
        }
        None => Err(ServiceError::not_found(PEREK_NOT_FOUND, None::<DbErr>)),
    }
}

pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("perakim_service::find_all");
    let perakim = Entity::find()
        .filter(entities::perek::Column::PerekId.is_not_null())
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} perakim", perakim.len());
    Ok(perakim)
}

pub async fn find_by_sefer_id(db: &Database, sefer_id: i32) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("perakim_service::find_by_sefer_id", %sefer_id);
    let perakim = Entity::find()
        .filter(entities::perek::Column::SeferId.eq(sefer_id))
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} perakim for sefer {}", perakim.len(), sefer_id);
    Ok(perakim)
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
    async fn find_one_by_perek_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection lost");

        let result = find_one_by_perek_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
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

    #[tokio::test]
    async fn find_by_sefer_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Query failed");

        let result = find_by_sefer_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_one_by_perek_id_returns_not_found_when_perek_does_not_exist() {
        // Return empty result (no perek found)
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = find_one_by_perek_id(&db, 999).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert_eq!(err.to_string(), "Perek Not Found");
    }
}
