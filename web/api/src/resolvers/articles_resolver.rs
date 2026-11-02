use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::article::{Article, ArticleSearchResults};
use crate::providers::Database;
use crate::services::article_search::ArticleSearchIndex;
use crate::services::{articles_service, reading_metrics_service};

#[derive(Default)]
pub struct ArticlesQuery;

/// Batch-attach persisted reading metrics to emitted articles — one IN query
/// regardless of list size, so selecting `readingMetric` on a list never
/// becomes N+1 (issue #2607).
pub(crate) async fn attach_article_reading_metrics(
    db: &Database,
    articles: &mut [Article],
) -> Result<()> {
    let ids: Vec<i32> = articles.iter().map(|article| article.id).collect();
    let metrics = reading_metrics_service::metrics_by_article_ids(db, &ids)
        .await
        .map_err(|e| e.extend())?;
    for article in articles.iter_mut() {
        article.reading_metric = metrics.get(&article.id).cloned().map(Into::into);
    }
    Ok(())
}

#[Object]
impl ArticlesQuery {
    /// Semantically searches public article content (Hebrew-aware). Returns
    /// ranked hits with safe plain-text excerpts; requires network access
    /// from clients — the index is API-side.
    async fn search_articles(
        &self,
        ctx: &Context<'_>,
        phrase: String,
        limit: Option<i32>,
        offset: Option<i32>,
        author_id: Option<i32>,
    ) -> Result<ArticleSearchResults> {
        let db = ctx.data::<Database>()?;
        let mut results = articles_service::search_articles(
            db,
            ctx.data::<ArticleSearchIndex>()?,
            &phrase,
            limit,
            offset,
            author_id,
        )
        .await
        .map_err(|e| e.extend())?;
        // One batched lookup so hit lists can render the same estimate badges
        // as every other article list (issue #2607).
        let ids: Vec<i32> = results.hits.iter().map(|hit| hit.article_id).collect();
        let metrics = reading_metrics_service::metrics_by_article_ids(db, &ids)
            .await
            .map_err(|e| e.extend())?;
        for hit in results.hits.iter_mut() {
            hit.reading_metric = metrics.get(&hit.article_id).cloned().map(Into::into);
        }
        Ok(results)
    }

    /// Get an article by its ID
    async fn article_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Article> {
        let db = ctx.data::<Database>()?;
        let mut article = Article::from(
            articles_service::find_one_by_id(db, id)
                .await
                .map_err(|e| e.extend())?,
        );
        attach_article_reading_metrics(db, std::slice::from_mut(&mut article)).await?;
        Ok(article)
    }

    /// Get all articles for a specific perek
    async fn articles_by_perek_id(&self, ctx: &Context<'_>, perek_id: i32) -> Result<Vec<Article>> {
        let db = ctx.data::<Database>()?;
        let mut articles: Vec<Article> = articles_service::find_by_perek_id(db, perek_id)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        attach_article_reading_metrics(db, &mut articles).await?;
        Ok(articles)
    }

    /// Get all articles by a specific author
    async fn articles_by_author_id(
        &self,
        ctx: &Context<'_>,
        author_id: i32,
    ) -> Result<Vec<Article>> {
        let db = ctx.data::<Database>()?;
        let mut articles: Vec<Article> = articles_service::find_by_author_id(db, author_id)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        attach_article_reading_metrics(db, &mut articles).await?;
        Ok(articles)
    }
}
