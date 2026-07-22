use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::dtos::tanahpedia_family::{
    TanahpediaEntitySummary, TanahpediaEntityTanahSource, TanahpediaPersonDetail,
    TanahpediaPersonParentChildSummary, TanahpediaPersonSummary, TanahpediaPersonUnionSummary,
};
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

    /// Finds Tanahpedia entities of any type by exact display name
    /// (`PERSON`, `PLACE`, `EVENT`, `WAR`, `ANIMAL`, `OBJECT`, `TEMPLE_TOOL`,
    /// `PLANT`, `ASTRONOMICAL_OBJECT`, `SAYING`, `SEFER`, `PROPHECY`, `NATION`).
    /// Pass `entityType` to narrow the search to a single type.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_find_entities(
        &self,
        ctx: &Context<'_>,
        name: String,
        entity_type: Option<String>,
    ) -> Result<Vec<TanahpediaEntitySummary>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::find_entities(ctx.data::<Database>()?, name, entity_type)
            .await
            .map_err(|e| e.extend())
    }

    /// Lists the direct Tanah citations (perek + pasuk) attached to an entity —
    /// the "source for the entity itself", as opposed to a specific
    /// relationship's `sourceCitation` free-text field.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_entity_tanah_sources(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Vec<TanahpediaEntityTanahSource>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::get_entity_tanah_sources(ctx.data::<Database>()?, entity_id)
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

    /// Lists every parent/child link involving `personId` (as either the
    /// parent or the child side), including the other party's id/display name
    /// and the `sourceCitation` needed to review or correct that link.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_person_parent_child(
        &self,
        ctx: &Context<'_>,
        person_id: String,
    ) -> Result<Vec<TanahpediaPersonParentChildSummary>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::get_person_parent_child(ctx.data::<Database>()?, person_id)
            .await
            .map_err(|e| e.extend())
    }

    /// The full reviewable detail of a person: every name, sex, birth/death
    /// fact, and entity-level Tanah citation.
    ///
    /// Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_person_details(
        &self,
        ctx: &Context<'_>,
        person_id: String,
    ) -> Result<TanahpediaPersonDetail> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;

        tanahpedia_family_service::get_person_details(ctx.data::<Database>()?, person_id)
            .await
            .map_err(|e| e.extend())
    }
}
