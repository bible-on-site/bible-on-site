use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::article::{Article, ArticleCoveringSource, ArticleSearchResults};
use crate::providers::Database;
use crate::services::article_search::ArticleSearchIndex;
use crate::services::{articles_service, reading_metrics_service};

#[derive(Default)]
pub struct ArticlesQuery;

/// Batch-attach persisted reading metrics to emitted articles — one IN query
/// regardless of list size, so selecting `readingMetric` on a list never
/// becomes N+1 (issue #2607).
pub(crate) async fn attach_article_reading_metrics(
    db: &Database,
    articles: &mut [Article],
) -> Result<()> {
    let ids: Vec<i32> = articles.iter().map(|article| article.id).collect();
    let metrics = reading_metrics_service::metrics_by_article_ids(db, &ids)
        .await
        .map_err(|e| e.extend())?;
    for article in articles.iter_mut() {
        article.reading_metric = metrics.get(&article.id).cloned().map(Into::into);
    }
    Ok(())
}

/// Batch-attach covering sources to emitted articles — one IN query
/// regardless of list size, so selecting `coveringSources` on a list never
/// becomes N+1. Articles without rows get an authoritative empty list.
pub(crate) async fn attach_article_covering_sources(
    db: &Database,
    articles: &mut [Article],
) -> Result<()> {
    let ids: Vec<i32> = articles.iter().map(|article| article.id).collect();
    let mut sources = articles_service::find_covering_sources_by_article_ids(db, &ids)
        .await
        .map_err(|e| e.extend())?;
    for article in articles.iter_mut() {
        article.covering_sources = Some(
            sources
                .remove(&article.id)
                .unwrap_or_default()
                .into_iter()
                .map(|model| ArticleCoveringSource {
                    perek_id: model.perek_id,
                    pasuk: model.pasuk as i32,
                })
                .collect(),
        );
    }
    Ok(())
}

#[Object]
impl ArticlesQuery {
    /// Semantically searches public article content (Hebrew-aware). Returns
    /// ranked hits with safe plain-text excerpts; requires network access
    /// from clients — the index is API-side.
    async fn search_articles(
        &self,
        ctx: &Context<'_>,
        phrase: String,
        limit: Option<i32>,
        offset: Option<i32>,
        author_id: Option<i32>,
    ) -> Result<ArticleSearchResults> {
        let db = ctx.data::<Database>()?;
        let mut results = articles_service::search_articles(
            db,
            ctx.data::<ArticleSearchIndex>()?,
            &phrase,
            limit,
            offset,
            author_id,
        )
        .await
        .map_err(|e| e.extend())?;
        // Legacy clients do not select readingMetric. Avoid touching its
        // optional schema unless the hit fields actually request it.
        if !ctx
            .look_ahead()
            .field("hits")
            .field("readingMetric")
            .exists()
        {
            return Ok(results);
        }
        // One batched lookup so hit lists can render the same estimate badges
        // as every other article list (issue #2607).
        let ids: Vec<i32> = results.hits.iter().map(|hit| hit.article_id).collect();
        let metrics = reading_metrics_service::metrics_by_article_ids(db, &ids)
            .await
            .map_err(|e| e.extend())?;
        for hit in results.hits.iter_mut() {
            hit.reading_metric = metrics.get(&hit.article_id).cloned().map(Into::into);
        }
        Ok(results)
    }

    /// Get an article by its ID
    async fn article_by_id(&self, ctx: &Context<'_>, id: i32) -> Result<Article> {
        let db = ctx.data::<Database>()?;
        let mut article = Article::from(
            articles_service::find_one_by_id(db, id)
                .await
                .map_err(|e| e.extend())?,
        );
        if ctx.look_ahead().field("readingMetric").exists() {
            attach_article_reading_metrics(db, std::slice::from_mut(&mut article)).await?;
        }
        if ctx.look_ahead().field("coveringSources").exists() {
            attach_article_covering_sources(db, std::slice::from_mut(&mut article)).await?;
        }
        Ok(article)
    }

    /// Get all articles for a specific perek
    async fn articles_by_perek_id(&self, ctx: &Context<'_>, perek_id: i32) -> Result<Vec<Article>> {
        let db = ctx.data::<Database>()?;
        let mut articles: Vec<Article> = articles_service::find_by_perek_id(db, perek_id)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        if ctx.look_ahead().field("readingMetric").exists() {
            attach_article_reading_metrics(db, &mut articles).await?;
        }
        if ctx.look_ahead().field("coveringSources").exists() {
            attach_article_covering_sources(db, &mut articles).await?;
        }
        Ok(articles)
    }

    /// The article assigned to one recurring Hebrew month/day (#3098), or
    /// null when the date has no assignment and ordinary per-perek selection
    /// applies. `hebrewMonth` uses the uniform numbering shared with the app,
    /// the website and the bulletin: 1=Tishrei..12=Elul, 6=Adar of a non-leap
    /// year, 13=Adar I and 14=Adar II (leap years only). The assigned article
    /// is the day's sole article — the response never includes ordinary
    /// perek articles alongside it.
    async fn article_by_hebrew_date(
        &self,
        ctx: &Context<'_>,
        hebrew_month: i32,
        hebrew_day: i32,
    ) -> Result<Option<Article>> {
        articles_service::validate_hebrew_month_day(hebrew_month, hebrew_day)
            .map_err(|e| e.extend())?;
        let db = ctx.data::<Database>()?;
        let Some(model) =
            articles_service::find_article_by_hebrew_date(db, hebrew_month, hebrew_day)
                .await
                .map_err(|e| e.extend())?
        else {
            return Ok(None);
        };
        let mut article = Article::from(model);
        if ctx.look_ahead().field("readingMetric").exists() {
            attach_article_reading_metrics(db, std::slice::from_mut(&mut article)).await?;
        }
        if ctx.look_ahead().field("coveringSources").exists() {
            attach_article_covering_sources(db, std::slice::from_mut(&mut article)).await?;
        }
        Ok(Some(article))
    }

    /// Get all articles by a specific author
    async fn articles_by_author_id(
        &self,
        ctx: &Context<'_>,
        author_id: i32,
    ) -> Result<Vec<Article>> {
        let db = ctx.data::<Database>()?;
        let mut articles: Vec<Article> = articles_service::find_by_author_id(db, author_id)
            .await
            .map_err(|e| e.extend())?
            .into_iter()
            .map(Into::into)
            .collect();
        if ctx.look_ahead().field("readingMetric").exists() {
            attach_article_reading_metrics(db, &mut articles).await?;
        }
        if ctx.look_ahead().field("coveringSources").exists() {
            attach_article_covering_sources(db, &mut articles).await?;
        }
        Ok(articles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::{article, article_covering_source};
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

    fn covering_source(
        article_id: i32,
        perek_id: i32,
        pasuk: i16,
    ) -> article_covering_source::Model {
        article_covering_source::Model {
            article_id,
            perek_id,
            pasuk,
            created_at: chrono::Utc::now(),
        }
    }

    async fn execute(query: &str) -> async_graphql::Response {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![
                    article_model(1),
                    article_model(2),
                ]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_source(1, 3, 1),
                    covering_source(1, 5, 2),
                ]])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            ArticlesQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();
        schema.execute(query).await
    }

    /// Selecting `coveringSources` on `articlesByPerekId` batch-loads every
    /// article's sources in one IN query; articles without rows get an
    /// authoritative empty list.
    #[tokio::test]
    async fn articles_by_perek_id_batches_covering_sources_in_one_query() {
        let res =
            execute("{ articlesByPerekId(perekId: 1) { id coveringSources { perekId pasuk } } }")
                .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let articles = res.data.into_json().unwrap()["articlesByPerekId"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(articles.len(), 2);
        let sources = articles[0]["coveringSources"].as_array().unwrap().clone();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0]["perekId"].as_i64(), Some(3));
        assert_eq!(sources[0]["pasuk"].as_i64(), Some(1));
        assert_eq!(sources[1]["perekId"].as_i64(), Some(5));
        assert_eq!(sources[1]["pasuk"].as_i64(), Some(2));
        assert!(
            articles[1]["coveringSources"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    /// Selecting `coveringSources` on `articlesByAuthorId` uses the same
    /// single batched IN query.
    #[tokio::test]
    async fn articles_by_author_id_batches_covering_sources_in_one_query() {
        let res =
            execute("{ articlesByAuthorId(authorId: 1) { id coveringSources { perekId pasuk } } }")
                .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let articles = res.data.into_json().unwrap()["articlesByAuthorId"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(articles.len(), 2);
        let sources = articles[0]["coveringSources"].as_array().unwrap().clone();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0]["perekId"].as_i64(), Some(3));
        assert_eq!(sources[0]["pasuk"].as_i64(), Some(1));
        assert!(
            articles[1]["coveringSources"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    /// `articleByHebrewDate` returns the single assigned article for a
    /// matching recurring date (#3098) — a complete override, not a list.
    #[tokio::test]
    async fn article_by_hebrew_date_returns_assigned_article() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<(entities::article_hebrew_date::Model, Option<article::Model>), Vec<_>, _>([
                    vec![(
                        entities::article_hebrew_date::Model {
                            hebrew_month: 11,
                            hebrew_day: 9,
                            article_id: 2199,
                            created_at: chrono::Utc::now(),
                        },
                        Some(article_model(2199)),
                    )],
                ])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            ArticlesQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();

        let res = schema
            .execute("{ articleByHebrewDate(hebrewMonth: 11, hebrewDay: 9) { id name } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert_eq!(
            res.data.into_json().unwrap()["articleByHebrewDate"]["id"].as_i64(),
            Some(2199)
        );
    }

    /// A recurring date with no assignment resolves to null so callers keep
    /// ordinary per-perek selection (#3098).
    #[tokio::test]
    async fn article_by_hebrew_date_returns_null_without_assignment() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<(entities::article_hebrew_date::Model, Option<article::Model>), Vec<_>, _>([
                    Vec::new(),
                ])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            ArticlesQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();

        let res = schema
            .execute("{ articleByHebrewDate(hebrewMonth: 12, hebrewDay: 1) { id } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert!(res.data.into_json().unwrap()["articleByHebrewDate"].is_null());
    }

    /// `articleByHebrewDate` attaches metrics and covering sources on demand
    /// like every other article field (#3098) — the override article renders
    /// the same badges as a canonical perek article.
    #[tokio::test]
    async fn article_by_hebrew_date_attaches_metrics_and_covering_sources() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<(entities::article_hebrew_date::Model, Option<article::Model>), Vec<_>, _>([
                    vec![(
                        entities::article_hebrew_date::Model {
                            hebrew_month: 11,
                            hebrew_day: 9,
                            article_id: 2199,
                            created_at: chrono::Utc::now(),
                        },
                        Some(article_model(2199)),
                    )],
                ])
                .append_query_results::<entities::tanah_article_metric::Model, Vec<_>, _>([
                    Vec::new(),
                ])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_source(2199, 3, 1),
                ]])
                .into_connection(),
        );
        let schema = async_graphql::Schema::build(
            ArticlesQuery,
            async_graphql::EmptyMutation,
            async_graphql::EmptySubscription,
        )
        .data(db)
        .finish();

        let res = schema
            .execute(
                "{ articleByHebrewDate(hebrewMonth: 11, hebrewDay: 9) { id readingMetric { wordCount } coveringSources { perekId pasuk } } }",
            )
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let data = res.data.into_json().unwrap();
        let article = &data["articleByHebrewDate"];
        assert!(article["readingMetric"].is_null());
        assert_eq!(
            article["coveringSources"].as_array().unwrap()[0]["perekId"].as_i64(),
            Some(3)
        );
    }

    /// Out-of-range uniform months and impossible month/day pairs are a
    /// client error (#3098) — including day 30 for months that never have 30.
    #[tokio::test]
    async fn article_by_hebrew_date_rejects_invalid_dates() {
        for args in [
            "(hebrewMonth: 0, hebrewDay: 1)",
            "(hebrewMonth: 15, hebrewDay: 1)",
            "(hebrewMonth: 11, hebrewDay: 0)",
            "(hebrewMonth: 11, hebrewDay: 31)",
            "(hebrewMonth: 4, hebrewDay: 30)", // Tevet is always 29 days
            "(hebrewMonth: 14, hebrewDay: 30)", // Adar II is always 29 days
        ] {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql).into_connection(),
            );
            let schema = async_graphql::Schema::build(
                ArticlesQuery,
                async_graphql::EmptyMutation,
                async_graphql::EmptySubscription,
            )
            .data(db)
            .finish();
            let res = schema
                .execute(format!("{{ articleByHebrewDate{args} {{ id }} }}"))
                .await;
            assert!(
                res.errors.iter().any(|e| e.message.contains("Hebrew")),
                "{args}: {:?}",
                res.errors
            );
        }
    }

    /// Leap-year-only months and variable-length months stay within the real
    /// Hebrew calendar (#3098): Adar I/II (13/14) accept leap dates, and
    /// Cheshvan/Kislev accept 30 because some years have it.
    #[test]
    fn hebrew_month_day_bounds_match_the_uniform_calendar() {
        use articles_service::validate_hebrew_month_day;
        for (month, day) in [(2, 30), (3, 30), (13, 30), (13, 29), (14, 29), (6, 29)] {
            assert!(
                validate_hebrew_month_day(month, day).is_ok(),
                "{month}/{day}"
            );
        }
        for (month, day) in [(6, 30), (14, 30), (12, 30), (0, 1), (15, 1), (1, 31)] {
            assert!(
                validate_hebrew_month_day(month, day).is_err(),
                "{month}/{day}"
            );
        }
    }
}
