use crate::{
    common::error_handling::{ServiceError, INTERNAL_SERVER_ERROR},
    providers::Database,
};
use entities::sefer::{Entity, Model};
use sea_orm::{DbErr, EntityTrait};

pub async fn find_one_by_id(db: &Database, id: i32) -> Result<Model, ServiceError> {
    tracing::info_span!("sefarim_service::find_one_by_id", %id);
    let sefer = Entity::find_by_id(id)
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    pub const SEFER_NOT_FOUND: &str = "Sefer Not Found";
    match sefer {
        Some(value) => {
            tracing::info!("Sefer found");
            Ok(value)
        }
        None => Err(ServiceError::not_found(SEFER_NOT_FOUND, None::<DbErr>)),
    }
}

pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("sefarim_service::find_all");
    let sefarim = Entity::find()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} sefarim", sefarim.len());
    Ok(sefarim)
}
