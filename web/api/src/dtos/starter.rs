use async_graphql::SimpleObject;

use super::article::Article;
use super::author::Author;

#[derive(SimpleObject, Debug, Clone)]
pub struct Starter {
    pub authors: Vec<Author>,
    pub articles: Vec<Article>,
    #[graphql(name = "perekArticlesCounters")]
    pub perek_articles_counters: Vec<i64>,
}
