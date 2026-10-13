use async_graphql::{ComplexObject, Context, Result, SimpleObject};

use crate::{providers::Database, services::articles_service};
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
}

/// Paginated article-search response: `total` counts all matching articles
/// before `limit`/`offset` slicing.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleSearchResults {
    pub total: i32,
    pub hits: Vec<ArticleSearchHit>,
}
