use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::author::{Entity, Model};
use sea_orm::{DbErr, EntityTrait};

pub async fn find_one_by_id(db: &Database, id: i32) -> Result<Model, ServiceError> {
    tracing::info_span!("authors_service::find_one_by_id", %id);
    let user = Entity::find_by_id(id)
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    const AUTHOR_NOT_FOUND: &str = "Author Not Found";
    match user {
        Some(value) => {
            tracing::info!("Author found");
            Ok(value)
        }
        // Not sure about this anyhow::Error, might be of different used module
        None => Err(ServiceError::not_found(AUTHOR_NOT_FOUND, None::<DbErr>)),
    }
}

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
