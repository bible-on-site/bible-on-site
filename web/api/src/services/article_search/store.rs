//! Derived-index persistence: three rebuildable tables owned by the API.
//!
//! - `article_search_queue` — sync requests left by write paths (admin article
//!   CRUD, future API mutations, and the periodic reconcile sweep). A row means
//!   "make the index reflect `tanah_article` for this id"; inserts are
//!   idempotent (`ON DUPLICATE KEY UPDATE`) so writers may safely re-enqueue.
//! - `article_search_doc` — per-article embedding, term statistics, and the
//!   MySQL-side content hash used to detect drift.
//! - `article_search_state` — singleton model row (vocabulary, idf, and the
//!   quantized term-space basis) with an epoch counter that bumps on retrain.
//!
//! None of these hold authoritative content — they are derived and rebuildable
//! from `tanah_article` at any time.

use sea_orm::{ConnectionTrait, DbBackend, DbErr, Statement, Value};

/// Schema version persisted in `article_search_state`; bump when the model
/// format or normalization changes so stale indexes rebuild automatically.
pub const SCHEMA_VERSION: i32 = 1;

/// Queue rows failing this many times are skipped by the regular drain and are
/// retried only after a reconcile sweep resets their attempts — protects the
/// worker from burning cycles on poison rows while never giving up entirely.
const MAX_ATTEMPTS: i64 = 20;

const ENSURE_STATE: &str = "CREATE TABLE IF NOT EXISTS article_search_state (
    id TINYINT NOT NULL PRIMARY KEY,
    schema_version INT NOT NULL,
    model_epoch INT NOT NULL,
    dims SMALLINT UNSIGNED NOT NULL,
    doc_count INT NOT NULL,
    model MEDIUMBLOB NOT NULL,
    rebuilt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

const ENSURE_DOC: &str = "CREATE TABLE IF NOT EXISTS article_search_doc (
    article_id MEDIUMINT NOT NULL PRIMARY KEY,
    model_epoch INT NOT NULL,
    content_hash BINARY(16) NOT NULL,
    plain_len INT NOT NULL,
    vector BLOB NOT NULL,
    terms MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

const ENSURE_QUEUE: &str = "CREATE TABLE IF NOT EXISTS article_search_queue (
    article_id MEDIUMINT NOT NULL PRIMARY KEY,
    queued_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(240) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

/// MySQL-side fingerprint of the indexable fields; identical expression used by
/// the reconcile sweep and the per-article fetch so hashes always agree.
const CONTENT_HASH_EXPR: &str = "UNHEX(MD5(CONCAT_WS(X'01', IFNULL(name,''), IFNULL(abstract,''), IFNULL(content,''), perek_id, author_id)))";

fn mysql(sql: &str, values: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::MySql, sql, values)
}

/// Creates the three derived tables when absent. Idempotent; safe to run on
/// every API boot.
pub async fn ensure_schema<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    for ddl in [ENSURE_STATE, ENSURE_DOC, ENSURE_QUEUE] {
        conn.execute_raw(Statement::from_string(DbBackend::MySql, ddl))
            .await?;
    }
    Ok(())
}

/// Enqueues an article for (re)indexing. Idempotent: a second enqueue resets
/// the retry state so a fresh write is processed promptly.
pub async fn enqueue<C: ConnectionTrait>(conn: &C, article_id: i32) -> Result<(), DbErr> {
    conn.execute_raw(mysql(
        "INSERT INTO article_search_queue (article_id) VALUES (?)
         ON DUPLICATE KEY UPDATE queued_at = CURRENT_TIMESTAMP(6), attempts = 0, last_error = NULL",
        vec![article_id.into()],
    ))
    .await?;
    Ok(())
}

/// Dequeues up to `limit` pending article ids, oldest first. Rows that failed
/// `MAX_ATTEMPTS` syncs are left for the reconcile sweep to retry later.
pub async fn pending<C: ConnectionTrait>(conn: &C, limit: u32) -> Result<Vec<i32>, DbErr> {
    let rows = conn
        .query_all_raw(mysql(
            "SELECT article_id FROM article_search_queue WHERE attempts < ? ORDER BY queued_at LIMIT ?",
            vec![MAX_ATTEMPTS.into(), (limit as i64).into()],
        ))
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<i32>("", "article_id").ok())
        .collect())
}

/// Marks a queue row processed after a successful sync.
pub async fn dequeue<C: ConnectionTrait>(conn: &C, article_id: i32) -> Result<(), DbErr> {
    conn.execute_raw(mysql(
        "DELETE FROM article_search_queue WHERE article_id = ?",
        vec![article_id.into()],
    ))
    .await?;
    Ok(())
}

/// Records a failed sync attempt with bounded error text for diagnostics.
pub async fn mark_attempt<C: ConnectionTrait>(
    conn: &C,
    article_id: i32,
    error: &str,
) -> Result<(), DbErr> {
    let clipped: String = error.chars().take(240).collect();
    conn.execute_raw(mysql(
        "UPDATE article_search_queue SET attempts = attempts + 1, last_error = ? WHERE article_id = ?",
        vec![clipped.into(), article_id.into()],
    ))
    .await?;
    Ok(())
}

/// An article row as consumed by the indexer (display fields are fetched
/// separately at query time).
#[derive(Debug, Clone)]
pub struct ArticleSource {
    pub id: i32,
    pub name: String,
    pub article_abstract: Option<String>,
    pub content: Option<String>,
}

fn read_hash(row: &sea_orm::QueryResult) -> [u8; 16] {
    row.try_get::<Vec<u8>>("", "content_hash")
        .ok()
        .and_then(|v| <[u8; 16]>::try_from(v).ok())
        .unwrap_or_default()
}

/// Fetches one public article for indexing; `None` when the article was
/// deleted or is not `distributable` (the queue consumer then removes the
/// index row — the same path that purges deletions).
pub async fn fetch_article<C: ConnectionTrait>(
    conn: &C,
    article_id: i32,
) -> Result<Option<ArticleSource>, DbErr> {
    let row = conn
        .query_one_raw(mysql(
            "SELECT id, name, abstract, content FROM tanah_article WHERE id = ? AND distributable = TRUE",
            vec![article_id.into()],
        ))
        .await?;
    row.map(|row| {
        Ok(ArticleSource {
            id: row.try_get("", "id")?,
            name: row.try_get("", "name")?,
            article_abstract: row.try_get("", "abstract")?,
            content: row.try_get("", "content")?,
        })
    })
    .transpose()
}

/// `(article_id, content_hash)` for every stored article — the reconcile sweep
/// diffs this against `article_search_doc`.
pub async fn sweep_hashes<C: ConnectionTrait>(conn: &C) -> Result<Vec<(i32, [u8; 16])>, DbErr> {
    let rows = conn
        .query_all_raw(Statement::from_string(
            DbBackend::MySql,
            format!("SELECT id, {CONTENT_HASH_EXPR} AS content_hash FROM tanah_article WHERE distributable = TRUE"),
        ))
        .await?;
    rows.into_iter()
        .map(|row| Ok((row.try_get::<i32>("", "id")?, read_hash(&row))))
        .collect()
}

/// `(article_id, content_hash)` for every indexed document.
pub async fn indexed_hashes<C: ConnectionTrait>(conn: &C) -> Result<Vec<(i32, [u8; 16])>, DbErr> {
    let rows = conn
        .query_all_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT article_id, content_hash FROM article_search_doc",
        ))
        .await?;
    rows.into_iter()
        .map(|row| {
            Ok((
                row.try_get::<i32>("", "article_id")?,
                row.try_get::<Vec<u8>>("", "content_hash")
                    .ok()
                    .and_then(|v| <[u8; 16]>::try_from(v).ok())
                    .unwrap_or_default(),
            ))
        })
        .collect()
}

/// Stored model row: serialized model blob, schema version, and epoch.
/// (`dims`/`doc_count` columns stay for operational observability but aren't
/// read back — the blob carries its own dimensions.)
#[derive(Debug, Clone)]
pub struct StoredState {
    pub schema_version: i32,
    pub model_epoch: i32,
    pub blob: Vec<u8>,
}

pub async fn load_state<C: ConnectionTrait>(conn: &C) -> Result<Option<StoredState>, DbErr> {
    let row = conn
        .query_one_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT schema_version, model_epoch, model FROM article_search_state WHERE id = 1",
        ))
        .await?;
    row.map(|row| {
        Ok(StoredState {
            schema_version: row.try_get("", "schema_version")?,
            model_epoch: row.try_get("", "model_epoch")?,
            blob: row.try_get("", "model")?,
        })
    })
    .transpose()
}

/// Persists a freshly trained model; bumps `model_epoch` so readers can detect
/// the swap and reload.
pub async fn save_state<C: ConnectionTrait>(
    conn: &C,
    dims: i32,
    doc_count: i32,
    blob: Vec<u8>,
) -> Result<(), DbErr> {
    conn.execute_raw(mysql(
        "INSERT INTO article_search_state (id, schema_version, model_epoch, dims, doc_count, model)
         VALUES (1, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE schema_version = VALUES(schema_version),
             model_epoch = model_epoch + 1, dims = VALUES(dims), doc_count = VALUES(doc_count),
             model = VALUES(model)",
        vec![
            SCHEMA_VERSION.into(),
            dims.into(),
            doc_count.into(),
            blob.into(),
        ],
    ))
    .await?;
    Ok(())
}

/// The current model epoch/doc-count without the blob — a cheap change probe.
pub async fn state_probe<C: ConnectionTrait>(conn: &C) -> Result<Option<(i32, i32)>, DbErr> {
    let row = conn
        .query_one_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT model_epoch, doc_count FROM article_search_state WHERE id = 1",
        ))
        .await?;
    row.map(|row| {
        Ok((
            row.try_get::<i32>("", "model_epoch")?,
            row.try_get::<i32>("", "doc_count")?,
        ))
    })
    .transpose()
}

/// Indexed document row: unit embedding plus compressed term statistics.
#[derive(Debug, Clone)]
pub struct StoredDoc {
    pub article_id: i32,
    pub plain_len: i32,
    pub vector: Vec<u8>,
    pub terms: Vec<u8>,
}

pub async fn load_docs<C: ConnectionTrait>(conn: &C) -> Result<Vec<StoredDoc>, DbErr> {
    let rows = conn
        .query_all_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT article_id, plain_len, vector, terms FROM article_search_doc",
        ))
        .await?;
    rows.into_iter()
        .map(|row| {
            Ok(StoredDoc {
                article_id: row.try_get("", "article_id")?,
                plain_len: row.try_get("", "plain_len")?,
                vector: row.try_get("", "vector")?,
                terms: row.try_get("", "terms")?,
            })
        })
        .collect()
}

/// Upserts one indexed document. The `content_hash` is always recomputed from
/// `tanah_article` server-side with the shared hash expression, so the index
/// and the reconcile sweep agree byte-for-byte. When the article was deleted
/// between fetch and write the `SELECT` yields no row and nothing is stored.
pub async fn upsert_doc<C: ConnectionTrait>(
    conn: &C,
    article_id: i32,
    model_epoch: i32,
    plain_len: i32,
    vector: Vec<u8>,
    terms: Vec<u8>,
) -> Result<(), DbErr> {
    conn.execute_raw(mysql(
        &format!(
            "REPLACE INTO article_search_doc (article_id, model_epoch, content_hash, plain_len, vector, terms)
             SELECT a.id, ?, {CONTENT_HASH_EXPR}, ?, ?, ? FROM tanah_article a
             WHERE a.id = ? AND a.distributable = TRUE"
        ),
        vec![
            model_epoch.into(),
            plain_len.into(),
            vector.into(),
            terms.into(),
            article_id.into(),
        ],
    ))
    .await?;
    Ok(())
}

/// Deletes one indexed document (used when the source article is gone).
pub async fn delete_doc<C: ConnectionTrait>(conn: &C, article_id: i32) -> Result<(), DbErr> {
    conn.execute_raw(mysql(
        "DELETE FROM article_search_doc WHERE article_id = ?",
        vec![article_id.into()],
    ))
    .await?;
    Ok(())
}

/// Acquires the cross-instance advisory retrain lock. Returns true when held.
pub async fn try_lock<C: ConnectionTrait>(conn: &C) -> Result<bool, DbErr> {
    let row = conn
        .query_one_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT GET_LOCK('article_search_retrain', 0) AS acquired",
        ))
        .await?;
    Ok(row
        .and_then(|row| row.try_get::<Option<i64>>("", "acquired").ok().flatten())
        .map(|v| v == 1)
        .unwrap_or(false))
}

pub async fn release_lock<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    conn.execute_raw(Statement::from_string(
        DbBackend::MySql,
        "SELECT RELEASE_LOCK('article_search_retrain')",
    ))
    .await?;
    Ok(())
}

/// Articles joined with author/perek display data for the result page.
#[derive(Debug, Clone)]
pub struct ArticleHitRow {
    pub id: i32,
    pub perek_id: i32,
    pub author_id: i32,
    pub author_name: Option<String>,
    pub name: String,
    pub article_abstract: Option<String>,
    pub content: Option<String>,
    pub sefer_name: Option<String>,
    pub additional_letter: Option<String>,
    pub perek_in_context: Option<i32>,
}

/// Fetches full display rows for a page of ranked article ids.
pub async fn fetch_hit_rows<C: ConnectionTrait>(
    conn: &C,
    ids: &[i32],
) -> Result<Vec<ArticleHitRow>, DbErr> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let mut values: Vec<Value> = ids.iter().map(|id| (*id).into()).collect();
    values.extend(ids.iter().map(|id| (*id).into()));
    let rows = conn
        .query_all_raw(mysql(
            &format!(
                "SELECT a.id, a.perek_id, a.author_id, au.name AS author_name, a.name, a.abstract, a.content,
                        p.sefer_name, p.additional_letter, p.perek_in_context
                 FROM tanah_article a
                 LEFT JOIN tanah_author au ON au.id = a.author_id
                 LEFT JOIN tanah_perek_view p ON p.perek_id = a.perek_id
                 WHERE a.id IN ({placeholders}) AND a.distributable = TRUE
                 ORDER BY FIELD(a.id, {placeholders})"
            ),
            values,
        ))
        .await?;
    rows.into_iter()
        .map(|row| {
            Ok(ArticleHitRow {
                id: row.try_get("", "id")?,
                perek_id: row.try_get::<i16>("", "perek_id")? as i32,
                author_id: row.try_get::<i16>("", "author_id")? as i32,
                author_name: row.try_get("", "author_name")?,
                name: row.try_get("", "name")?,
                article_abstract: row.try_get("", "abstract")?,
                content: row.try_get("", "content")?,
                sefer_name: row.try_get("", "sefer_name")?,
                additional_letter: row.try_get("", "additional_letter")?,
                perek_in_context: row.try_get("", "perek_in_context")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    fn conn_with_queries(
        results: Vec<Vec<BTreeMap<String, Value>>>,
    ) -> sea_orm::DatabaseConnection {
        MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>(
                results,
            )
            .into_connection()
    }

    fn conn_with_execs(affected: usize) -> sea_orm::DatabaseConnection {
        MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                affected
            ])
            .into_connection()
    }

    #[tokio::test]
    async fn ensure_schema_creates_all_three_tables() {
        let conn = conn_with_execs(3);
        ensure_schema(&conn)
            .await
            .expect("schema should be ensured");
    }

    #[tokio::test]
    async fn enqueue_dequeue_and_mark_attempt_run_their_statements() {
        let conn = conn_with_execs(3);
        enqueue(&conn, 7).await.expect("enqueue");
        dequeue(&conn, 7).await.expect("dequeue");
        mark_attempt(&conn, 7, &"x".repeat(300))
            .await
            .expect("mark_attempt clips long errors");
    }

    #[tokio::test]
    async fn pending_returns_queued_ids_in_order() {
        let conn = conn_with_queries(vec![vec![
            mock_row([("article_id", 3_i32.into())]),
            mock_row([("article_id", 9_i32.into())]),
        ]]);
        let ids = pending(&conn, 10).await.expect("pending rows");
        assert_eq!(ids, vec![3, 9]);
    }

    #[tokio::test]
    async fn pending_skips_unreadable_rows() {
        let conn = conn_with_queries(vec![vec![
            mock_row([("article_id", 5_i32.into())]),
            mock_row([("other", 6_i32.into())]),
        ]]);
        let ids = pending(&conn, 10).await.expect("pending rows");
        assert_eq!(ids, vec![5]);
    }

    #[tokio::test]
    async fn fetch_article_maps_a_row_and_none_when_absent() {
        let conn = conn_with_queries(vec![vec![mock_row([
            ("id", 4_i32.into()),
            ("name", "שם".into()),
            ("abstract", Value::String(None)),
            ("content", "גוף".into()),
        ])]]);
        let article = fetch_article(&conn, 4).await.expect("fetch").expect("row");
        assert_eq!(article.id, 4);
        assert_eq!(article.name, "שם");
        assert_eq!(article.article_abstract, None);
        assert_eq!(article.content.as_deref(), Some("גוף"));

        let conn = conn_with_queries(vec![vec![]]);
        assert!(fetch_article(&conn, 4).await.expect("fetch").is_none());
    }

    #[tokio::test]
    async fn sweep_and_indexed_hashes_parse_binary_hashes() {
        let hash: Vec<u8> = (0..16).collect();
        let conn = conn_with_queries(vec![vec![mock_row([
            ("id", 2_i32.into()),
            ("content_hash", hash.clone().into()),
        ])]]);
        let rows = sweep_hashes(&conn).await.expect("sweep");
        assert_eq!(rows, vec![(2, <[u8; 16]>::try_from(hash.clone()).unwrap())]);

        // Short blobs degrade to the zero hash instead of failing the sweep.
        let conn = conn_with_queries(vec![vec![mock_row([
            ("article_id", 8_i32.into()),
            ("content_hash", vec![1_u8, 2].into()),
        ])]]);
        let rows = indexed_hashes(&conn).await.expect("indexed");
        assert_eq!(rows, vec![(8, [0_u8; 16])]);
    }

    #[tokio::test]
    async fn load_state_and_state_probe_map_the_singleton_row() {
        let conn = conn_with_queries(vec![vec![mock_row([
            ("schema_version", SCHEMA_VERSION.into()),
            ("model_epoch", 7_i32.into()),
            ("model", vec![9_u8, 8].into()),
        ])]]);
        let state = load_state(&conn).await.expect("state").expect("row");
        assert_eq!(state.model_epoch, 7);
        assert_eq!(state.blob, vec![9_u8, 8]);

        let conn = conn_with_queries(vec![vec![]]);
        assert!(load_state(&conn).await.expect("state").is_none());

        let conn = conn_with_queries(vec![vec![mock_row([
            ("model_epoch", 3_i32.into()),
            ("doc_count", 42_i32.into()),
        ])]]);
        assert_eq!(state_probe(&conn).await.expect("probe"), Some((3, 42)));

        let conn = conn_with_queries(vec![vec![]]);
        assert_eq!(state_probe(&conn).await.expect("probe"), None);
    }

    #[tokio::test]
    async fn load_docs_maps_stored_rows() {
        let conn = conn_with_queries(vec![vec![mock_row([
            ("article_id", 6_i32.into()),
            ("plain_len", 120_i32.into()),
            ("vector", vec![0_u8, 0, 0, 0].into()),
            ("terms", vec![1_u8].into()),
        ])]]);
        let docs = load_docs(&conn).await.expect("docs");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].article_id, 6);
        assert_eq!(docs[0].plain_len, 120);
        assert_eq!(docs[0].vector, vec![0_u8, 0, 0, 0]);
    }

    #[tokio::test]
    async fn save_upsert_and_delete_execute_writes() {
        let conn = conn_with_execs(3);
        save_state(&conn, 4, 2, vec![1_u8])
            .await
            .expect("save_state");
        upsert_doc(&conn, 5, 2, 11, vec![1_u8], vec![2_u8])
            .await
            .expect("upsert_doc");
        delete_doc(&conn, 5).await.expect("delete_doc");
    }

    #[tokio::test]
    async fn try_lock_and_release_cover_the_advisory_lock() {
        let conn = conn_with_queries(vec![vec![mock_row([("acquired", 1_i64.into())])]]);
        assert!(try_lock(&conn).await.expect("lock"));

        let conn = conn_with_queries(vec![vec![mock_row([("acquired", 0_i64.into())])]]);
        assert!(!try_lock(&conn).await.expect("lock miss"));

        // A NULL/absent lock result means "not held", not an error.
        let conn = conn_with_queries(vec![vec![]]);
        assert!(!try_lock(&conn).await.expect("empty lock result"));

        let conn = conn_with_execs(1);
        release_lock(&conn).await.expect("release");
    }

    #[tokio::test]
    async fn fetch_hit_rows_short_circuits_on_empty_and_maps_rows() {
        let conn = conn_with_queries(vec![]);
        assert!(fetch_hit_rows(&conn, &[]).await.expect("empty").is_empty());

        let conn = conn_with_queries(vec![vec![mock_row([
            ("id", 12_i32.into()),
            ("perek_id", 3_i16.into()),
            ("author_id", 4_i16.into()),
            ("author_name", "רש\"י".into()),
            ("name", "מאמר".into()),
            ("abstract", Value::String(None)),
            ("content", Value::String(None)),
            ("sefer_name", "בראשית".into()),
            ("additional_letter", Value::String(None)),
            ("perek_in_context", Value::Int(None)),
        ])]]);
        let rows = fetch_hit_rows(&conn, &[12, 13]).await.expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 12);
        assert_eq!(rows[0].perek_id, 3);
        assert_eq!(rows[0].author_name.as_deref(), Some("רש\"י"));
        assert_eq!(rows[0].sefer_name.as_deref(), Some("בראשית"));
    }
}
