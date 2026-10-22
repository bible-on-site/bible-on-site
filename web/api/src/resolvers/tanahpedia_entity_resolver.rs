use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::tanahpedia_entity::{TanahpediaPersonFamily, TanahpediaPlaceMarker};
use crate::providers::Database;
use crate::services::tanahpedia_entity_service;

#[derive(Default)]
pub struct TanahpediaEntityQuery;

/// Public read surface for entity-level Tanahpedia data — the relationship
/// and place information rendered on `/pedia` person/place entry pages.
#[Object]
impl TanahpediaEntityQuery {
    /// Parents, children, spouses and siblings of a `PERSON` entity with their
    /// source citations — powers the family section on person entries.
    /// `entityId` is the `tanahpedia_entity.id` of the person (as returned in
    /// `tanahpediaEntry.entities`). `None` when the entity is not a person or
    /// has no family data.
    async fn tanahpedia_person_family(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Option<TanahpediaPersonFamily>> {
        tanahpedia_entity_service::get_person_family(ctx.data::<Database>()?, &entity_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Place identification pins for the places map (OpenStreetMap tiles — no
    /// API key). Without `entryId` every identified place is returned (the
    /// PLACE category map); with it, only the `PLACE` entities linked to that
    /// entry (the entry-page map).
    async fn tanahpedia_place_markers(
        &self,
        ctx: &Context<'_>,
        entry_id: Option<String>,
    ) -> Result<Vec<TanahpediaPlaceMarker>> {
        tanahpedia_entity_service::get_place_markers(ctx.data::<Database>()?, entry_id.as_deref())
            .await
            .map_err(|e| e.extend())
    }
}
