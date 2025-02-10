use async_graphql::{Context, Object, Result};

use crate::dtos::author::Author;
// use crate:dtos::inputs::CreateAuthor;
use crate::providers::Database;
use crate::services::authors_service;

#[derive(Default)]
pub struct AuthorsQuery;

// #[derive(Default)]
// pub struct AuthorsMutation;

#[Object]
impl AuthorsQuery {
    async fn author_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Author> {
        Ok(authors_service::find_one_by_id(ctx.data::<Database>()?, id)
            .await?
            .into())
    }
}
