//! Image galleries for Tanahpedia entries/entities (#3769).
//!
//! Public reads surface only `is_public` assets through the two scope queries
//! and the `images`/`entityImages` complex fields on `TanahpediaEntryDetail`.
//! The editor surface — full asset records including the private
//! `permissionEvidence`, unpublished links, and every mutation — sits behind
//! the same `TANAHPEDIA_REVISION_API_KEY` scope as the other Tanahpedia write
//! operations (family links, alias writes).

use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::dtos::tanahpedia_images::{
    TanahpediaEntityImageLinkInput, TanahpediaEntryImageLinkInput, TanahpediaImageAsset,
    TanahpediaImageAssetInput, TanahpediaImageLink, TanahpediaImageLinkFull,
};
use crate::providers::Database;
use crate::services::tanahpedia_images_service;

#[derive(Default)]
pub struct TanahpediaImagesQuery;

#[Object]
impl TanahpediaImagesQuery {
    /// Public image links attached to an entry (`is_public` assets only,
    /// ordered by `sortOrder`). Reads as empty while the additive schema
    /// deploy is pending.
    async fn tanahpedia_entry_images(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entry_images(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Public image links attached directly to an entity (`is_public` assets
    /// only) — the entity node gallery, e.g. a person's portraits.
    async fn tanahpedia_entity_images(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entity_images(ctx.data::<Database>()?, &entity_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Editor listing of an entry's image links: unpublished assets included
    /// and the full provenance fields (`permissionEvidence`, `isPublic`)
    /// exposed. Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>`
    /// header.
    async fn tanahpedia_entry_image_links(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<Vec<TanahpediaImageLinkFull>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_entry_image_links_editor(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Editor listing of an entity's image links — see
    /// `tanahpediaEntryImageLinks`. Requires the same authorization.
    async fn tanahpedia_entity_image_links(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Vec<TanahpediaImageLinkFull>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_entity_image_links_editor(
            ctx.data::<Database>()?,
            &entity_id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// One image asset record with its private editorial fields — for the
    /// authorized editor's credit/provenance form. Requires the same
    /// `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_image_asset(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<Option<TanahpediaImageAsset>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_image_asset(ctx.data::<Database>()?, &id)
            .await
            .map_err(|e| e.extend())
    }
}

#[derive(Default)]
pub struct TanahpediaImagesMutation;

#[Object]
impl TanahpediaImagesMutation {
    /// Create or update an image asset — `input.id` null creates, otherwise
    /// the existing row is updated. Publishing (`isPublic: true`) requires
    /// recorded permission/public-domain evidence. Requires an
    /// `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn put_tanahpedia_image_asset(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaImageAssetInput,
    ) -> Result<TanahpediaImageAsset> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_image_asset(ctx.data::<Database>()?, input)
            .await
            .map_err(|e| e.extend())
    }

    /// Delete an image asset; its entity/entry links cascade away with it.
    /// Returns whether a row was removed. Same authorization as the other
    /// Tanahpedia mutations.
    async fn delete_tanahpedia_image_asset(&self, ctx: &Context<'_>, id: String) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::delete_image_asset(ctx.data::<Database>()?, &id)
            .await
            .map_err(|e| e.extend())
    }

    /// Attach an image to an entity or update an existing link's
    /// order/primary flag (`input.id` selects the update path). Setting
    /// `isPrimary` clears the entity's other primary links atomically.
    async fn put_tanahpedia_entity_image_link(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaEntityImageLinkInput,
    ) -> Result<TanahpediaImageLinkFull> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_entity_image_link(ctx.data::<Database>()?, input)
            .await
            .map_err(|e| e.extend())
    }

    /// Attach an image to an entry or update an existing link's
    /// order/primary flag — see `putTanahpediaEntityImageLink`.
    async fn put_tanahpedia_entry_image_link(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaEntryImageLinkInput,
    ) -> Result<TanahpediaImageLinkFull> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_entry_image_link(ctx.data::<Database>()?, input)
            .await
            .map_err(|e| e.extend())
    }

    /// Remove one entity-image link. Returns whether a row was removed.
    async fn remove_tanahpedia_entity_image_link(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::remove_entity_image_link(ctx.data::<Database>()?, &id)
            .await
            .map_err(|e| e.extend())
    }

    /// Remove one entry-image link. Returns whether a row was removed.
    async fn remove_tanahpedia_entry_image_link(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::remove_entry_image_link(ctx.data::<Database>()?, &id)
            .await
            .map_err(|e| e.extend())
    }

    /// Clear the entity's primary-image flag — the explicit "no primary"
    /// state. Returns whether any link was flagged.
    async fn clear_tanahpedia_entity_primary_image(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::clear_entity_primary_image(ctx.data::<Database>()?, &entity_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Clear the entry's primary-image flag — see
    /// `clearTanahpediaEntityPrimaryImage`.
    async fn clear_tanahpedia_entry_primary_image(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::clear_entry_primary_image(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }
}
