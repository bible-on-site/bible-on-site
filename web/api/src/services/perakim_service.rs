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
