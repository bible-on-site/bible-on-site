use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::perek::Perek;
use crate::providers::Database;
use crate::services::perakim_service;

#[derive(Default)]
pub struct PerakimQuery;

#[Object]
impl PerakimQuery {
    /// Get a perek by its perek ID (1-929)
    async fn perek_by_perek_id(&self, ctx: &Context<'_>, perek_id: i32) -> Result<Perek> {
        Ok(
            perakim_service::find_one_by_perek_id(ctx.data::<Database>()?, perek_id)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }

    /// Get all perakim (chapters) in the 929 project
    async fn perakim(&self, ctx: &Context<'_>) -> Result<Vec<Perek>> {
        Ok(perakim_service::find_all(ctx.data::<Database>()?)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Get all perakim for a specific sefer
    async fn perakim_by_sefer_id(&self, ctx: &Context<'_>, sefer_id: i32) -> Result<Vec<Perek>> {
        Ok(
            perakim_service::find_by_sefer_id(ctx.data::<Database>()?, sefer_id)
                .await
                .map_err(|e| e.extend())?
                .into_iter()
                .map(Into::into)
                .collect(),
        )
    }
}
