use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::article::{ArticleSearchHit, ArticleSearchResults},
    dtos::perek::number_to_hebrew,
    providers::Database,
    services::article_search::{self, store, text},
};
use entities::article::{Column, Entity, Model};
use entities::article_covering_source::{
    Column as CoveringSourceColumn, Entity as CoveringSourceEntity, Model as CoveringSourceModel,
};
use sea_orm::{ColumnTrait, DbErr, DerivePartialModel, EntityTrait, QueryFilter, QueryOrder};

/// Starter-list projection of `tanah_article`: every column except `content`,
/// whose full HTML body starter clients never read (bodies load via `article(id)`).
#[derive(Debug, Clone, DerivePartialModel)]
#[sea_orm(entity = "Entity")]
pub struct ArticleSummary {
    pub id: i32,
    pub perek_id: i16,
    pub author_id: i16,
    pub article_abstract: Option<String>,
    pub name: String,
    pub priority: i8,
    pub coverage_verified: bool,
}

/// Returns every article's display metadata for the `starter` list, without
/// transferring each row's full HTML `content` MySQL→API on each app launch.
pub async fn find_all_summaries(db: &Database) -> Result<Vec<ArticleSummary>, ServiceError> {
    tracing::info_span!("articles_service::find_all_summaries");
    let articles = Entity::find()
        .into_partial_model::<ArticleSummary>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} article summaries", articles.len());
    Ok(articles)
}

pub async fn find_one_by_id(db: &Database, id: i32) -> Result<Model, ServiceError> {
    tracing::info_span!("articles_service::find_one_by_id", %id);
    let article = Entity::find_by_id(id)
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    pub const ARTICLE_NOT_FOUND: &str = "Article Not Found";
    match article {
        Some(value) => {
            tracing::info!("Article found");
            Ok(value)
        }
        None => Err(ServiceError::not_found(ARTICLE_NOT_FOUND, None::<DbErr>)),
    }
}

pub async fn find_by_perek_id(db: &Database, perek_id: i32) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_by_perek_id", %perek_id);
    let articles = Entity::find()
        .filter(Column::PerekId.eq(perek_id as i16))
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles for perek {}", articles.len(), perek_id);
    Ok(articles)
}

/// Returns full article rows for a set of ids — one IN query for consumers
/// that already hold the ordered id list (e.g. the moed union read, #3101).
pub async fn find_by_ids(db: &Database, ids: &[i32]) -> Result<Vec<Model>, ServiceError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    Entity::find()
        .filter(Column::Id.is_in(ids.iter().copied()))
        .all(db.get_connection())
        .await
        .map_err(|db_err| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err)))
}

pub async fn find_by_author_id(db: &Database, author_id: i32) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_by_author_id", %author_id);
    let articles = Entity::find()
        .filter(Column::AuthorId.eq(author_id as i16))
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles for author {}", articles.len(), author_id);
    Ok(articles)
}

/// Returns the article's persisted covering sources ordered by canonical
/// coordinate (#2189 / epic #2175 §3). An empty result means no pesukim are
/// mapped — consumers interpret it through the article's coverage_verified
/// flag rather than as "covers nothing".
pub async fn find_covering_sources_by_article_id(
    db: &Database,
    article_id: i32,
) -> Result<Vec<CoveringSourceModel>, ServiceError> {
    tracing::info_span!("articles_service::find_covering_sources_by_article_id", %article_id);
    let sources = CoveringSourceEntity::find()
        .filter(CoveringSourceColumn::ArticleId.eq(article_id))
        .order_by_asc(CoveringSourceColumn::PerekId)
        .order_by_asc(CoveringSourceColumn::Pasuk)
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    let covering_source_count = sources.len();
    tracing::info!(
        "Found {} covering sources for article {}",
        covering_source_count,
        article_id
    );
    Ok(sources)
}

/// Maximum day a uniform Hebrew month can reach in some year (#3098).
/// Cheshvan and Kislev vary 29/30 by year so 30 is a valid *input* for them
/// (a 30th that a given year lacks simply matches no real date). Months that
/// can never reach 30 (Tevet, Adar of a non-leap year, Iyar, Tammuz, Elul,
/// Adar II) reject 30. Returns `None` for out-of-range months.
pub fn max_day_for_hebrew_month(hebrew_month: i32) -> Option<i32> {
    match hebrew_month {
        1 | 2 | 3 | 5 | 7 | 9 | 11 | 13 => Some(30),
        4 | 6 | 8 | 10 | 12 | 14 => Some(29),
        _ => None,
    }
}

/// Validates a recurring Hebrew {month, day} against the uniform numbering and
/// each month's real maximum. The message names the offending bound so callers
/// see a clear 400 rather than a silently empty lookup (#3098).
pub fn validate_hebrew_month_day(hebrew_month: i32, hebrew_day: i32) -> Result<(), ServiceError> {
    let Some(max_day) = max_day_for_hebrew_month(hebrew_month) else {
        return Err(ServiceError::bad_request(
            "Hebrew month must be between 1 and 14 (uniform numbering: 1=Tishrei, 13=Adar I, 14=Adar II)",
        ));
    };
    if !(1..=max_day).contains(&hebrew_day) {
        return Err(ServiceError::bad_request(&format!(
            "Hebrew day {} is invalid for month {} (allowed: 1-{})",
            hebrew_day, hebrew_month, max_day
        )));
    }
    Ok(())
}

/// TRUE when the error means the Hebrew-date override schema (#3098) is
/// absent — missing table or column — as opposed to a genuine failure.
/// Databases that predate `tanah_article_hebrew_date_upgrade.sql` (a staggered
/// rollout deploys the API before the migration) surface ER_NO_SUCH_TABLE /
/// ER_BAD_FIELD_ERROR, which the override reads degrade to "no assignments";
/// any other database error stays fatal. Matches on the rendered message so
/// mock-backed tests and different sea-orm/sqlx plumbing behave the same —
/// the same idiom the reading-metrics service uses.
fn is_missing_hebrew_date_schema(err: &DbErr) -> bool {
    let message = err.to_string();
    message.contains("1146")
        || message.contains("1054")
        || message.contains("doesn't exist")
        || message.contains("Unknown table")
        || message.contains("Unknown column")
}

/// Every recurring Hebrew-date article override (#3098), for the starter
/// payload: native clients cache the whole map so daily-override resolution
/// works offline without a per-day network call. Before the migration is
/// deployed the table is absent and the lookup degrades to an empty list —
/// "no overrides" is the honest answer that keeps every starter field
/// serving during the rollout window.
pub async fn find_all_hebrew_date_overrides(
    db: &Database,
) -> Result<Vec<entities::article_hebrew_date::Model>, ServiceError> {
    tracing::info_span!("articles_service::find_all_hebrew_date_overrides");
    let overrides = match entities::article_hebrew_date::Entity::find()
        .all(db.get_connection())
        .await
    {
        Ok(overrides) => overrides,
        Err(err) if is_missing_hebrew_date_schema(&err) => {
            tracing::warn!(
                "Hebrew-date override schema is not deployed yet; returning no overrides"
            );
            Vec::new()
        }
        Err(err) => {
            return Err(ServiceError::internal_server_error(
                INTERNAL_SERVER_ERROR,
                Some(err),
            ));
        }
    };
    tracing::info!(
        "Found {} recurring Hebrew-date article overrides",
        overrides.len()
    );
    Ok(overrides)
}

/// The article assigned to one recurring Hebrew {month, day} (#3098).
/// `None` means the date has no assignment and callers keep the ordinary
/// per-perek selection. The returned article is the day's sole article —
/// never one candidate among many.
pub async fn find_article_by_hebrew_date(
    db: &Database,
    hebrew_month: i32,
    hebrew_day: i32,
) -> Result<Option<Model>, ServiceError> {
    tracing::info_span!(
        "articles_service::find_article_by_hebrew_date",
        %hebrew_month,
        %hebrew_day
    );
    use entities::article_hebrew_date::{Column as DateColumn, Entity as DateEntity};

    let article = match DateEntity::find()
        .filter(DateColumn::HebrewMonth.eq(hebrew_month as u8))
        .filter(DateColumn::HebrewDay.eq(hebrew_day as u8))
        .find_also_related(Entity)
        .one(db.get_connection())
        .await
    {
        Ok(found) => found.and_then(|(_, article)| article),
        // Missing schema = pre-migration database: no date can hold an
        // assignment yet, so the lookup reads as "no override".
        Err(err) if is_missing_hebrew_date_schema(&err) => {
            tracing::warn!(
                "Hebrew-date override schema is not deployed yet; returning no override"
            );
            None
        }
        Err(err) => {
            return Err(ServiceError::internal_server_error(
                INTERNAL_SERVER_ERROR,
                Some(err),
            ));
        }
    };
    match &article {
        Some(value) => {
            tracing::info!(
                "Hebrew date {}-{} overrides to article {}",
                hebrew_month,
                hebrew_day,
                value.id
            );
        }
        None => tracing::info!(
            "No Hebrew-date override for {}-{}",
            hebrew_month,
            hebrew_day
        ),
    }
    Ok(article)
}

/// Batch variant of `find_covering_sources_by_article_id`: one IN query for
/// many articles, grouped by article_id with the same per-article ordering
/// (perek_id, pasuk). Articles without rows are absent from the map.
pub async fn find_covering_sources_by_article_ids(
    db: &Database,
    article_ids: &[i32],
) -> Result<std::collections::HashMap<i32, Vec<CoveringSourceModel>>, ServiceError> {
    use std::collections::HashMap;

    if article_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = CoveringSourceEntity::find()
        .filter(CoveringSourceColumn::ArticleId.is_in(article_ids.iter().copied()))
        .order_by_asc(CoveringSourceColumn::ArticleId)
        .order_by_asc(CoveringSourceColumn::PerekId)
        .order_by_asc(CoveringSourceColumn::Pasuk)
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let mut grouped: HashMap<i32, Vec<CoveringSourceModel>> = HashMap::new();
    for row in rows {
        grouped.entry(row.article_id).or_default().push(row);
    }
    Ok(grouped)
}

/// Returns article counts grouped by perek for a set of perek ids — one
/// GROUP BY query instead of one COUNT per perek (list-field N+1 fix).
/// Perakim without articles are absent from the map.
pub async fn count_by_perek_ids(
    db: &Database,
    perek_ids: &[i32],
) -> Result<std::collections::HashMap<i32, i64>, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};
    use std::collections::HashMap;

    if perek_ids.is_empty() {
        return Ok(HashMap::new());
    }

    #[derive(FromQueryResult)]
    struct PerekCount {
        perek_id: i16,
        count: i64,
    }

    let counts: Vec<PerekCount> = Entity::find()
        .select_only()
        .column_as(Column::PerekId, "perek_id")
        .column_as(Column::Id.count(), "count")
        .filter(Column::PerekId.is_in(perek_ids.iter().map(|id| *id as i16)))
        .group_by(Column::PerekId)
        .into_model::<PerekCount>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    Ok(counts
        .into_iter()
        .map(|pc| (pc.perek_id as i32, pc.count))
        .collect())
}

/// Returns a 929-element vector where each index i contains the count of articles for perek (i + 1).
/// Derived from rows the caller already fetched, so the starter payload pays no extra aggregate scan.
pub fn count_by_perek(articles: &[ArticleSummary]) -> Vec<i64> {
    // Build a 929-element vector, initialized to 0
    let mut result = vec![0i64; 929];
    for article in articles {
        let idx = (article.perek_id as usize).saturating_sub(1);
        if idx < 929 {
            result[idx] += 1;
        }
    }
    result
}

/// Upper bound for a search phrase — beyond it the request is rejected rather
/// than truncated so abuse is visible.
pub const MAX_SEARCH_PHRASE_CHARS: usize = 256;
/// Default and maximum page sizes for article search.
pub const SEARCH_DEFAULT_LIMIT: i32 = 20;
pub const SEARCH_MAX_LIMIT: i32 = 50;
/// Pagination depth cap — deep scrolling is out of scope for a search API.
pub const SEARCH_MAX_OFFSET: i32 = 1_000;
/// Excerpt length budget in characters.
const EXCERPT_CHARS: usize = 220;

/// Semantically searches article content through the derived index and
/// hydrates the top page with display metadata. Returns an empty page for
/// empty/all-stopword phrases; rejects over-long phrases.
pub async fn search_articles(
    db: &Database,
    index: &article_search::ArticleSearchIndex,
    phrase: &str,
    limit: Option<i32>,
    offset: Option<i32>,
    author_id: Option<i32>,
) -> Result<ArticleSearchResults, ServiceError> {
    tracing::info_span!("articles_service::search_articles");
    if phrase.chars().count() > MAX_SEARCH_PHRASE_CHARS {
        return Err(ServiceError::bad_request(
            "Search phrase exceeds 256 characters",
        ));
    }
    let limit = limit.unwrap_or(SEARCH_DEFAULT_LIMIT);
    if !(1..=SEARCH_MAX_LIMIT).contains(&limit) {
        return Err(ServiceError::bad_request("limit must be between 1 and 50"));
    }
    let offset = offset.unwrap_or(0);
    if !(0..=SEARCH_MAX_OFFSET).contains(&offset) {
        return Err(ServiceError::bad_request(
            "offset must be between 0 and 1000",
        ));
    }
    if author_id.is_some_and(|id| id <= 0) {
        return Err(ServiceError::bad_request("authorId must be positive"));
    }
    // An author scope resolves to the author's article ids and applies inside
    // the index before offset/limit, so a globally ranked page can never drop
    // valid author matches.
    let author_ids = match author_id {
        Some(id) => Some(article_ids_by_author(db, id).await?),
        None => None,
    };
    let page = index
        .search(phrase, limit as usize, offset as usize, author_ids.as_ref())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    if page.hits.is_empty() {
        return Ok(ArticleSearchResults {
            total: page.total as i32,
            hits: Vec::new(),
        });
    }
    let terms = page.expanded_terms;
    let ids: Vec<i32> = page.hits.iter().map(|hit| hit.article_id).collect();
    let rows = store::fetch_hit_rows(db.get_connection(), &ids)
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    let scores: std::collections::HashMap<i32, article_search::ScoredDoc> =
        page.hits.iter().map(|hit| (hit.article_id, *hit)).collect();
    let hits = rows
        .into_iter()
        .map(|row| {
            let plain = text::strip_html(
                row.content
                    .as_deref()
                    .or(row.article_abstract.as_deref())
                    .unwrap_or_default(),
            );
            let excerpt = {
                let excerpt = text::excerpt(&plain, &terms, EXCERPT_CHARS);
                if excerpt.is_empty() {
                    // Nothing textual to quote — fall back to the title.
                    row.name.clone()
                } else {
                    excerpt
                }
            };
            let source = row.sefer_name.as_ref().map(|sefer_name| {
                let perek_heb =
                    number_to_hebrew(row.perek_in_context.unwrap_or(1)).replace(['\'', '"'], "");
                match &row.additional_letter {
                    Some(letter) => format!("{} {} {}", sefer_name, letter, perek_heb),
                    None => format!("{} {}", sefer_name, perek_heb),
                }
            });
            let scored = scores
                .get(&row.id)
                .copied()
                .unwrap_or(article_search::ScoredDoc {
                    article_id: row.id,
                    score: 0.0,
                    semantic: 0.0,
                    lexical: 0.0,
                });
            ArticleSearchHit {
                article_id: row.id,
                name: row.name.clone(),
                author_name: row.author_name,
                author_id: row.author_id,
                perek_id: row.perek_id,
                source,
                article_abstract: row.article_abstract,
                excerpt,
                score: scored.score,
                semantic_score: scored.semantic,
                lexical_score: scored.lexical,
                // Filled by the resolver via one batched metric lookup (#2607).
                reading_metric: None,
            }
        })
        .collect::<Vec<_>>();
    tracing::info!(
        phrase_len = phrase.chars().count(),
        hits = hits.len(),
        total = page.total,
        "article search completed"
    );
    Ok(ArticleSearchResults {
        total: page.total as i32,
        hits,
    })
}

/// Every article id owned by `author_id` — the eligibility set an
/// author-scoped search is confined to.
async fn article_ids_by_author(
    db: &Database,
    author_id: i32,
) -> Result<std::collections::HashSet<i32>, ServiceError> {
    use sea_orm::QuerySelect;

    Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::AuthorId.eq(author_id as i16))
        .into_tuple::<i32>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err)))
        .map(|ids| ids.into_iter().collect())
}

/// Returns a map of author_id → article count for all authors with articles,
/// derived from rows the caller already fetched.
pub fn count_by_author(articles: &[ArticleSummary]) -> std::collections::HashMap<i32, i64> {
    let mut result = std::collections::HashMap::new();
    for article in articles {
        *result.entry(article.author_id as i32).or_insert(0) += 1;
    }
    result
}

/// Returns the count of articles for a specific perek
pub async fn count_by_perek_id(db: &Database, perek_id: i32) -> Result<i64, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_perek_id", %perek_id);

    #[derive(FromQueryResult)]
    struct CountResult {
        count: i64,
    }

    let result = Entity::find()
        .select_only()
        .column_as(Column::Id.count(), "count")
        .filter(Column::PerekId.eq(perek_id as i16))
        .into_model::<CountResult>()
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let count = result.map(|r| r.count).unwrap_or(0);
    tracing::info!("Perek {} has {} articles", perek_id, count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn create_mock_db_with_query_error(error_message: &str) -> Database {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([DbErr::Custom(error_message.to_string())])
            .into_connection();
        Database::from_connection(mock_db)
    }

    fn article_model(id: i32, perek_id: i16, author_id: i16) -> Model {
        Model {
            id,
            perek_id,
            author_id,
            article_abstract: Some(format!("abstract-{id}")),
            name: format!("Article {id}"),
            priority: 1,
            content: Some(format!("content-{id}")),
            coverage_verified: false,
        }
    }

    fn article_summary(id: i32, perek_id: i16, author_id: i16) -> ArticleSummary {
        ArticleSummary {
            id,
            perek_id,
            author_id,
            article_abstract: Some(format!("abstract-{id}")),
            name: format!("Article {id}"),
            priority: 1,
            coverage_verified: false,
        }
    }

    fn create_mock_db_with_articles(rows: Vec<Model>) -> Database {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<Model, Vec<Model>, _>([rows])
            .into_connection();
        Database::from_connection(mock_db)
    }

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    #[tokio::test]
    async fn find_one_by_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection lost");

        let result = find_one_by_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_by_perek_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Database timeout");

        let result = find_by_perek_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_by_author_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Query failed");

        let result = find_by_author_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_perek_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Timeout");

        let result = count_by_perek_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn find_one_by_id_returns_not_found_when_article_does_not_exist() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::article::Model, Vec<entities::article::Model>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = find_one_by_id(&db, 999).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert_eq!(err.to_string(), "Article Not Found");
    }

    #[tokio::test]
    async fn find_all_summaries_returns_articles_without_content() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("id", 1_i32.into()),
                            ("perek_id", 10_i16.into()),
                            ("author_id", 20_i16.into()),
                            ("article_abstract", "abstract-1".into()),
                            ("name", "Article 1".into()),
                            ("priority", 1_i8.into()),
                            ("coverage_verified", false.into()),
                        ]),
                        mock_row([
                            ("id", 2_i32.into()),
                            ("perek_id", 11_i16.into()),
                            ("author_id", 20_i16.into()),
                            ("article_abstract", Value::String(None)),
                            ("name", "Article 2".into()),
                            ("priority", 2_i8.into()),
                            ("coverage_verified", true.into()),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let result = find_all_summaries(&db)
            .await
            .expect("article summaries should load");

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "Article 1");
        assert_eq!(result[0].article_abstract.as_deref(), Some("abstract-1"));
        assert_eq!(result[1].perek_id, 11);
        assert_eq!(result[1].article_abstract, None);
        assert!(result[1].coverage_verified);

        // The projection must not select the heavy `content` column.
        let statement = Entity::find()
            .into_partial_model::<ArticleSummary>()
            .into_statement(DatabaseBackend::MySql)
            .to_string();
        assert!(!statement.contains("content"));
        assert!(statement.contains("abstract"));
    }

    #[tokio::test]
    async fn find_all_summaries_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection lost");

        let result = find_all_summaries(&db).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ServiceError::InternalServerError(_)
        ));
    }

    #[tokio::test]
    async fn find_one_by_id_returns_article_when_it_exists() {
        let db = create_mock_db_with_articles(vec![article_model(7, 10, 21)]);

        let result = find_one_by_id(&db, 7).await.expect("article should load");

        assert_eq!(result.id, 7);
        assert_eq!(result.author_id, 21);
    }

    #[tokio::test]
    async fn find_by_perek_id_returns_matching_articles() {
        let db =
            create_mock_db_with_articles(vec![article_model(3, 42, 5), article_model(4, 42, 6)]);

        let result = find_by_perek_id(&db, 42)
            .await
            .expect("articles should load");

        assert_eq!(
            result.iter().map(|article| article.id).collect::<Vec<_>>(),
            vec![3, 4]
        );
    }

    #[tokio::test]
    async fn find_by_author_id_returns_matching_articles() {
        let db =
            create_mock_db_with_articles(vec![article_model(5, 42, 9), article_model(6, 43, 9)]);

        let result = find_by_author_id(&db, 9)
            .await
            .expect("articles should load");

        assert_eq!(
            result
                .iter()
                .map(|article| article.perek_id)
                .collect::<Vec<_>>(),
            vec![42, 43]
        );
    }

    #[test]
    fn count_by_perek_maps_counts_into_the_929_slot_vector() {
        let articles = vec![
            article_summary(1, 1, 3),
            article_summary(2, 1, 4),
            article_summary(3, 929, 5),
            article_summary(4, 929, 5),
            article_summary(5, 929, 5),
            article_summary(6, 929, 5),
            // Out-of-range perek ids are dropped, matching the old GROUP BY mapping.
            article_summary(7, 930, 9),
        ];

        let result = count_by_perek(&articles);

        assert_eq!(result.len(), 929);
        assert_eq!(result[0], 2);
        assert_eq!(result[928], 4);
        assert_eq!(result.iter().sum::<i64>(), 6);
    }

    #[test]
    fn count_by_author_returns_author_count_map() {
        let articles = vec![
            article_summary(1, 1, 3),
            article_summary(2, 2, 3),
            article_summary(3, 3, 7),
            article_summary(4, 4, 7),
            article_summary(5, 5, 7),
        ];

        let result = count_by_author(&articles);

        assert_eq!(result.get(&3), Some(&2));
        assert_eq!(result.get(&7), Some(&3));
    }

    #[tokio::test]
    async fn count_by_perek_id_returns_count_or_zero() {
        let db_with_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("count", 8_i64.into())])],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_perek_id(&db_with_count, 42)
                .await
                .expect("count should load"),
            8
        );

        let db_without_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_perek_id(&db_without_count, 42)
                .await
                .expect("missing count should become zero"),
            0
        );
    }

    #[tokio::test]
    async fn count_by_perek_ids_returns_count_map() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![
                    mock_row([("perek_id", 1_i16.into()), ("count", 2_i64.into())]),
                    mock_row([("perek_id", 42_i16.into()), ("count", 7_i64.into())]),
                ],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = count_by_perek_ids(&db, &[1, 42, 43])
            .await
            .expect("counts should load");

        assert_eq!(result.get(&1), Some(&2));
        assert_eq!(result.get(&42), Some(&7));
        assert_eq!(result.get(&43), None);
    }

    #[tokio::test]
    async fn count_by_perek_ids_empty_input_skips_the_query() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let result = count_by_perek_ids(&db, &[])
            .await
            .expect("empty input should return an empty map");

        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn count_by_perek_ids_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Timeout");

        let result = count_by_perek_ids(&db, &[1]).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn search_articles_validates_input_bounds() {
        let index = article_search::ArticleSearchIndex::new(Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql).into_connection(),
        ));
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let long = "א".repeat(300);
        assert!(
            search_articles(&db, &index, &long, None, None, None)
                .await
                .is_err()
        );
        assert!(
            search_articles(&db, &index, "alpha", Some(0), None, None)
                .await
                .is_err()
        );
        assert!(
            search_articles(&db, &index, "alpha", Some(51), None, None)
                .await
                .is_err()
        );
        assert!(
            search_articles(&db, &index, "alpha", None, Some(-1), None)
                .await
                .is_err()
        );
        assert!(
            search_articles(&db, &index, "alpha", None, Some(1001), None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn search_articles_ranks_and_hydrates_index_hits() {
        use article_search::lsa::{LsaModel, serialize_model, serialize_terms, serialize_vector};

        let model = LsaModel {
            dims: 1,
            vocab: vec!["alpha".into()],
            index: std::collections::HashMap::from([("alpha".into(), 0_u32)]),
            idf: vec![1.0],
            basis: vec![1.0],
        };
        // Index connection: state + docs for `load`, then an empty probe for
        // the per-search staleness check.
        let index = article_search::ArticleSearchIndex::new(Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        (
                            "schema_version",
                            article_search::store::SCHEMA_VERSION.into(),
                        ),
                        ("model_epoch", 4_i32.into()),
                        ("doc_count", 1_i32.into()),
                        ("model", serialize_model(&model).into()),
                    ])],
                    vec![mock_row([
                        ("article_id", 42_i32.into()),
                        ("plain_len", 10_i32.into()),
                        ("model_epoch", 4_i32.into()),
                        ("vector", serialize_vector(&[1.0]).into()),
                        ("terms", serialize_terms(&[(0, 2)]).into()),
                    ])],
                    vec![], // probe → same epoch, keep the snapshot
                    vec![], // second search's probe
                ])
                .into_connection(),
        ));
        index.load().await.expect("load");

        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("id", 42_i32.into()),
                        ("perek_id", 3_i16.into()),
                        ("author_id", 4_i16.into()),
                        ("author_name", "רש\"י".into()),
                        ("name", "מאמר".into()),
                        ("abstract", Value::String(None)),
                        ("content", "<p>alpha בפסקה</p>".into()),
                        ("sefer_name", "בראשית".into()),
                        ("additional_letter", Value::String(None)),
                        ("perek_in_context", 7_i32.into()),
                    ])],
                ])
                .into_connection(),
        );

        let results = search_articles(&db, &index, "alpha", None, None, None)
            .await
            .expect("search");
        assert_eq!(results.total, 1);
        assert_eq!(results.hits.len(), 1);
        let hit = &results.hits[0];
        assert_eq!(hit.article_id, 42);
        assert_eq!(hit.name, "מאמר");
        assert_eq!(hit.author_name.as_deref(), Some("רש\"י"));
        assert_eq!(hit.source.as_deref(), Some("בראשית ז"));
        assert!(hit.semantic_score > 0.9);
        assert!(!hit.excerpt.is_empty());

        // An empty phrase never reaches hydration.
        let results = search_articles(&db, &index, "", None, None, None)
            .await
            .expect("empty phrase");
        assert_eq!(results.total, 0);
        assert!(results.hits.is_empty());
    }

    #[tokio::test]
    async fn search_articles_scopes_to_author_before_pagination() {
        use article_search::lsa::{LsaModel, serialize_model, serialize_terms, serialize_vector};

        let model = LsaModel {
            dims: 1,
            vocab: vec!["alpha".into()],
            index: std::collections::HashMap::from([("alpha".into(), 0_u32)]),
            idf: vec![1.0],
            basis: vec![1.0],
        };
        // Two matching docs; doc 43 ranks above doc 42 (higher tf), so a
        // global limit-1 page would return 43 and drop the author's match —
        // the scope must apply before pagination.
        let index = article_search::ArticleSearchIndex::new(Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        (
                            "schema_version",
                            article_search::store::SCHEMA_VERSION.into(),
                        ),
                        ("model_epoch", 4_i32.into()),
                        ("doc_count", 2_i32.into()),
                        ("model", serialize_model(&model).into()),
                    ])],
                    vec![
                        mock_row([
                            ("article_id", 42_i32.into()),
                            ("plain_len", 10_i32.into()),
                            ("model_epoch", 4_i32.into()),
                            ("vector", serialize_vector(&[1.0]).into()),
                            ("terms", serialize_terms(&[(0, 2)]).into()),
                        ]),
                        mock_row([
                            ("article_id", 43_i32.into()),
                            ("plain_len", 10_i32.into()),
                            ("model_epoch", 4_i32.into()),
                            ("vector", serialize_vector(&[1.0]).into()),
                            ("terms", serialize_terms(&[(0, 40)]).into()),
                        ]),
                    ],
                    vec![], // probe → same epoch, keep the snapshot
                ])
                .into_connection(),
        ));
        index.load().await.expect("load");

        // Main connection: author's article ids first, then hydration rows.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("id", 42_i32.into())])],
                    vec![mock_row([
                        ("id", 42_i32.into()),
                        ("perek_id", 3_i16.into()),
                        ("author_id", 4_i16.into()),
                        ("author_name", "רש\"י".into()),
                        ("name", "מאמר".into()),
                        ("abstract", Value::String(None)),
                        ("content", "<p>alpha בפסקה</p>".into()),
                        ("sefer_name", "בראשית".into()),
                        ("additional_letter", Value::String(None)),
                        ("perek_in_context", 7_i32.into()),
                    ])],
                ])
                .into_connection(),
        );

        // Even with limit 1 — which globally would return doc 43 — the scoped
        // page returns the author's doc 42 and counts only author hits.
        let results = search_articles(&db, &index, "alpha", Some(1), None, Some(4))
            .await
            .expect("scoped search");
        assert_eq!(results.total, 1);
        assert_eq!(results.hits.len(), 1);
        assert_eq!(results.hits[0].article_id, 42);
        assert_eq!(results.hits[0].author_id, 4);
    }

    #[tokio::test]
    async fn search_articles_author_without_articles_returns_empty_page() {
        let index = article_search::ArticleSearchIndex::new(Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql).into_connection(),
        ));
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let results = search_articles(&db, &index, "alpha", None, None, Some(9))
            .await
            .expect("search");
        assert_eq!(results.total, 0);
        assert!(results.hits.is_empty());
        assert!(
            search_articles(&db, &index, "alpha", None, None, Some(0))
                .await
                .is_err()
        );
        assert!(
            search_articles(&db, &index, "alpha", None, None, Some(-3))
                .await
                .is_err()
        );
        let db_err = create_mock_db_with_query_error("author ids query failed");
        assert!(
            search_articles(&db_err, &index, "alpha", None, None, Some(9))
                .await
                .is_err()
        );
    }

    fn covering_source_model(article_id: i32, perek_id: i32, pasuk: i16) -> CoveringSourceModel {
        CoveringSourceModel {
            article_id,
            perek_id,
            pasuk,
            created_at: chrono::NaiveDate::from_ymd_opt(2026, 1, 1)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc(),
        }
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_id_returns_rows_ordered() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<CoveringSourceModel, Vec<CoveringSourceModel>, _>([vec![
                    covering_source_model(7, 1, 5),
                    covering_source_model(7, 1, 9),
                    covering_source_model(7, 42, 2),
                ]])
                .into_connection(),
        );

        let sources = find_covering_sources_by_article_id(&db, 7)
            .await
            .expect("covering sources should load");

        assert_eq!(
            sources
                .iter()
                .map(|source| (source.perek_id, source.pasuk))
                .collect::<Vec<_>>(),
            vec![(1, 5), (1, 9), (42, 2)]
        );
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_id_returns_empty_when_unmapped() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<CoveringSourceModel, Vec<CoveringSourceModel>, _>([vec![]])
                .into_connection(),
        );

        let sources = find_covering_sources_by_article_id(&db, 7)
            .await
            .expect("unmapped article should return an empty set");

        assert!(sources.is_empty());
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_ids_groups_and_orders_rows() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<CoveringSourceModel, Vec<CoveringSourceModel>, _>([vec![
                    covering_source_model(7, 1, 5),
                    covering_source_model(8, 3, 1),
                    covering_source_model(7, 1, 9),
                ]])
                .into_connection(),
        );

        let grouped = find_covering_sources_by_article_ids(&db, &[7, 8, 9])
            .await
            .expect("covering sources should load");

        assert_eq!(grouped.len(), 2);
        let article_7 = grouped.get(&7).expect("article 7 has rows");
        assert_eq!(
            article_7
                .iter()
                .map(|source| (source.perek_id, source.pasuk))
                .collect::<Vec<_>>(),
            vec![(1, 5), (1, 9)]
        );
        let article_8 = grouped.get(&8).expect("article 8 has rows");
        assert_eq!(article_8.len(), 1);
        assert!(!grouped.contains_key(&9));
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_ids_empty_input_skips_the_query() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let grouped = find_covering_sources_by_article_ids(&db, &[])
            .await
            .expect("empty input should return an empty map");

        assert!(grouped.is_empty());
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_ids_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("covering table missing");

        let result = find_covering_sources_by_article_ids(&db, &[7]).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ServiceError::InternalServerError(_)
        ));
    }

    #[tokio::test]
    async fn find_covering_sources_by_article_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("covering table missing");

        let result = find_covering_sources_by_article_id(&db, 7).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ServiceError::InternalServerError(_)
        ));
    }

    /// Happy path and failure mode for the recurring-date override list
    /// (#3098) — the starter payload ships every assignment to native clients.
    #[tokio::test]
    async fn find_all_hebrew_date_overrides_returns_rows_and_maps_db_errors() {
        use entities::article_hebrew_date;
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article_hebrew_date::Model, Vec<_>, _>([vec![
                    article_hebrew_date::Model {
                        hebrew_month: 11,
                        hebrew_day: 9,
                        article_id: 2199,
                        created_at: chrono::Utc::now(),
                    },
                ]])
                .into_connection(),
        );

        let overrides = find_all_hebrew_date_overrides(&db)
            .await
            .expect("overrides should load");
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0].article_id, 2199);

        let failing = create_mock_db_with_query_error("date table missing");
        assert!(matches!(
            find_all_hebrew_date_overrides(&failing).await.unwrap_err(),
            ServiceError::InternalServerError(_)
        ));
    }

    /// Before the migration is deployed the override table is absent: the
    /// starter-facing list degrades to empty (a staggered rollout must not
    /// break the whole starter), while a genuine failure still errors.
    #[tokio::test]
    async fn find_all_hebrew_date_overrides_degrades_before_migration() {
        let missing = create_mock_db_with_query_error(
            "Query Error: Table 'tanah.tanah_article_hebrew_date' doesn't exist (1146)",
        );
        let overrides = find_all_hebrew_date_overrides(&missing)
            .await
            .expect("missing schema should degrade to an empty list");
        assert!(overrides.is_empty());
    }

    /// The single-date lookup degrades the same way: a pre-migration
    /// database reads as "no override" rather than failing the field.
    #[tokio::test]
    async fn find_article_by_hebrew_date_degrades_before_migration() {
        let missing = create_mock_db_with_query_error(
            "Query Error: Table 'tanah.tanah_article_hebrew_date' doesn't exist (1146)",
        );
        assert!(
            find_article_by_hebrew_date(&missing, 11, 9)
                .await
                .expect("missing schema should degrade to no override")
                .is_none()
        );
    }

    /// The single assigned article resolves through the date join (#3098):
    /// a row with its related article, a bare row, an empty result, and the
    /// DB-failure arm all map onto the service contract.
    #[tokio::test]
    async fn find_article_by_hebrew_date_resolves_assignment_and_errors() {
        type Pair = (entities::article_hebrew_date::Model, Option<Model>);
        let assigned = |article: Option<Model>| {
            Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<Pair, Vec<Pair>, _>([vec![(
                        entities::article_hebrew_date::Model {
                            hebrew_month: 11,
                            hebrew_day: 9,
                            article_id: 2199,
                            created_at: chrono::Utc::now(),
                        },
                        article,
                    )]])
                    .into_connection(),
            )
        };

        let found = find_article_by_hebrew_date(&assigned(Some(article_model(2199, 1, 1))), 11, 9)
            .await
            .expect("lookup should succeed");
        assert_eq!(found.map(|m| m.id), Some(2199));

        // An assignment row without its article resolves to no override.
        let orphan = find_article_by_hebrew_date(&assigned(None), 11, 9)
            .await
            .expect("lookup should succeed");
        assert!(orphan.is_none());

        let empty = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Pair, Vec<Pair>, _>([Vec::new()])
                .into_connection(),
        );
        assert!(
            find_article_by_hebrew_date(&empty, 8, 5)
                .await
                .expect("empty result")
                .is_none()
        );

        let failing = create_mock_db_with_query_error("date join failed");
        assert!(matches!(
            find_article_by_hebrew_date(&failing, 11, 9)
                .await
                .unwrap_err(),
            ServiceError::InternalServerError(_)
        ));
    }

    #[test]
    fn article_covering_source_relations_generate_the_canonical_table_join() {
        use sea_orm::{QueryTrait, Related};

        let article_side = <Entity as Related<CoveringSourceEntity>>::find_related()
            .build(sea_orm::DatabaseBackend::MySql)
            .to_string();
        assert!(article_side.contains("tanah_article_covering_source"));

        let covering_side = <CoveringSourceEntity as Related<Entity>>::find_related()
            .build(sea_orm::DatabaseBackend::MySql)
            .to_string();
        assert!(covering_side.contains("`tanah_article`"));
    }
}
