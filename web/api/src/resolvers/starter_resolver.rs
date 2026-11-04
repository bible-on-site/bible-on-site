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
        // `coveringSources` gets the same treatment when selected so the
        // full-table list never becomes N+1 (#3012).
        let mut articles: Vec<Article> = article_summaries.into_iter().map(Article::from).collect();
        super::articles_resolver::attach_article_reading_metrics(db, &mut articles).await?;
        if ctx
            .look_ahead()
            .field("articles")
            .field("coveringSources")
            .exists()
        {
            super::articles_resolver::attach_article_covering_sources(db, &mut articles).await?;
        }

        Ok(Starter {
            authors: authors_with_counts,
            articles,
            perek_articles_counters,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::{article_covering_source, author, tanah_article_metric};
    use sea_orm::{DatabaseBackend, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn author_model(id: i32) -> author::Model {
        author::Model {
            id,
            name: format!("Author {id}"),
            details: String::new(),
        }
    }

    /// Row shape of `find_all_without_content`: every starter column except
    /// the article's full HTML `content`.
    fn summary_row(id: i32) -> BTreeMap<String, Value> {
        [
            ("id".to_string(), Value::from(id)),
            ("perek_id".to_string(), Value::from(1i16)),
            ("author_id".to_string(), Value::from(1i16)),
            ("article_abstract".to_string(), Value::from(None::<String>)),
            ("name".to_string(), Value::from(format!("Article {id}"))),
            ("priority".to_string(), Value::TinyInt(Some(1))),
            ("coverage_verified".to_string(), Value::Bool(Some(false))),
        ]
        .into_iter()
        .collect()
    }

    /// Selecting `articles { coveringSources }` on `starter` batch-loads the
    /// full article table's sources in one IN query — never one per article.
    #[tokio::test]
    async fn starter_batches_article_covering_sources_in_one_query() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<author::Model, Vec<_>, _>([vec![author_model(1)]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![summary_row(1), summary_row(2)],
                ])
                .append_query_results::<tanah_article_metric::Model, Vec<_>, _>([Vec::<
                    tanah_article_metric::Model,
                >::new(
                )])
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
            StarterQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();

        let res = schema
            .execute("{ starter { articles { id coveringSources { perekId pasuk } } } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let articles = res.data.into_json().unwrap()["starter"]["articles"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(articles.len(), 2);
        let sources = articles[0]["coveringSources"].as_array().unwrap().clone();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0]["perekId"].as_i64(), Some(3));
        assert_eq!(sources[0]["pasuk"].as_i64(), Some(1));
        assert!(
            articles[1]["coveringSources"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
