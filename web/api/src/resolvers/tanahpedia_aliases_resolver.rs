use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::common::website_revalidate::WebsiteRevalidator;
use crate::dtos::tanahpedia_aliases::{
    SaveTanahpediaAliasInput, TanahpediaAliasRemovalResult, TanahpediaAliasSaveResult,
    TanahpediaEntryAlias, TanahpediaNameStatus,
};
use crate::providers::Database;
use crate::services::tanahpedia_aliases_service;

#[derive(Default)]
pub struct TanahpediaAliasesQuery;

#[derive(Default)]
pub struct TanahpediaAliasesMutation;

#[Object]
impl TanahpediaAliasesQuery {
    /// Live status of a candidate Tanahpedia public address name — the same
    /// evaluation the admin editor runs (`checkPediaName`): `free` |
    /// `invalid` | `reserved` | `self-main` | `canonical` | `alias`.
    /// `forEntryId` is the entry being edited when the check is for its own
    /// main address field.
    async fn tanahpedia_name_status(
        &self,
        ctx: &Context<'_>,
        name: String,
        for_entry_id: Option<String>,
    ) -> Result<TanahpediaNameStatus> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_aliases_service::get_name_status(
            ctx.data::<Database>()?,
            &name,
            for_entry_id.as_deref(),
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Alias/disambiguation names this entry is a target of, with the same
    /// management context the admin editor shows (kind, all targets, canonical
    /// shadowing, reserved-route collisions).
    async fn tanahpedia_entry_aliases(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<Vec<TanahpediaEntryAlias>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_aliases_service::get_entry_aliases(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }
}

#[Object]
impl TanahpediaAliasesMutation {
    /// Atomically replaces the target set of an address name: one target
    /// writes a plain alias (redirect), several write a disambiguation page
    /// (a distinguishing label is then required on every target). Rejects
    /// reserved category names, names already owned as another entry's
    /// canonical `unique_name`, and saves whose `expectedTargets` snapshot no
    /// longer matches the stored set (a concurrent writer won).
    /// `result.revalidation` is the post-commit website invalidation outcome:
    /// `APPLIED` | `FAILED` | `SKIPPED` (not configured). A `FAILED` write is
    /// already committed — re-save to retry invalidation.
    async fn save_tanahpedia_alias(
        &self,
        ctx: &Context<'_>,
        input: SaveTanahpediaAliasInput,
    ) -> Result<TanahpediaAliasSaveResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_aliases_service::save_alias(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            input,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Removes one entry's association from an address name — other entries'
    /// associations are never touched. When a single target remains the
    /// leftover label rows are dropped (a plain alias shows no distinguishing
    /// text anyway). See `saveTanahpediaAlias` for the `revalidation`
    /// contract.
    async fn remove_tanahpedia_entry_from_alias(
        &self,
        ctx: &Context<'_>,
        name: String,
        entry_id: String,
    ) -> Result<TanahpediaAliasRemovalResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_aliases_service::remove_entry_from_alias(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &name,
            &entry_id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Deletes an address name entirely — every entry's association with it —
    /// and invalidates the removed targets' pages.
    async fn delete_tanahpedia_alias(
        &self,
        ctx: &Context<'_>,
        name: String,
    ) -> Result<TanahpediaAliasRemovalResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_aliases_service::delete_alias(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &name,
        )
        .await
        .map_err(|e| e.extend())
    }
}
