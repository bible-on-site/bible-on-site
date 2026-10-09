use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::article::{Column, Entity, Model};
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter};

/// Returns all articles from the database
pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_all");
    let articles = Entity::find()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles", articles.len());
    Ok(articles)
}

pub async fn find_one_by_id(db: &Database, id: i32) -> Result<Model, ServiceError> {
    tracing::info_span!("articles_service::find_one_by_id", %id);
    let article = Entity::find_by_id(id)
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    pub const ARTICLE_NOT_FOUND: &str = "Article Not Found";
    match article {
        Some(value) => {
            tracing::info!("Article found");
            Ok(value)
        }
        None => Err(ServiceError::not_found(ARTICLE_NOT_FOUND, None::<DbErr>)),
    }
}

pub async fn find_by_perek_id(db: &Database, perek_id: i32) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_by_perek_id", %perek_id);
    let articles = Entity::find()
        .filter(Column::PerekId.eq(perek_id as i16))
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles for perek {}", articles.len(), perek_id);
    Ok(articles)
}

pub async fn find_by_author_id(db: &Database, author_id: i32) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_by_author_id", %author_id);
    let articles = Entity::find()
        .filter(Column::AuthorId.eq(author_id as i16))
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles for author {}", articles.len(), author_id);
    Ok(articles)
}

/// Returns a 929-element vector where each index i contains the count of articles for perek (i + 1)
pub async fn count_by_perek(db: &Database) -> Result<Vec<i64>, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_perek");

    #[derive(FromQueryResult)]
    struct PerekCount {
        perek_id: i16,
        count: i64,
    }

    let counts: Vec<PerekCount> = Entity::find()
        .select_only()
        .column_as(Column::PerekId, "perek_id")
        .column_as(Column::Id.count(), "count")
        .group_by(Column::PerekId)
        .into_model::<PerekCount>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    // Build a 929-element vector, initialized to 0
    let mut result = vec![0i64; 929];
    for pc in counts {
        let idx = (pc.perek_id as usize).saturating_sub(1);
        if idx < 929 {
            result[idx] = pc.count;
        }
    }

    tracing::info!("Counted articles for 929 perakim");
    Ok(result)
}

/// Returns the count of articles for a specific author
pub async fn count_by_author_id(db: &Database, author_id: i32) -> Result<i64, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_author_id", %author_id);

    #[derive(FromQueryResult)]
    struct CountResult {
        count: i64,
    }

    let result = Entity::find()
        .select_only()
        .column_as(Column::Id.count(), "count")
        .filter(Column::AuthorId.eq(author_id as i16))
        .into_model::<CountResult>()
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let count = result.map(|r| r.count).unwrap_or(0);
    tracing::info!("Author {} has {} articles", author_id, count);
    Ok(count)
}

/// Returns a map of author_id → article count for all authors with articles
pub async fn count_by_author(
    db: &Database,
) -> Result<std::collections::HashMap<i32, i64>, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_author");

    #[derive(FromQueryResult)]
    struct AuthorCount {
        author_id: i16,
        count: i64,
    }

    let counts: Vec<AuthorCount> = Entity::find()
        .select_only()
        .column_as(Column::AuthorId, "author_id")
        .column_as(Column::Id.count(), "count")
        .group_by(Column::AuthorId)
        .into_model::<AuthorCount>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let result: std::collections::HashMap<i32, i64> = counts
        .into_iter()
        .map(|ac| (ac.author_id as i32, ac.count))
        .collect();

    tracing::info!("Counted articles for {} authors", result.len());
    Ok(result)
}

/// Returns the count of articles for a specific perek
pub async fn count_by_perek_id(db: &Database, perek_id: i32) -> Result<i64, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_perek_id", %perek_id);

    #[derive(FromQueryResult)]
    struct CountResult {
        count: i64,
    }

    let result = Entity::find()
        .select_only()
        .column_as(Column::Id.count(), "count")
        .filter(Column::PerekId.eq(perek_id as i16))
        .into_model::<CountResult>()
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let count = result.map(|r| r.count).unwrap_or(0);
    tracing::info!("Perek {} has {} articles", perek_id, count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn create_mock_db_with_query_error(error_message: &str) -> Database {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([DbErr::Custom(error_message.to_string())])
            .into_connection();
        Database::from_connection(mock_db)
    }

    fn article_model(id: i32, perek_id: i16, author_id: i16) -> Model {
        Model {
            id,
            perek_id,
            author_id,
            article_abstract: Some(format!("abstract-{id}")),
            name: format!("Article {id}"),
            priority: 1,
            content: Some(format!("content-{id}")),
        }
    }

    fn create_mock_db_with_articles(rows: Vec<Model>) -> Database {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<Model, Vec<Model>, _>([rows])
            .into_connection();
        Database::from_connection(mock_db)
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
    async fn find_one_by_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection lost");

        let result = find_one_by_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_by_perek_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Database timeout");

        let result = find_by_perek_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_by_author_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Query failed");

        let result = find_by_author_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_perek_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection refused");

        let result = count_by_perek(&db).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_author_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Network error");

        let result = count_by_author_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_author_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Socket closed");

        let result = count_by_author(&db).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_perek_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Timeout");

        let result = count_by_perek_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_one_by_id_returns_not_found_when_article_does_not_exist() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = find_one_by_id(&db, 999).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert_eq!(err.to_string(), "Article Not Found");
    }

    #[tokio::test]
    async fn find_all_returns_articles_from_database() {
        let db =
            create_mock_db_with_articles(vec![article_model(1, 10, 20), article_model(2, 11, 20)]);

        let result = find_all(&db).await.expect("articles should load");

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "Article 1");
        assert_eq!(result[1].perek_id, 11);
    }

    #[tokio::test]
    async fn find_one_by_id_returns_article_when_it_exists() {
        let db = create_mock_db_with_articles(vec![article_model(7, 10, 21)]);

        let result = find_one_by_id(&db, 7).await.expect("article should load");

        assert_eq!(result.id, 7);
        assert_eq!(result.author_id, 21);
    }

    #[tokio::test]
    async fn find_by_perek_id_returns_matching_articles() {
        let db =
            create_mock_db_with_articles(vec![article_model(3, 42, 5), article_model(4, 42, 6)]);

        let result = find_by_perek_id(&db, 42)
            .await
            .expect("articles should load");

        assert_eq!(
            result.iter().map(|article| article.id).collect::<Vec<_>>(),
            vec![3, 4]
        );
    }

    #[tokio::test]
    async fn find_by_author_id_returns_matching_articles() {
        let db =
            create_mock_db_with_articles(vec![article_model(5, 42, 9), article_model(6, 43, 9)]);

        let result = find_by_author_id(&db, 9)
            .await
            .expect("articles should load");

        assert_eq!(
            result
                .iter()
                .map(|article| article.perek_id)
                .collect::<Vec<_>>(),
            vec![42, 43]
        );
    }

    #[tokio::test]
    async fn count_by_perek_maps_counts_into_the_929_slot_vector() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![
                    mock_row([("perek_id", 1_i16.into()), ("count", 2_i64.into())]),
                    mock_row([("perek_id", 929_i16.into()), ("count", 4_i64.into())]),
                    mock_row([("perek_id", 930_i16.into()), ("count", 9_i64.into())]),
                ],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = count_by_perek(&db).await.expect("counts should load");

        assert_eq!(result.len(), 929);
        assert_eq!(result[0], 2);
        assert_eq!(result[928], 4);
        assert_eq!(result.iter().sum::<i64>(), 6);
    }

    #[tokio::test]
    async fn count_by_author_returns_author_count_map() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![
                    mock_row([("author_id", 3_i16.into()), ("count", 2_i64.into())]),
                    mock_row([("author_id", 7_i16.into()), ("count", 5_i64.into())]),
                ],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = count_by_author(&db).await.expect("counts should load");

        assert_eq!(result.get(&3), Some(&2));
        assert_eq!(result.get(&7), Some(&5));
    }

    #[tokio::test]
    async fn count_by_author_id_returns_count_or_zero() {
        let db_with_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("count", 3_i64.into())])],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_author_id(&db_with_count, 9)
                .await
                .expect("count should load"),
            3
        );

        let db_without_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_author_id(&db_without_count, 9)
                .await
                .expect("missing count should become zero"),
            0
        );
    }

    #[tokio::test]
    async fn count_by_perek_id_returns_count_or_zero() {
        let db_with_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("count", 8_i64.into())])],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_perek_id(&db_with_count, 42)
                .await
                .expect("count should load"),
            8
        );

        let db_without_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_perek_id(&db_without_count, 42)
                .await
                .expect("missing count should become zero"),
            0
        );
    }
}
