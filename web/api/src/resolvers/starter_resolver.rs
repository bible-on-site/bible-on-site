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

        // Fetch authors and article summaries; counts derive from the rows in memory
        let authors = authors_service::find_all(db)
            .await
            .map_err(|e| e.extend())?;

        // Recurring Hebrew-date overrides (#3098) travel with the starter so
        // native clients resolve the daily article offline from cached data.
        // The lookup runs only when the selection asks for it — an older
        // client's starter must never pay for (or fail on) a field it does
        // not read; the service itself degrades a pre-migration database to
        // an empty override map.
        let hebrew_date_overrides = if ctx
            .look_ahead()
            .field("articleHebrewDateOverrides")
            .exists()
        {
            articles_service::find_all_hebrew_date_overrides(db)
                .await
                .map_err(|e| e.extend())?
                .into_iter()
                .map(|model| crate::dtos::starter::ArticleHebrewDateOverride {
                    article_id: model.article_id,
                    hebrew_month: model.hebrew_month as i32,
                    hebrew_day: model.hebrew_day as i32,
                })
                .collect()
        } else {
            Vec::new()
        };

        let all_articles = articles_service::find_all_summaries(db)
            .await
            .map_err(|e| e.extend())?;

        // Counts derive from the rows already fetched — no extra aggregate scans
        let author_article_counts = articles_service::count_by_author(&all_articles);
        let perek_articles_counters = articles_service::count_by_perek(&all_articles);

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
        // full-table list never becomes N+1.
        let mut articles: Vec<Article> = all_articles.into_iter().map(Article::from).collect();
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
            article_hebrew_date_overrides: hebrew_date_overrides,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::{
        article, article_covering_source, article_hebrew_date, author, tanah_article_metric,
    };
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn article_model(id: i32) -> article::Model {
        article::Model {
            id,
            perek_id: 1,
            author_id: 1,
            article_abstract: None,
            name: format!("Article {id}"),
            priority: 1,
            content: None,
            coverage_verified: false,
        }
    }

    fn author_model(id: i32) -> author::Model {
        author::Model {
            id,
            name: format!("Author {id}"),
            details: String::new(),
        }
    }

    /// Selecting `articles { coveringSources }` on `starter` batch-loads the
    /// full article table's sources in one IN query — never one per article.
    #[tokio::test]
    async fn starter_batches_article_covering_sources_in_one_query() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<author::Model, Vec<_>, _>([vec![author_model(1)]])
                .append_query_results::<article_hebrew_date::Model, Vec<_>, _>([vec![
                    article_hebrew_date::Model {
                        hebrew_month: 11,
                        hebrew_day: 9,
                        article_id: 7,
                        created_at: chrono::Utc::now(),
                    },
                ]])
                .append_query_results::<article::Model, Vec<_>, _>([vec![
                    article_model(1),
                    article_model(2),
                ]])
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
            .execute(
                "{ starter { articles { id coveringSources { perekId pasuk } } \
                 articleHebrewDateOverrides { articleId hebrewMonth hebrewDay } } }",
            )
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let data = res.data.into_json().unwrap();
        let overrides = data["starter"]["articleHebrewDateOverrides"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0]["articleId"].as_i64(), Some(7));
        assert_eq!(overrides[0]["hebrewMonth"].as_i64(), Some(11));
        assert_eq!(overrides[0]["hebrewDay"].as_i64(), Some(9));
        let articles = data["starter"]["articles"].as_array().unwrap().clone();
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

    /// The override lookup is gated on the selection (#3098): a starter
    /// query that does not ask for `articleHebrewDateOverrides` must not run
    /// the Hebrew-date query at all — the transaction log asserts no
    /// statement touched the table.
    #[tokio::test]
    async fn starter_skips_hebrew_date_lookup_when_unselected() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<author::Model, Vec<_>, _>([vec![author_model(1)]])
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(1)]])
                .append_query_results::<tanah_article_metric::Model, Vec<_>, _>([Vec::<
                    tanah_article_metric::Model,
                >::new(
                )])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            StarterQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db.clone())
        .finish();

        let res = schema
            .execute("{ starter { authors { id } articles { id } } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
        assert!(
            !log.contains("tanah_article_hebrew_date"),
            "unselected override field still queried the table: {log}"
        );
    }

    /// A staggered rollout deploys the API before the migration: on a
    /// database without `tanah_article_hebrew_date` the selected field
    /// degrades to an empty list instead of failing the whole starter.
    #[tokio::test]
    async fn starter_degrades_hebrew_date_overrides_before_migration() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<author::Model, Vec<_>, _>([vec![author_model(1)]])
                .append_query_errors([sea_orm::DbErr::Custom(
                    "Query Error: Table 'tanah.tanah_article_hebrew_date' doesn't exist (1146)"
                        .to_string(),
                )])
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(1)]])
                .append_query_results::<tanah_article_metric::Model, Vec<_>, _>([Vec::<
                    tanah_article_metric::Model,
                >::new(
                )])
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
            .execute(
                "{ starter { articles { id } \
                 articleHebrewDateOverrides { articleId hebrewMonth hebrewDay } } }",
            )
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let data = res.data.into_json().unwrap();
        assert!(
            data["starter"]["articleHebrewDateOverrides"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(data["starter"]["articles"].as_array().unwrap().len(), 1);
    }
}
