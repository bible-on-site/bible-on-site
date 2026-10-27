use async_graphql::{Context, ErrorExtensions, Object, Result};
use chrono::Utc;

use crate::common::auth::ApiAuth;
use crate::dtos::dedication::{
    CreateDedicationInput, Dedication, DedicationContextInput, UpdateDedicationInput,
};
use crate::providers::Database;
use crate::services::dedications_service::{self, DedicationContext};

#[derive(Default)]
pub struct DedicationsQuery;

fn context_of(input: DedicationContextInput) -> DedicationContext {
    DedicationContext {
        perek_ids: input.perek_ids.unwrap_or_default(),
        sefer_ids: input.sefer_ids.unwrap_or_default(),
        helek_ids: input.helek_ids.unwrap_or_default(),
        parasha_ids: input.parasha_ids.unwrap_or_default(),
        entry_ids: input.entry_ids.unwrap_or_default(),
        article_ids: input.article_ids.unwrap_or_default(),
        masora: input.masora.unwrap_or(false),
    }
}

#[Object]
impl DedicationsQuery {
    /// Active dedications applicable to a reading context (#2731). Pass every
    /// identity the context carries; perek → sefer → helek ancestors resolve
    /// inside the API. Expired assignments are excluded.
    async fn dedications(
        &self,
        ctx: &Context<'_>,
        context: DedicationContextInput,
    ) -> Result<Vec<Dedication>> {
        Ok(dedications_service::resolve(
            ctx.data::<Database>()?,
            context_of(context),
            Utc::now().naive_utc(),
        )
        .await
        .map_err(|e| e.extend())?
        .into_iter()
        .map(Into::into)
        .collect())
    }

    /// Every dedication with every assignment, including expired — management
    /// view. Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn dedications_admin(&self, ctx: &Context<'_>) -> Result<Vec<Dedication>> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(dedications_service::list_all(ctx.data::<Database>()?)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect())
    }
}

#[derive(Default)]
pub struct DedicationsMutation;

#[Object]
impl DedicationsMutation {
    /// Creates a dedication with purposes and validated targets.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn create_dedication(
        &self,
        ctx: &Context<'_>,
        input: CreateDedicationInput,
    ) -> Result<Dedication> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(dedications_service::create(
            ctx.data::<Database>()?,
            input.subject,
            input.expires_at,
            input.purpose_type_ids.unwrap_or_default(),
            input.targets.unwrap_or_default(),
        )
        .await
        .map_err(|e| e.extend())?
        .into())
    }

    /// Updates subject/expiry and optionally replaces the purpose and target
    /// sets of a dedication, atomically.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn update_dedication(
        &self,
        ctx: &Context<'_>,
        id: i32,
        input: UpdateDedicationInput,
    ) -> Result<Dedication> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        Ok(
            dedications_service::update(ctx.data::<Database>()?, id, input)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }

    /// Deletes a dedication and all its assignments. Returns false when the
    /// id did not exist.
    /// Requires `Authorization: Bearer <DEDICATION_API_KEY>`.
    async fn delete_dedication(&self, ctx: &Context<'_>, id: i32) -> Result<bool> {
        ctx.data::<ApiAuth>()?
            .authorize_dedication_manager()
            .map_err(|e| e.extend())?;
        dedications_service::remove(ctx.data::<Database>()?, id)
            .await
            .map_err(|e| e.extend())
    }
}
