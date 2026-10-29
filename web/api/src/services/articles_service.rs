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
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter, QueryOrder};

/// Returns all articles from the database
pub async fn find_all(db: &Database) -> Result<Vec<Model>, ServiceError> {
    tracing::info_span!("articles_service::find_all");
    let articles = Entity::find()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;
    tracing::info!("Found {} articles", articles.len());
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

/// Returns a 929-element vector where each index i contains the count of articles for perek (i + 1)
pub async fn count_by_perek(db: &Database) -> Result<Vec<i64>, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_perek");

    #[derive(FromQueryResult)]
    struct PerekCount {
        perek_id: i16,
        count: i64,
    }

    let counts: Vec<PerekCount> = Entity::find()
        .select_only()
        .column_as(Column::PerekId, "perek_id")
        .column_as(Column::Id.count(), "count")
        .group_by(Column::PerekId)
        .into_model::<PerekCount>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    // Build a 929-element vector, initialized to 0
    let mut result = vec![0i64; 929];
    for pc in counts {
        let idx = (pc.perek_id as usize).saturating_sub(1);
        if idx < 929 {
            result[idx] = pc.count;
        }
    }

    tracing::info!("Counted articles for 929 perakim");
    Ok(result)
}

/// Returns the count of articles for a specific author
pub async fn count_by_author_id(db: &Database, author_id: i32) -> Result<i64, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_author_id", %author_id);

    #[derive(FromQueryResult)]
    struct CountResult {
        count: i64,
    }

    let result = Entity::find()
        .select_only()
        .column_as(Column::Id.count(), "count")
        .filter(Column::AuthorId.eq(author_id as i16))
        .into_model::<CountResult>()
        .one(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let count = result.map(|r| r.count).unwrap_or(0);
    tracing::info!("Author {} has {} articles", author_id, count);
    Ok(count)
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
    let terms = index.expanded_terms(phrase).await;
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

/// Returns a map of author_id → article count for all authors with articles
pub async fn count_by_author(
    db: &Database,
) -> Result<std::collections::HashMap<i32, i64>, ServiceError> {
    use sea_orm::{FromQueryResult, QuerySelect};

    tracing::info_span!("articles_service::count_by_author");

    #[derive(FromQueryResult)]
    struct AuthorCount {
        author_id: i16,
        count: i64,
    }

    let counts: Vec<AuthorCount> = Entity::find()
        .select_only()
        .column_as(Column::AuthorId, "author_id")
        .column_as(Column::Id.count(), "count")
        .group_by(Column::AuthorId)
        .into_model::<AuthorCount>()
        .all(db.get_connection())
        .await
        .map_err(|db_err| {
            ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
        })?;

    let result: std::collections::HashMap<i32, i64> = counts
        .into_iter()
        .map(|ac| (ac.author_id as i32, ac.count))
        .collect();

    tracing::info!("Counted articles for {} authors", result.len());
    Ok(result)
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
    async fn count_by_perek_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Connection refused");

        let result = count_by_perek(&db).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_author_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Network error");

        let result = count_by_author_id(&db, 1).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
        assert_eq!(err.to_string(), "Internal Server Error");
    }

    #[tokio::test]
    async fn count_by_author_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("Socket closed");

        let result = count_by_author(&db).await;

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
    async fn find_all_returns_articles_from_database() {
        let db =
            create_mock_db_with_articles(vec![article_model(1, 10, 20), article_model(2, 11, 20)]);

        let result = find_all(&db).await.expect("articles should load");

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "Article 1");
        assert_eq!(result[1].perek_id, 11);
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

    #[tokio::test]
    async fn count_by_perek_maps_counts_into_the_929_slot_vector() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![
                    mock_row([("perek_id", 1_i16.into()), ("count", 2_i64.into())]),
                    mock_row([("perek_id", 929_i16.into()), ("count", 4_i64.into())]),
                    mock_row([("perek_id", 930_i16.into()), ("count", 9_i64.into())]),
                ],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = count_by_perek(&db).await.expect("counts should load");

        assert_eq!(result.len(), 929);
        assert_eq!(result[0], 2);
        assert_eq!(result[928], 4);
        assert_eq!(result.iter().sum::<i64>(), 6);
    }

    #[tokio::test]
    async fn count_by_author_returns_author_count_map() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![
                    mock_row([("author_id", 3_i16.into()), ("count", 2_i64.into())]),
                    mock_row([("author_id", 7_i16.into()), ("count", 5_i64.into())]),
                ],
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = count_by_author(&db).await.expect("counts should load");

        assert_eq!(result.get(&3), Some(&2));
        assert_eq!(result.get(&7), Some(&5));
    }

    #[tokio::test]
    async fn count_by_author_id_returns_count_or_zero() {
        let db_with_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("count", 3_i64.into())])],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_author_id(&db_with_count, 9)
                .await
                .expect("count should load"),
            3
        );

        let db_without_count = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        assert_eq!(
            count_by_author_id(&db_without_count, 9)
                .await
                .expect("missing count should become zero"),
            0
        );
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
                        ("model", serialize_model(&model).into()),
                    ])],
                    vec![mock_row([
                        ("article_id", 42_i32.into()),
                        ("plain_len", 10_i32.into()),
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
                        ("model", serialize_model(&model).into()),
                    ])],
                    vec![
                        mock_row([
                            ("article_id", 42_i32.into()),
                            ("plain_len", 10_i32.into()),
                            ("vector", serialize_vector(&[1.0]).into()),
                            ("terms", serialize_terms(&[(0, 2)]).into()),
                        ]),
                        mock_row([
                            ("article_id", 43_i32.into()),
                            ("plain_len", 10_i32.into()),
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
    async fn find_covering_sources_by_article_id_returns_internal_server_error_on_db_failure() {
        let db = create_mock_db_with_query_error("covering table missing");

        let result = find_covering_sources_by_article_id(&db, 7).await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
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
