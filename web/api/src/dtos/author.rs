use async_graphql::{ComplexObject, Context, Result, SimpleObject};

use crate::{providers::Database, services::articles_service};
use entities::author::Model;

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Author {
    pub id: i32,
    pub name: String,
    pub details: String,
    /// Pre-computed articles count (used by starter query to avoid N+1)
    /// When None, the count will be computed on-demand via the computed field
    #[graphql(skip)]
    pub precomputed_articles_count: Option<i64>,
}

impl From<Model> for Author {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            details: value.details,
            precomputed_articles_count: None,
        }
    }
}

impl Author {
    /// Create an Author with a pre-computed articles count
    pub fn with_articles_count(model: Model, count: i64) -> Self {
        Self {
            id: model.id,
            name: model.name,
            details: model.details,
            precomputed_articles_count: Some(count),
        }
    }
}

#[ComplexObject]
impl Author {
    /// Returns the count of articles written by this author
    #[graphql(name = "articlesCount")]
    async fn articles_count(&self, ctx: &Context<'_>) -> Result<i64> {
        // Use pre-computed count if available (from starter query)
        if let Some(count) = self.precomputed_articles_count {
            return Ok(count);
        }
        // Otherwise compute on-demand (for individual author queries)
        let db = ctx.data::<Database>()?;
        let count = articles_service::count_by_author_id(db, self.id).await?;
        Ok(count)
    }
}
