use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::article::{Column, Entity, Model};
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter};

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
