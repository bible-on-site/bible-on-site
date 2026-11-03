use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::article::Article;
use crate::dtos::author::Author;
use crate::dtos::starter::Starter;
use crate::providers::Database;
use crate::services::{articles_service, authors_service};

#[derive(Default)]
pub struct StarterQuery;

#[Object]
impl StarterQuery {
    /// Get starter data including all authors, all articles, and article counts per perek
    async fn starter(&self, ctx: &Context<'_>) -> Result<Starter> {
        let db = ctx.data::<Database>()?;

        // Fetch authors and articles (starter fields only — no full HTML content)
        let authors = authors_service::find_all(db)
            .await
            .map_err(|e| e.extend())?;

        let article_summaries = articles_service::find_all_without_content(db)
            .await
            .map_err(|e| e.extend())?;

        // Counts derive from the rows already fetched — no extra aggregate scans
        let author_article_counts = articles_service::count_by_author(&article_summaries);
        let perek_articles_counters = articles_service::count_by_perek(&article_summaries);

        // Map authors with their pre-computed article counts
        let authors_with_counts: Vec<Author> = authors
            .into_iter()
            .map(|model| {
                let count = author_article_counts.get(&model.id).copied().unwrap_or(0);
                Author::with_articles_count(model, count)
            })
            .collect();

        // Convert articles to DTOs, then batch-attach reading metrics — one
        // IN query so `readingMetric` on the starter list stays O(1) (#2607).
        let mut articles: Vec<Article> = article_summaries.into_iter().map(Article::from).collect();
        super::articles_resolver::attach_article_reading_metrics(db, &mut articles).await?;

        Ok(Starter {
            authors: authors_with_counts,
            articles,
            perek_articles_counters,
        })
    }
}
