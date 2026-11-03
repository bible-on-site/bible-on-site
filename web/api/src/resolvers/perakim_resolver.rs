use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::perek::Perek;
use crate::providers::Database;
use crate::services::{perakim_service, reading_metrics_service};

#[derive(Default)]
pub struct PerakimQuery;

/// Batch-attach persisted reading metrics keyed by canonical perek id — one
/// IN query regardless of list size, so selecting `readingMetric` on the
/// 929-row `perakim` list never becomes N+1 (issue #2607).
async fn attach_perek_reading_metrics(db: &Database, perakim: &mut [Perek]) -> Result<()> {
    let ids: Vec<i32> = perakim.iter().filter_map(|perek| perek.perek_id).collect();
    let metrics = reading_metrics_service::metrics_by_perek_ids(db, &ids)
        .await
        .map_err(|e| e.extend())?;
    for perek in perakim.iter_mut() {
        if let Some(perek_id) = perek.perek_id {
            perek.reading_metric = metrics.get(&perek_id).cloned().map(Into::into);
        }
    }
    Ok(())
}

#[Object]
impl PerakimQuery {
    /// Get a perek by its perek ID (1-929)
    async fn perek_by_perek_id(&self, ctx: &Context<'_>, perek_id: i32) -> Result<Perek> {
        let db = ctx.data::<Database>()?;
        let mut perek = Perek::from(
            perakim_service::find_one_by_perek_id(db, perek_id)
                .await
                .map_err(|e| e.extend())?,
        );
        attach_perek_reading_metrics(db, std::slice::from_mut(&mut perek)).await?;
        Ok(perek)
    }

    /// Get all perakim (chapters) in the 929 project
    async fn perakim(&self, ctx: &Context<'_>) -> Result<Vec<Perek>> {
        let db = ctx.data::<Database>()?;
        let mut perakim: Vec<Perek> = perakim_service::find_all(db)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        attach_perek_reading_metrics(db, &mut perakim).await?;
        Ok(perakim)
    }

    /// Get all perakim for a specific sefer
    async fn perakim_by_sefer_id(&self, ctx: &Context<'_>, sefer_id: i32) -> Result<Vec<Perek>> {
        let db = ctx.data::<Database>()?;
        let mut perakim: Vec<Perek> = perakim_service::find_by_sefer_id(db, sefer_id)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        attach_perek_reading_metrics(db, &mut perakim).await?;
        Ok(perakim)
    }
}
