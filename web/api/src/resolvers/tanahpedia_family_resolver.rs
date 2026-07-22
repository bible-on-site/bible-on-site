use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::dtos::tanahpedia_family::{TanahpediaPersonSummary, TanahpediaPersonUnionSummary};
use crate::providers::Database;
use crate::services::tanahpedia_family_service;

#[derive(Default)]
pub struct TanahpediaFamilyQuery;

#[Object]
impl TanahpediaFamilyQuery {
    /// Finds Tanahpedia `PERSON` entities by exact display name.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    /// Returns every match, since Torah names are frequently shared by more than
    /// one entity — callers must disambiguate using the returned `entityId`.
    async fn tanahpedia_find_persons(
        &self,
        ctx: &Context<'_>,
        name: String,
    ) -> Result<Vec<TanahpediaPersonSummary>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::find_persons_by_name(ctx.data::<Database>()?, name)
            .await
            .map_err(|e| e.extend())
    }

    /// Lists every union (marriage/pilegesh/betrothal/etc.) link involving
    /// `personId`, including the other party's id/display name and the
    /// `sourceCitation` needed to review or correct that link.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_person_unions(
        &self,
        ctx: &Context<'_>,
        person_id: String,
    ) -> Result<Vec<TanahpediaPersonUnionSummary>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::get_person_unions(ctx.data::<Database>()?, person_id)
            .await
            .map_err(|e| e.extend())
    }
}
