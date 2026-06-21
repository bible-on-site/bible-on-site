use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::dtos::tanahpedia_entry_revision::{EntryRevision, SubmitEntryRevisionInput};
use crate::providers::Database;
use crate::services::tanahpedia_revisions_service;

#[derive(Default)]
pub struct TanahpediaRevisionsQuery;

#[Object]
impl TanahpediaRevisionsQuery {
    /// List Tanahpedia entry revisions (newest first) for human triage,
    /// optionally filtered by `status` (PENDING / APPROVED / REJECTED) and/or the
    /// targeted `entryId`.
    async fn tanahpedia_entry_revisions(
        &self,
        ctx: &Context<'_>,
        status: Option<String>,
        entry_id: Option<String>,
    ) -> Result<Vec<EntryRevision>> {
        Ok(
            tanahpedia_revisions_service::find_revisions(ctx.data::<Database>()?, status, entry_id)
                .await
                .map_err(|e| e.extend())?
                .into_iter()
                .map(Into::into)
                .collect(),
        )
    }
}

#[derive(Default)]
pub struct TanahpediaRevisionsMutation;

#[Object]
impl TanahpediaRevisionsMutation {
    /// Submit a revision to a Tanahpedia entry from an external AI client.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    /// The revision is stored with status `PENDING` for human triage and is never
    /// auto-applied to the live entry.
    async fn submit_entry_revision(
        &self,
        ctx: &Context<'_>,
        input: SubmitEntryRevisionInput,
    ) -> Result<EntryRevision> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_submitter()
            .map_err(|e| e.extend())?;

        Ok(
            tanahpedia_revisions_service::create_revision(ctx.data::<Database>()?, input)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }
}
