use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::author::Author;
use crate::providers::Database;
use crate::services::authors_service;

#[derive(Default)]
pub struct AuthorsQuery;

#[Object]
impl AuthorsQuery {
    /// Get an author by their ID
    async fn author_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Author> {
        Ok(authors_service::find_one_by_id(ctx.data::<Database>()?, id)
            .await
            .map_err(|e| e.extend())?
            .into())
    }
}
