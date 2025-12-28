use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::author::Author;
use crate::dtos::starter::Starter;
use crate::providers::Database;
use crate::services::{articles_service, authors_service};

#[derive(Default)]
pub struct StarterQuery;

#[Object]
impl StarterQuery {
    /// Get starter data including all authors and article counts per perek
    async fn starter(&self, ctx: &Context<'_>) -> Result<Starter> {
        let db = ctx.data::<Database>()?;

        let authors = authors_service::find_all(db)
            .await
            .map_err(|e| e.extend())?;

        let perek_articles_counters = articles_service::count_by_perek(db)
            .await
            .map_err(|e| e.extend())?;

        Ok(Starter {
            authors: authors.into_iter().map(Author::from).collect(),
            perek_articles_counters,
        })
    }
}
