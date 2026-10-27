//! Readers for the shared reading-metrics contract (issue #2607): persisted
//! whole-content metrics plus ordered per-unit word counts. The tables are
//! introduced by `data/mysql/tanah_reading_metrics_upgrade.sql`; databases
//! that predate it (older dev snapshots, packaged fixtures) surface
//! ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR, which this module degrades to
//! "unknown" (empty) rather than failing the whole GraphQL operation. Any
//! other database error is propagated — a real outage must not be hidden.

use std::collections::HashMap;

use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter, QueryOrder};

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    providers::Database,
};
use entities::{
    tanah_article_metric, tanah_article_metric_block, tanah_perek_metric, tanah_perek_pasuk_metric,
    tanahpedia::{entry_metric, entry_metric_block},
};

/// TRUE when the error means the metrics schema is absent — missing table or
/// column — as opposed to a genuine failure. Matches on the rendered message
/// so mock-backed tests and different sea-orm/sqlx plumbing behave the same.
fn is_missing_metrics_schema(err: &DbErr) -> bool {
    let message = err.to_string();
    message.contains("1146")
        || message.contains("1054")
        || message.contains("doesn't exist")
        || message.contains("Unknown table")
        || message.contains("Unknown column")
}

fn to_service_error(err: DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(err))
}

/// Whole-perek metrics keyed by canonical perek id, for the requested ids.
/// Empty/absent ids yield an empty map; missing schema degrades to empty.
pub async fn metrics_by_perek_ids(
    db: &Database,
    perek_ids: &[i32],
) -> Result<HashMap<i32, tanah_perek_metric::Model>, ServiceError> {
    if perek_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = match tanah_perek_metric::Entity::find()
        .filter(tanah_perek_metric::Column::PerekId.is_in(perek_ids.iter().copied()))
        .all(db.get_connection())
        .await
    {
        Ok(rows) => rows,
        Err(err) if is_missing_metrics_schema(&err) => return Ok(HashMap::new()),
        Err(err) => return Err(to_service_error(err)),
    };
    Ok(rows.into_iter().map(|row| (row.perek_id, row)).collect())
}

/// Whole-article metrics keyed by article id, for the requested ids — one
/// IN query so list resolvers (starter, articlesByPerekId) stay O(1) in
/// round-trips. Missing schema degrades to empty.
pub async fn metrics_by_article_ids(
    db: &Database,
    article_ids: &[i32],
) -> Result<HashMap<i32, tanah_article_metric::Model>, ServiceError> {
    if article_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = match tanah_article_metric::Entity::find()
        .filter(tanah_article_metric::Column::ArticleId.is_in(article_ids.iter().copied()))
        .all(db.get_connection())
        .await
    {
        Ok(rows) => rows,
        Err(err) if is_missing_metrics_schema(&err) => return Ok(HashMap::new()),
        Err(err) => return Err(to_service_error(err)),
    };
    Ok(rows.into_iter().map(|row| (row.article_id, row)).collect())
}

/// Whole-entry metric for a single Tanahpedia entry; `None` when uncomputed
/// or when the metrics schema is absent.
pub async fn metric_by_entry_id(
    db: &Database,
    entry_id: &str,
) -> Result<Option<entry_metric::Model>, ServiceError> {
    match entry_metric::Entity::find_by_id(entry_id.to_string())
        .one(db.get_connection())
        .await
    {
        Ok(row) => Ok(row),
        Err(err) if is_missing_metrics_schema(&err) => Ok(None),
        Err(err) => Err(to_service_error(err)),
    }
}

/// Ordered pasuk-level units for a perek — the word-weighted progress
/// mapping. Empty when uncomputed or when the metrics schema is absent.
pub async fn pasuk_units_by_perek_id(
    db: &Database,
    perek_id: i32,
) -> Result<Vec<tanah_perek_pasuk_metric::Model>, ServiceError> {
    match tanah_perek_pasuk_metric::Entity::find()
        .filter(tanah_perek_pasuk_metric::Column::PerekId.eq(perek_id))
        .order_by_asc(tanah_perek_pasuk_metric::Column::Pasuk)
        .all(db.get_connection())
        .await
    {
        Ok(rows) => Ok(rows),
        Err(err) if is_missing_metrics_schema(&err) => Ok(vec![]),
        Err(err) => Err(to_service_error(err)),
    }
}

/// Ordered readable-block units for an article body.
pub async fn block_units_by_article_id(
    db: &Database,
    article_id: i32,
) -> Result<Vec<tanah_article_metric_block::Model>, ServiceError> {
    match tanah_article_metric_block::Entity::find()
        .filter(tanah_article_metric_block::Column::ArticleId.eq(article_id))
        .order_by_asc(tanah_article_metric_block::Column::BlockIdx)
        .all(db.get_connection())
        .await
    {
        Ok(rows) => Ok(rows),
        Err(err) if is_missing_metrics_schema(&err) => Ok(vec![]),
        Err(err) => Err(to_service_error(err)),
    }
}

/// Ordered readable-block units for a Tanahpedia entry body.
pub async fn block_units_by_entry_id(
    db: &Database,
    entry_id: &str,
) -> Result<Vec<entry_metric_block::Model>, ServiceError> {
    match entry_metric_block::Entity::find()
        .filter(entry_metric_block::Column::EntryId.eq(entry_id.to_string()))
        .order_by_asc(entry_metric_block::Column::BlockIdx)
        .all(db.get_connection())
        .await
    {
        Ok(rows) => Ok(rows),
        Err(err) if is_missing_metrics_schema(&err) => Ok(vec![]),
        Err(err) => Err(to_service_error(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn mock_db() -> MockDatabase {
        MockDatabase::new(DatabaseBackend::MySql)
    }

    fn article_metric(article_id: i32, word_count: Option<i32>) -> tanah_article_metric::Model {
        tanah_article_metric::Model {
            article_id,
            word_count,
            estimated_seconds: word_count.map(|wc| wc * 60 / 220 + 1),
            words_per_minute: 220,
            calc_version: 1,
            source_hash: "b".repeat(64),
            computed_at: chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap(),
        }
    }

    #[tokio::test]
    async fn metrics_by_article_ids_maps_rows_by_id() {
        let db = Database::from_connection(
            mock_db()
                .append_query_results::<tanah_article_metric::Model, Vec<_>, _>([vec![
                    article_metric(1, Some(100)),
                    article_metric(3, None),
                ]])
                .into_connection(),
        );

        let map = metrics_by_article_ids(&db, &[1, 2, 3]).await.unwrap();

        assert_eq!(map.len(), 2);
        assert_eq!(map.get(&1).unwrap().word_count, Some(100));
        assert_eq!(map.get(&3).unwrap().word_count, None);
        assert!(!map.contains_key(&2));
    }

    #[tokio::test]
    async fn metrics_by_article_ids_short_circuits_empty_ids_without_querying() {
        let db = Database::from_connection(mock_db().into_connection());

        let map = metrics_by_article_ids(&db, &[]).await.unwrap();

        assert!(map.is_empty());
        assert!(db.get_connection().ping().await.is_ok());
    }

    #[tokio::test]
    async fn metrics_by_article_ids_degrades_on_missing_table() {
        let db = Database::from_connection(
            mock_db()
                .append_query_errors([DbErr::Custom(
                    "Query Error: Table 'tanah.tanah_article_metric' doesn't exist (1146)"
                        .to_string(),
                )])
                .into_connection(),
        );

        let map = metrics_by_article_ids(&db, &[1]).await.unwrap();

        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn metrics_by_article_ids_propagates_genuine_errors() {
        let db = Database::from_connection(
            mock_db()
                .append_query_errors([DbErr::Custom("Connection lost".to_string())])
                .into_connection(),
        );

        let result = metrics_by_article_ids(&db, &[1]).await;

        assert!(matches!(result, Err(ServiceError::InternalServerError(_))));
    }

    #[tokio::test]
    async fn metrics_by_perek_ids_degrades_on_unknown_column() {
        let db = Database::from_connection(
            mock_db()
                .append_query_errors([DbErr::Custom(
                    "Query Error: Unknown column 'word_count' in 'field list' (1054)".to_string(),
                )])
                .into_connection(),
        );

        let map = metrics_by_perek_ids(&db, &[1]).await.unwrap();

        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn metric_by_entry_id_returns_none_when_schema_missing() {
        let db = Database::from_connection(
            mock_db()
                .append_query_errors([DbErr::Custom(
                    "Query Error: Table 'tanah.tanahpedia_entry_metric' doesn't exist".to_string(),
                )])
                .into_connection(),
        );

        let metric = metric_by_entry_id(&db, "some-entry").await.unwrap();

        assert!(metric.is_none());
    }

    #[tokio::test]
    async fn pasuk_units_return_ordered_rows() {
        let unit = |pasuk, cumulative| tanah_perek_pasuk_metric::Model {
            perek_id: 1,
            pasuk,
            word_count: 10,
            cumulative_words: cumulative,
            calc_version: 1,
        };
        let db = Database::from_connection(
            mock_db()
                .append_query_results::<tanah_perek_pasuk_metric::Model, Vec<_>, _>([vec![
                    unit(1, 10),
                    unit(2, 20),
                    unit(3, 30),
                ]])
                .into_connection(),
        );

        let units = pasuk_units_by_perek_id(&db, 1).await.unwrap();

        assert_eq!(units.len(), 3);
        assert_eq!(units[2].cumulative_words, 30);
    }

    #[tokio::test]
    async fn block_units_by_entry_id_degrades_to_empty() {
        let db = Database::from_connection(
            mock_db()
                .append_query_errors([DbErr::Custom(
                    "Query Error: Table 'tanah.tanahpedia_entry_metric_block' doesn't exist"
                        .to_string(),
                )])
                .into_connection(),
        );

        let units = block_units_by_entry_id(&db, "entry-x").await.unwrap();

        assert!(units.is_empty());
    }
}
