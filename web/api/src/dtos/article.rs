use async_graphql::{ComplexObject, SimpleObject};

use entities::article::Model;

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
        }
    }
}

#[ComplexObject]
impl Article {}

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
