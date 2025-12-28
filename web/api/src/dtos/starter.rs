use async_graphql::SimpleObject;

use super::author::Author;

#[derive(SimpleObject, Debug, Clone)]
pub struct Starter {
    pub authors: Vec<Author>,
    #[graphql(name = "perekArticlesCounters")]
    pub perek_articles_counters: Vec<i64>,
}
