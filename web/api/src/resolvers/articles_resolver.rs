use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::article::Article;
use crate::providers::Database;
use crate::services::articles_service;

#[derive(Default)]
pub struct ArticlesQuery;

#[Object]
impl ArticlesQuery {
    /// Get an article by its ID
    async fn article_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Article> {
        Ok(
            articles_service::find_one_by_id(ctx.data::<Database>()?, id)
                .await
                .map_err(|e| e.extend())?
                .into(),
        )
    }

    /// Get all articles for a specific perek
    async fn articles_by_perek_id(&self, ctx: &Context<'_>, perek_id: i32) -> Result<Vec<Article>> {
        Ok(
            articles_service::find_by_perek_id(ctx.data::<Database>()?, perek_id)
                .await
                .map_err(|e| e.extend())?
                .into_iter()
                .map(Into::into)
                .collect(),
        )
    }

    /// Get all articles by a specific author
    async fn articles_by_author_id(
        &self,
        ctx: &Context<'_>,
        author_id: i32,
    ) -> Result<Vec<Article>> {
        Ok(
            articles_service::find_by_author_id(ctx.data::<Database>()?, author_id)
                .await
                .map_err(|e| e.extend())?
                .into_iter()
                .map(Into::into)
                .collect(),
        )
    }
}
