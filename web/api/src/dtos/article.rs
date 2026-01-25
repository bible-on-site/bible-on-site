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
