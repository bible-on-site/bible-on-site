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
