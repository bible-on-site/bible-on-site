use async_graphql::{ComplexObject, Context, ErrorExtensions, Result, SimpleObject};

use crate::{
    dtos::reading_metric::{ReadingMetric, ReadingProgressUnit},
    providers::Database,
    services::{articles_service, reading_metrics_service},
};
use entities::article::Model;

/// One canonical {perek_id, pasuk} coordinate an article covers
/// (tanah_article_covering_source). Meaningful for readers only when the
/// article's coverageVerified is true — see Article.coverage_verified.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleCoveringSource {
    /// Canonical perek id (1-929).
    pub perek_id: i32,
    /// 1-based pasuk within the perek.
    pub pasuk: i32,
}

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Article {
    pub id: i32,
    pub perek_id: i32,
    pub author_id: i32,
    /// The article abstract (HTML content)
    #[graphql(name = "abstract")]
    pub article_abstract: Option<String>,
    /// The full article content (HTML)
    #[graphql(name = "articleContent")]
    pub article_content: Option<String>,
    pub name: String,
    pub priority: i32,
    /// TRUE: coveringSources is the article's verified verse-level coverage
    /// and drives verse/range lookups. FALSE: detailed coverage is unknown —
    /// consumers use the primary perek association without claiming pasuk
    /// precision (legacy articles whose coverage was never mapped).
    pub coverage_verified: bool,
    /// Shared persisted reading metrics over the full article body — not the
    /// abstract (issue #2607). `null` = unknown/not computed; a populated
    /// metric with wordCount 0 = verified empty body.
    pub reading_metric: Option<ReadingMetric>,
    /// Covering sources preloaded by list resolvers in one batched query —
    /// `None` means they were not preloaded and resolve on demand
    /// (single-article fields), `Some` is authoritative (possibly empty).
    #[graphql(skip)]
    pub covering_sources: Option<Vec<ArticleCoveringSource>>,
}

impl From<Model> for Article {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            perek_id: value.perek_id as i32,
            author_id: value.author_id as i32,
            article_abstract: value.article_abstract,
            article_content: value.content,
            name: value.name,
            priority: value.priority as i32,
            coverage_verified: value.coverage_verified,
            reading_metric: None,
            covering_sources: None,
        }
    }
}

impl From<articles_service::ArticleSummary> for Article {
    fn from(value: articles_service::ArticleSummary) -> Self {
        Self {
            id: value.id,
            perek_id: value.perek_id as i32,
            author_id: value.author_id as i32,
            article_abstract: value.article_abstract,
            // Starter rows project out `content`; bodies load via `article(id)`.
            article_content: None,
            name: value.name,
            priority: value.priority as i32,
            coverage_verified: value.coverage_verified,
            reading_metric: None,
            covering_sources: None,
        }
    }
}

#[ComplexObject]
impl Article {
    /// The article's persisted covering sources, ordered by coordinate.
    /// The set may span several perakim. An empty list means no pesukim are
    /// mapped — interpret it through coverage_verified (verified-empty is
    /// rejected on write, so empty + verified does not occur in practice).
    async fn covering_sources(&self, ctx: &Context<'_>) -> Result<Vec<ArticleCoveringSource>> {
        if let Some(sources) = &self.covering_sources {
            return Ok(sources.clone());
        }
        let sources =
            articles_service::find_covering_sources_by_article_id(ctx.data::<Database>()?, self.id)
                .await?;
        Ok(sources
            .into_iter()
            .map(|model| ArticleCoveringSource {
                perek_id: model.perek_id,
                pasuk: model.pasuk as i32,
            })
            .collect())
    }

    /// Ordered readable-block units over the article body for word-weighted
    /// reading-position progress (issue #2607). Resolved only when selected —
    /// list queries never pay for it. Empty when uncomputed.
    async fn progress_units(&self, ctx: &Context<'_>) -> Result<Vec<ReadingProgressUnit>> {
        let units =
            reading_metrics_service::block_units_by_article_id(ctx.data::<Database>()?, self.id)
                .await
                .map_err(|e| e.extend())?;
        Ok(units.into_iter().map(Into::into).collect())
    }
}

/// One ranked hit of the semantic article-content search. Excerpts are plain
/// text — markup is stripped server-side — so clients can render them
/// directly without HTML handling.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleSearchHit {
    /// The matching article's ID (deep-link target).
    pub article_id: i32,
    /// Article title.
    pub name: String,
    /// Author display name when resolvable.
    pub author_name: Option<String>,
    pub author_id: i32,
    /// Perek the article is attached to.
    pub perek_id: i32,
    /// Human-readable source label, e.g. "בראשית א".
    pub source: Option<String>,
    /// Article abstract (HTML), when present.
    #[graphql(name = "abstract")]
    pub article_abstract: Option<String>,
    /// Plain-text excerpt around the strongest matching window.
    pub excerpt: String,
    /// Combined semantic + lexical relevance score in (0, 1].
    pub score: f32,
    /// Semantic (latent-space cosine) component of `score`.
    pub semantic_score: f32,
    /// Lexical (term-frequency) component of `score`.
    pub lexical_score: f32,
    /// Shared persisted reading metrics over the full article body — filled
    /// by the resolver via one batched lookup (issue #2607).
    pub reading_metric: Option<ReadingMetric>,
}

/// Paginated article-search response: `total` counts all matching articles
/// before `limit`/`offset` slicing.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleSearchResults {
    pub total: i32,
    pub hits: Vec<ArticleSearchHit>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::article_covering_source;
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn article() -> Article {
        Article {
            id: 1,
            perek_id: 1,
            author_id: 1,
            article_abstract: None,
            article_content: None,
            name: "Article".to_string(),
            priority: 1,
            coverage_verified: false,
            reading_metric: None,
            covering_sources: None,
        }
    }

    /// An article with preloaded sources answers `coveringSources` without
    /// touching the database — the list path batch-loads them in one query.
    #[tokio::test]
    async fn covering_sources_returns_the_preloaded_sources_without_a_db_query() {
        struct Query;
        #[async_graphql::Object]
        impl Query {
            async fn article(&self) -> Article {
                Article {
                    covering_sources: Some(vec![ArticleCoveringSource {
                        perek_id: 3,
                        pasuk: 1,
                    }]),
                    ..article()
                }
            }
        }
        let schema = async_graphql::Schema::build(
            Query,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .finish();

        let res = schema
            .execute("{ article { coveringSources { perekId pasuk } } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let sources = res.data.into_json().unwrap()["article"]["coveringSources"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0]["perekId"].as_i64(), Some(3));
        assert_eq!(sources[0]["pasuk"].as_i64(), Some(1));
    }

    /// An article without preloaded sources falls back to the per-article
    /// query — the single-article path (`articleById`).
    #[tokio::test]
    async fn covering_sources_falls_back_to_a_db_query_when_not_preloaded() {
        struct Query;
        #[async_graphql::Object]
        impl Query {
            async fn article(&self) -> Article {
                article()
            }
        }
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    article_covering_source::Model {
                        article_id: 1,
                        perek_id: 3,
                        pasuk: 1,
                        created_at: chrono::Utc::now(),
                    },
                ]])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            Query,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();

        let res = schema
            .execute("{ article { coveringSources { perekId pasuk } } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let sources = res.data.into_json().unwrap()["article"]["coveringSources"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0]["perekId"].as_i64(), Some(3));
        assert_eq!(sources[0]["pasuk"].as_i64(), Some(1));
    }
}
