use async_graphql::SimpleObject;

use super::article::Article;
use super::author::Author;

/// One recurring Hebrew-date article assignment (#3098): the article that
/// alone represents its month/day every Hebrew year. `hebrew_month` uses the
/// uniform numbering shared by app, website and bulletin (1=Tishrei..12=Elul,
/// 13=Adar I, 14=Adar II in leap years; 6=Adar of a non-leap year).
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleHebrewDateOverride {
    pub article_id: i32,
    pub hebrew_month: i32,
    pub hebrew_day: i32,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct Starter {
    pub authors: Vec<Author>,
    pub articles: Vec<Article>,
    #[graphql(name = "perekArticlesCounters")]
    pub perek_articles_counters: Vec<i64>,
    #[graphql(name = "articleHebrewDateOverrides")]
    pub article_hebrew_date_overrides: Vec<ArticleHebrewDateOverride>,
}
