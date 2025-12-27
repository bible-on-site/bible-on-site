use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::sefer::Sefer;
use crate::providers::Database;
use crate::services::sefarim_service;

#[derive(Default)]
pub struct SefarimQuery;

#[Object]
impl SefarimQuery {
    /// Get a sefer by its ID
    async fn sefer_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Sefer> {
        Ok(sefarim_service::find_one_by_id(ctx.data::<Database>()?, id)
            .await
            .map_err(|e| e.extend())?
            .into())
    }

    /// Get all sefarim (books of the Tanah)
    async fn sefarim(&self, ctx: &Context<'_>) -> Result<Vec<Sefer>> {
        Ok(sefarim_service::find_all(ctx.data::<Database>()?)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect())
    }
}
