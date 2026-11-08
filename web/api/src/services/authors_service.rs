use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::author::{Column, Entity, Model};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

const AUTHOR_PAGE_SIZE: u64 = 10_000;

/// Returns every author in bounded pages while preserving the legacy GraphQL contract.
pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("authors_service::find_all");
    let mut authors = Vec::new();
    let mut last_id = None;

    loop {
        let mut query = Entity::find()
            .select_only()
            .column(Column::Id)
            .column(Column::Name)
            .column(Column::Details)
            .order_by_asc(Column::Id)
            .limit(AUTHOR_PAGE_SIZE);
        if let Some(last_id) = last_id {
            query = query.filter(Column::Id.gt(last_id));
        }

        let page: Vec<Model> = query
            .into_model::<Model>()
            .all(db.get_connection())
            .await
            .map_err(|db_err| {
                ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
            })?;
        let page_len = page.len();
        last_id = page.last().map(|author| author.id);
        authors.extend(page);
        if page_len < AUTHOR_PAGE_SIZE as usize {
            break;
        }
    }

    tracing::info!("Found {} authors", authors.len());
    Ok(authors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase};

    fn author_model(id: i32) -> Model {
        Model {
            id,
            name: format!("Author {id}"),
            details: String::new(),
        }
    }

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

    #[tokio::test]
    async fn find_all_fetches_authors_in_bounded_pages() {
        let first_page: Vec<_> = (1..=AUTHOR_PAGE_SIZE as i32).map(author_model).collect();
        let second_page = vec![author_model(AUTHOR_PAGE_SIZE as i32 + 1)];
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<Model, Vec<_>, _>([first_page, second_page])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let authors = find_all(&db).await.unwrap();

        assert_eq!(authors.len(), AUTHOR_PAGE_SIZE as usize + 1);
        assert_eq!(authors.first().unwrap().id, 1);
        assert_eq!(authors.last().unwrap().id, AUTHOR_PAGE_SIZE as i32 + 1);
    }
}
