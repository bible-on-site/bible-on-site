//! Derived semantic search index over `tanah_article`.
//!
//! MySQL remains the source of truth. This module maintains a rebuildable
//! secondary index (an in-process LSA snapshot plus three derived tables) that
//! stays in sync through:
//!
//! - a durable queue table — write paths enqueue the changed article id after a
//!   successful write, and a worker drains it (idempotent upserts; deleted
//!   articles are purged from the index);
//! - a reconcile sweep — periodically diffs server-side content hashes so any
//!   missed enqueue, failed write, or external data change is detected and
//!   re-indexed, and stale model epochs are folded back in;
//! - full retrains — when drift crosses a threshold the whole basis is rebuilt
//!   under a `GET_LOCK` advisory lock so concurrent API instances never train
//!   in parallel.
//!
//! Ranking blends the semantic cosine score with a BM25-style lexical score so
//! both meaning-level matches (synonyms via latent dimensions) and exact
//! wording are rewarded. Only normalized term statistics and embeddings are
//! stored — article HTML stays authoritative in `tanah_article`.

pub mod lsa;
pub mod store;
pub mod text;

use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use sea_orm::{
    ConnectionTrait, DatabaseConnection, DatabaseConnectionType, DbBackend, DbErr, ExecResult,
    QueryResult, RuntimeErr, Statement, Values,
    sqlx::{self, Executor, MySql, pool::PoolConnection},
};
use sea_query_sqlx::SqlxValues;
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, info, warn};

use crate::providers::Database;

use lsa::{
    LsaModel, SparseVector, cosine, deserialize_model, deserialize_terms, deserialize_vector,
};
use text::{distance, max_edits, strip_html, tokenize};

/// Queue ids drained per worker tick.
const DRAIN_BATCH: u32 = 256;
/// How often the worker drains the queue.
const TICK_SECS: u64 = 15;
/// How often the full reconcile sweep runs (cheap: hashes only).
const SWEEP_EVERY_TICKS: u32 = 40; // 40 * 15s = 10 minutes
/// Retrain the whole model when this many articles drifted.
const RETRAIN_MIN_DIRTY: usize = 32;
/// …or when at least this fraction of the corpus drifted.
const RETRAIN_RATIO: f32 = 0.08;
/// Blend: 65% semantic cosine + 35% lexical match quality.
const SEMANTIC_WEIGHT: f32 = 0.65;
/// Minimum combined score to be reported as a hit.
const MIN_SCORE: f32 = 0.15;
/// Expansion caps — keep query-time work bounded on large vocabularies.
const PREFIX_CAP: usize = 24;
const PREFIX_WEIGHT: f32 = 0.85;
const PREFIX_MIN_LEN: usize = 2;
const FUZZY_CAP: usize = 12;
const FUZZY_WEIGHT: f32 = 0.6;
const FUZZY_MIN_LEN: usize = 3;
const EXPANSION_CAP: usize = 96;
/// BM25-style saturation parameters.
const BM25_K1: f32 = 1.2;
const BM25_B: f32 = 0.75;
/// Soft saturation so the lexical half stays in [0, 1).
const LEX_SATURATE: f32 = 4.0;
/// Hard cap on normalized query tokens — bounds per-query work.
const MAX_QUERY_TOKENS: usize = 16;

/// One scored document, pre-pagination.
#[derive(Debug, Clone, Copy)]
pub struct ScoredDoc {
    pub article_id: i32,
    pub score: f32,
    /// Pure semantic cosine component (for diagnostics/explanations).
    pub semantic: f32,
    /// Normalized lexical component.
    pub lexical: f32,
}

/// Immutable point-in-time index — swapped atomically on reload.
struct Snapshot {
    initialized: bool,
    epoch: i32,
    model: LsaModel,
    /// `doc_ids[i]` is the article id of document slot i.
    doc_ids: Vec<i32>,
    vectors: Vec<Vec<f32>>,
    /// Inverted index: term id → `(doc slot, term frequency)` postings.
    postings: HashMap<u32, Vec<(u32, u32)>>,
    doc_lens: Vec<u32>,
    avg_len: f32,
}

impl Snapshot {
    fn empty() -> Self {
        Self {
            initialized: false,
            epoch: 0,
            model: LsaModel {
                dims: 0,
                vocab: Vec::new(),
                index: HashMap::new(),
                idf: Vec::new(),
                basis: Vec::new(),
            },
            doc_ids: Vec::new(),
            vectors: Vec::new(),
            postings: HashMap::new(),
            doc_lens: Vec::new(),
            avg_len: 1.0,
        }
    }

    /// Expands normalized query tokens into `(term_id, weight)` pairs:
    /// exact vocabulary hits, then prefix completions, then edit-distance-1
    /// fuzzy matches when nothing else matched.
    fn expand_query(&self, tokens: &[String]) -> Vec<(u32, f32)> {
        let mut acc: HashMap<u32, f32> = HashMap::new();
        for token in tokens.iter().take(MAX_QUERY_TOKENS) {
            if token.is_empty() {
                continue;
            }
            if let Some(&tid) = self.model.index.get(token) {
                *acc.entry(tid).or_insert(0.0) += 1.0;
                continue;
            }
            let mut matched = false;
            if token.chars().count() >= PREFIX_MIN_LEN {
                let mut added = 0usize;
                for (i, term) in self.model.vocab.iter().enumerate() {
                    if term != token && term.starts_with(token.as_str()) {
                        *acc.entry(i as u32).or_insert(0.0) += PREFIX_WEIGHT;
                        added += 1;
                        if added >= PREFIX_CAP {
                            break;
                        }
                    }
                }
                matched = added > 0;
            }
            let max_dist = max_edits(token);
            if !matched && max_dist > 0 && token.chars().count() >= FUZZY_MIN_LEN {
                let mut added = 0usize;
                for (i, term) in self.model.vocab.iter().enumerate() {
                    if distance(token, term, max_dist) <= max_dist {
                        *acc.entry(i as u32).or_insert(0.0) += FUZZY_WEIGHT;
                        added += 1;
                        if added >= FUZZY_CAP {
                            break;
                        }
                    }
                }
            }
        }
        let mut expanded: Vec<(u32, f32)> = acc.into_iter().collect();
        expanded.sort_by(|a, b| b.1.total_cmp(&a.1));
        expanded.truncate(EXPANSION_CAP);
        expanded.sort_by_key(|(tid, _)| *tid);
        expanded
    }

    /// tf-idf sparse query vector from expanded term weights.
    fn query_sparse(&self, expanded: &[(u32, f32)]) -> SparseVector {
        let mut sparse: SparseVector = expanded
            .iter()
            .map(|&(tid, w)| {
                let idf = self.model.idf.get(tid as usize).copied().unwrap_or(1.0);
                (tid, w * idf)
            })
            .collect();
        let norm = sparse.iter().map(|(_, w)| w * w).sum::<f32>().sqrt();
        if norm > 0.0 {
            for (_, w) in sparse.iter_mut() {
                *w /= norm;
            }
        }
        sparse
    }

    /// Scores every document; returns hits above `MIN_SCORE`, best first.
    fn search(&self, phrase: &str) -> Vec<ScoredDoc> {
        let tokens = tokenize(phrase);
        if tokens.is_empty() {
            return Vec::new();
        }
        let expanded = self.expand_query(&tokens);
        if expanded.is_empty() {
            return Vec::new();
        }
        let query_vector = if self.model.dims > 0 {
            self.model.embed(&self.query_sparse(&expanded))
        } else {
            Vec::new()
        };
        let mut out = Vec::new();
        for (slot, &article_id) in self.doc_ids.iter().enumerate() {
            let semantic = if query_vector.is_empty() {
                0.0
            } else {
                cosine(&query_vector, &self.vectors[slot]).max(0.0)
            };
            let mut lex = 0.0f32;
            for &(tid, q_w) in &expanded {
                let idf = self.model.idf.get(tid as usize).copied().unwrap_or(1.0);
                if let Some(posts) = self.postings.get(&tid)
                    && let Ok(idx) = posts.binary_search_by_key(&(slot as u32), |(d, _)| *d)
                {
                    let tf = posts[idx].1 as f32;
                    let len = self.doc_lens[slot].max(1) as f32;
                    let denom = tf + BM25_K1 * (1.0 - BM25_B + BM25_B * len / self.avg_len);
                    lex += q_w * idf * (tf * (BM25_K1 + 1.0)) / denom;
                }
            }
            let lex = lex / (lex + LEX_SATURATE);
            let score = SEMANTIC_WEIGHT * semantic + (1.0 - SEMANTIC_WEIGHT) * lex;
            if score >= MIN_SCORE {
                out.push(ScoredDoc {
                    article_id,
                    score,
                    semantic,
                    lexical: lex,
                });
            }
        }
        out.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(a.article_id.cmp(&b.article_id))
        });
        out
    }
}

/// A scored page of hits plus the total match count before pagination.
#[derive(Debug)]
pub struct SearchPage {
    pub hits: Vec<ScoredDoc>,
    pub total: usize,
}

/// Process-shared article search index. Clones share one snapshot.
#[derive(Clone)]
pub struct ArticleSearchIndex {
    inner: Arc<RwLock<Snapshot>>,
    db: Database,
    reload_lock: Arc<Mutex<()>>,
    worker_running: Arc<AtomicBool>,
}

impl ArticleSearchIndex {
    /// Creates the index handle; call [`ArticleSearchIndex::load`] to populate.
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Snapshot::empty())),
            db,
            reload_lock: Arc::new(Mutex::new(())),
            worker_running: Arc::new(AtomicBool::new(false)),
        }
    }

    fn conn(&self) -> &DatabaseConnection {
        self.db.get_connection()
    }

    /// Loads the stored model + document rows into a fresh snapshot and swaps
    /// it in. Called on boot and whenever the persisted epoch advances.
    pub async fn load(&self) -> Result<(), DbErr> {
        let _guard = self.reload_lock.lock().await;
        let Some(state) = store::load_state(self.conn()).await? else {
            return Ok(());
        };
        if state.schema_version != store::SCHEMA_VERSION {
            warn!(
                stored = state.schema_version,
                expected = store::SCHEMA_VERSION,
                "article search model schema mismatch; waiting for retrain"
            );
            return Ok(());
        }
        let Some(model) = deserialize_model(&state.blob) else {
            warn!("article search model blob failed to decode; waiting for retrain");
            return Ok(());
        };
        let rows = store::load_docs(self.conn()).await?;
        // Retrain writes epoch-zero docs before publishing and stamping its
        // new model. Never combine rows from that window with another basis.
        if rows.iter().any(|row| row.model_epoch != state.model_epoch) {
            debug!("article search publication in progress; retaining prior snapshot");
            return Ok(());
        }
        let mut doc_ids = Vec::with_capacity(rows.len());
        let mut vectors = Vec::with_capacity(rows.len());
        let mut doc_lens = Vec::with_capacity(rows.len());
        let mut postings: HashMap<u32, Vec<(u32, u32)>> = HashMap::new();
        for row in rows {
            let Some(vector) = deserialize_vector(&row.vector) else {
                continue;
            };
            if vector.len() != model.dims {
                continue;
            }
            let slot = doc_ids.len();
            doc_ids.push(row.article_id);
            vectors.push(vector);
            doc_lens.push(row.plain_len.max(1) as u32);
            for (tid, tf) in deserialize_terms(&row.terms) {
                postings.entry(tid).or_default().push((slot as u32, tf));
            }
        }

        // doc_count describes the training corpus, not the exact incremental
        // row count. Only a nonempty model with no usable docs is inconsistent.
        if state.doc_count > 0 && doc_ids.is_empty() {
            warn!("nonempty article search model has no usable docs; retaining prior snapshot");
            return Ok(());
        }
        for posts in postings.values_mut() {
            posts.sort_by_key(|(slot, _)| *slot);
        }
        let avg_len = if doc_lens.is_empty() {
            1.0
        } else {
            doc_lens.iter().map(|&l| l as f64).sum::<f64>() as f32 / doc_lens.len() as f32
        };
        *self.inner.write().await = Snapshot {
            initialized: true,
            epoch: state.model_epoch,
            model,
            doc_ids,
            vectors,
            postings,
            doc_lens,
            avg_len: avg_len.max(1.0),
        };
        Ok(())
    }

    /// Requires a live worker, a loaded compatible snapshot, and a working DB.
    /// A warm snapshot remains usable while another process retrains it.
    pub async fn is_ready(&self) -> bool {
        if !self.worker_running.load(Ordering::Acquire) || !self.inner.read().await.initialized {
            return false;
        }
        let probe = self.conn().query_one_raw(Statement::from_string(
            DbBackend::MySql,
            "SELECT 1 AS ready",
        ));
        matches!(tokio::time::timeout(Duration::from_secs(1), probe).await,
            Ok(Ok(Some(row))) if matches!(row.try_get::<i32>("", "ready"), Ok(1)))
            && self.worker_running.load(Ordering::Acquire)
    }

    /// Cheap probe — reloads only when the persisted epoch moved.
    pub async fn refresh_if_stale(&self) -> Result<(), DbErr> {
        let current = self.inner.read().await.epoch;
        let Some((epoch, _)) = store::state_probe(self.conn()).await? else {
            return Ok(());
        };
        if epoch != current {
            self.load().await?;
        }
        Ok(())
    }

    /// Scores the phrase against the live snapshot and returns a paginated
    /// page plus the pre-pagination hit count. `limit`/`offset` are already
    /// validated by the resolver. `author_ids` scopes hits to those article
    /// ids BEFORE pagination so an author-scoped query still fills its page
    /// with that author's matches. A stale-snapshot refresh failure degrades
    /// to searching the warm snapshot rather than failing the query.
    pub async fn search(
        &self,
        phrase: &str,
        limit: usize,
        offset: usize,
        author_ids: Option<&std::collections::HashSet<i32>>,
    ) -> Result<SearchPage, DbErr> {
        if let Err(err) = self.refresh_if_stale().await {
            warn!(error = %err, "article search refresh probe failed; serving warm snapshot");
        }
        let snapshot = self.inner.read().await;
        let mut hits = snapshot.search(phrase);
        if let Some(ids) = author_ids {
            hits.retain(|hit| ids.contains(&hit.article_id));
        }
        let total = hits.len();
        Ok(SearchPage {
            hits: hits.into_iter().skip(offset).take(limit).collect(),
            total,
        })
    }

    /// The vocabulary terms a phrase expanded to — used by the resolver to
    /// build excerpts that highlight expanded (prefix/fuzzy) matches too.
    pub async fn expanded_terms(&self, phrase: &str) -> Vec<String> {
        let snapshot = self.inner.read().await;
        let tokens = tokenize(phrase);
        snapshot
            .expand_query(&tokens)
            .into_iter()
            .filter_map(|(tid, _)| snapshot.model.vocab.get(tid as usize).cloned())
            .collect()
    }

    /// Current number of indexed documents — exposed for health/diagnostics.
    pub async fn doc_count(&self) -> usize {
        self.inner.read().await.doc_ids.len()
    }
}

/// Embeds one fetched article under the snapshot's model and persists it.
/// Returns false (without error) when the model is not trained yet — the row
/// is then produced by the next retrain pass.
async fn sync_article<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    article: &store::ArticleSource,
) -> Result<bool, DbErr> {
    if snapshot.model.dims == 0 {
        return Ok(false);
    }
    let name_tokens = tokenize(&article.name);
    let abstract_tokens = tokenize(article.article_abstract.as_deref().unwrap_or_default());
    let content_plain = strip_html(article.content.as_deref().unwrap_or_default());
    let content_tokens = tokenize(&content_plain);
    // Field-weighted counts feed both the LSA embedding and the BM25 term
    // statistics, so the incremental path stores exactly what a retrain would.
    let counts = lsa::article_term_counts(&name_tokens, &abstract_tokens, &content_tokens);
    let sparse = snapshot.model.sparse_vector(&counts);
    let vector = snapshot.model.embed(&sparse);
    let terms: Vec<(u32, u32)> = {
        let mut terms: Vec<(u32, u32)> = counts
            .iter()
            .filter_map(|(term, count)| snapshot.model.index.get(term).map(|&tid| (tid, *count)))
            .collect();
        terms.sort_by_key(|(tid, _)| *tid);
        terms
    };
    let plain_len = content_plain.chars().count().max(1) as i32;
    store::upsert_doc(
        conn,
        article.id,
        snapshot.epoch,
        plain_len,
        lsa::serialize_vector(&vector),
        lsa::serialize_terms(&terms),
    )
    .await?;
    Ok(true)
}

/// Drains the queue: syncs each pending article under the current model.
/// Returns the number of articles whose content changed (drift count) — used
/// to decide whether a full retrain is worthwhile.
async fn drain_queue(
    index: &ArticleSearchIndex,
    conn: &DatabaseConnection,
) -> Result<usize, DbErr> {
    let pending = store::pending(conn, DRAIN_BATCH).await?;
    if pending.is_empty() {
        return Ok(0);
    }
    let mut drifted = 0usize;
    for article_id in pending {
        match store::fetch_article(conn, article_id).await {
            Ok(Some(article)) => {
                let snapshot = index.inner.read().await;
                match sync_article(conn, &snapshot, &article).await {
                    Ok(synced) => {
                        drop(snapshot);
                        store::dequeue(conn, article_id).await?;
                        drifted += 1;
                        if !synced {
                            debug!(article_id, "model not trained; leaving for retrain");
                        }
                    }
                    Err(err) => {
                        drop(snapshot);
                        warn!(article_id, error = %err, "article index sync failed");
                        store::mark_attempt(conn, article_id, &err.to_string()).await?;
                    }
                }
            }
            Ok(None) => {
                store::delete_doc(conn, article_id).await?;
                store::dequeue(conn, article_id).await?;
                drifted += 1;
            }
            Err(err) => {
                warn!(article_id, error = %err, "article fetch failed");
                store::mark_attempt(conn, article_id, &err.to_string()).await?;
            }
        }
    }
    Ok(drifted)
}

/// Diffs `tanah_article` against `article_search_doc` via server-side content
/// hashes and enqueues anything missing, changed, or carrying a stale model
/// epoch; deletes index rows whose articles vanished.
async fn reconcile(conn: &DatabaseConnection) -> Result<usize, DbErr> {
    let indexed: HashMap<i32, [u8; 16]> = store::indexed_hashes(conn).await?.into_iter().collect();
    let mut dirty = 0usize;
    for (article_id, hash) in store::sweep_hashes(conn).await? {
        if indexed.get(&article_id) != Some(&hash) {
            store::enqueue(conn, article_id).await?;
            dirty += 1;
        }
    }
    // Stale-epoch docs (written by an older basis) — re-fold them.
    let stale = conn
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::MySql,
            "SELECT article_id FROM article_search_doc WHERE model_epoch <> \
             (SELECT model_epoch FROM article_search_state WHERE id = 1)",
        ))
        .await?;
    for row in stale {
        if let Ok(id) = row.try_get::<i32>("", "article_id") {
            store::enqueue(conn, id).await?;
            dirty += 1;
        }
    }
    // Orphaned docs — articles deleted outside the queue path, or
    // moved outside the canonical chapter range since they were indexed.
    let orphans = conn
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::MySql,
            "SELECT d.article_id FROM article_search_doc d \
             LEFT JOIN tanah_article a ON a.id = d.article_id \
             WHERE a.id IS NULL OR a.perek_id NOT BETWEEN 1 AND 929",
        ))
        .await?;
    for row in orphans {
        if let Ok(id) = row.try_get::<i32>("", "article_id") {
            store::delete_doc(conn, id).await?;
            dirty += 1;
        }
    }
    Ok(dirty)
}

/// Named locks belong to physical MySQL sessions, not the connection pool.
/// Never return a session that might own this lock to the pool, even if an
/// acquisition response, retrain, or release is interrupted by cancellation.
enum RetrainLock<'a> {
    MySql(Mutex<PoolConnection<MySql>>),
    Mock(&'a DatabaseConnection),
}

impl<'a> RetrainLock<'a> {
    async fn acquire(conn: &'a DatabaseConnection) -> Result<Option<Self>, DbErr> {
        if conn.is_mock_connection() {
            return Ok(store::try_lock(conn).await?.then_some(Self::Mock(conn)));
        }
        if !matches!(
            conn.inner,
            DatabaseConnectionType::SqlxMySqlPoolConnection(_)
        ) {
            return Err(DbErr::Custom(
                "article-search retraining requires MySQL".into(),
            ));
        }
        let pool = conn.get_mysql_connection_pool();
        let mut session = pool
            .acquire()
            .await
            .map_err(|err| DbErr::Conn(RuntimeErr::SqlxError(err.into())))?;
        // Set this BEFORE GET_LOCK: MySQL may grant it before cancellation
        // prevents the response from reaching this future.
        session.close_on_drop();
        let acquired: Option<i64> =
            sqlx::query_scalar("SELECT GET_LOCK('article_search_retrain', 0)")
                .fetch_one(&mut *session)
                .await
                .map_err(|err| DbErr::Query(RuntimeErr::SqlxError(err.into())))?;
        match acquired {
            Some(1) => Ok(Some(Self::MySql(Mutex::new(session)))),
            Some(0) => Ok(None),
            _ => Err(DbErr::Custom(
                "MySQL failed to acquire the article-search named lock".into(),
            )),
        }
    }

    async fn release(self) -> Result<(), DbErr> {
        match self {
            Self::MySql(session) => {
                let mut session = session.into_inner();
                let released: Option<i64> =
                    sqlx::query_scalar("SELECT RELEASE_LOCK('article_search_retrain')")
                        .fetch_one(&mut *session)
                        .await
                        .map_err(|err| DbErr::Query(RuntimeErr::SqlxError(err.into())))?;
                if released != Some(1) {
                    return Err(DbErr::Custom(
                        "article-search retrain session did not own its named lock".into(),
                    ));
                }
                session
                    .close()
                    .await
                    .map_err(|err| DbErr::Conn(RuntimeErr::SqlxError(err.into())))
            }
            Self::Mock(conn) => store::release_lock(conn).await,
        }
    }
}

// Mirror SeaORM's SQLx binder, preserving its typed parameters and row/result
// conversions while keeping every retrain statement on the lock-owning session.
fn retrain_query(stmt: &Statement) -> sqlx::query::Query<'_, MySql, SqlxValues> {
    sqlx::query_with(
        sqlx::AssertSqlSafe(stmt.sql.as_str()),
        SqlxValues(stmt.values.clone().unwrap_or(Values(Vec::new()))),
    )
}

#[async_graphql::async_trait::async_trait]
impl ConnectionTrait for RetrainLock<'_> {
    fn get_database_backend(&self) -> DbBackend {
        DbBackend::MySql
    }

    async fn execute_raw(&self, stmt: Statement) -> Result<ExecResult, DbErr> {
        match self {
            Self::MySql(session) => {
                let mut session = session.lock().await;
                retrain_query(&stmt)
                    .execute(&mut **session)
                    .await
                    .map(Into::into)
                    .map_err(|err| DbErr::Exec(RuntimeErr::SqlxError(err.into())))
            }
            Self::Mock(conn) => conn.execute_raw(stmt).await,
        }
    }

    async fn execute_unprepared(&self, sql: &str) -> Result<ExecResult, DbErr> {
        match self {
            Self::MySql(session) => {
                let mut session = session.lock().await;
                (&mut **session)
                    .execute(sqlx::AssertSqlSafe(sql.to_owned()))
                    .await
                    .map(Into::into)
                    .map_err(|err| DbErr::Exec(RuntimeErr::SqlxError(err.into())))
            }
            Self::Mock(conn) => conn.execute_unprepared(sql).await,
        }
    }

    async fn query_one_raw(&self, stmt: Statement) -> Result<Option<QueryResult>, DbErr> {
        match self {
            Self::MySql(session) => {
                let mut session = session.lock().await;
                retrain_query(&stmt)
                    .fetch_optional(&mut **session)
                    .await
                    .map(|row| row.map(Into::into))
                    .map_err(|err| DbErr::Query(RuntimeErr::SqlxError(err.into())))
            }
            Self::Mock(conn) => conn.query_one_raw(stmt).await,
        }
    }

    async fn query_all_raw(&self, stmt: Statement) -> Result<Vec<QueryResult>, DbErr> {
        match self {
            Self::MySql(session) => {
                let mut session = session.lock().await;
                retrain_query(&stmt)
                    .fetch_all(&mut **session)
                    .await
                    .map(|rows| rows.into_iter().map(Into::into).collect())
                    .map_err(|err| DbErr::Query(RuntimeErr::SqlxError(err.into())))
            }
            Self::Mock(conn) => conn.query_all_raw(stmt).await,
        }
    }
}

/// Retrains the model over the whole corpus and rewrites all document rows.
/// Guarded by a MySQL advisory lock so multiple API instances never retrain
/// concurrently. Returns the trained doc count, or `None` when another
/// instance holds the lock.
pub async fn retrain(conn: &DatabaseConnection) -> Result<Option<usize>, DbErr> {
    let Some(lock) = RetrainLock::acquire(conn).await? else {
        debug!("another instance is retraining the article index");
        return Ok(None);
    };
    let result = retrain_locked(&lock).await;
    if let Err(err) = lock.release().await {
        warn!(error = %err, "failed to release article-search retrain lock");
    }
    result.map(Some)
}

async fn retrain_locked<C: ConnectionTrait>(conn: &C) -> Result<usize, DbErr> {
    let rows = conn
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::MySql,
            "SELECT id, name, abstract, content FROM tanah_article WHERE perek_id BETWEEN 1 AND 929",
        ))
        .await?;
    let mut counts_per_doc = Vec::with_capacity(rows.len());
    let mut metas = Vec::with_capacity(rows.len());
    for row in &rows {
        let name: String = row.try_get("", "name")?;
        let abstract_: Option<String> = row.try_get("", "abstract")?;
        let content: Option<String> = row.try_get("", "content")?;
        let plain = strip_html(content.as_deref().unwrap_or_default());
        let counts = lsa::article_term_counts(
            &tokenize(&name),
            &tokenize(abstract_.as_deref().unwrap_or_default()),
            &tokenize(&plain),
        );
        counts_per_doc.push(counts);
        metas.push((
            row.try_get::<i32>("", "id")?,
            plain.chars().count().max(1) as i32,
        ));
    }
    let (vocab, _df, idf) = LsaModel::build_vocabulary(&counts_per_doc);
    let index_map: HashMap<String, u32> = vocab
        .iter()
        .enumerate()
        .map(|(i, t)| (t.clone(), i as u32))
        .collect();
    let builder = LsaModel {
        dims: 0,
        vocab: vocab.clone(),
        index: index_map,
        idf: idf.clone(),
        basis: Vec::new(),
    };
    let sparse: Vec<SparseVector> = counts_per_doc
        .iter()
        .map(|c| builder.sparse_vector(c))
        .collect();
    let model = LsaModel::train(vocab, idf, &sparse);
    info!(
        docs = rows.len(),
        vocab = model.vocab.len(),
        dims = model.dims,
        "article search model retrained"
    );
    // Persist docs first, then bump the state epoch so readers never load a
    // half-written index under the new epoch.
    for (i, (article_id, plain_len)) in metas.iter().enumerate() {
        let vector = model.embed(&sparse[i]);
        let raw: Vec<(u32, u32)> = counts_per_doc[i]
            .iter()
            .filter_map(|(term, count)| model.index.get(term).map(|&tid| (tid, *count)))
            .collect::<Vec<_>>();
        let mut raw = raw;
        raw.sort_by_key(|(tid, _)| *tid);
        store::upsert_doc(
            conn,
            *article_id,
            0,
            *plain_len,
            lsa::serialize_vector(&vector),
            lsa::serialize_terms(&raw),
        )
        .await?;
    }
    store::save_state(
        conn,
        model.dims as i32,
        rows.len() as i32,
        lsa::serialize_model(&model),
    )
    .await?;
    // Stamp all rows with the new epoch in one statement.
    conn.execute_raw(sea_orm::Statement::from_string(
        sea_orm::DbBackend::MySql,
        "UPDATE article_search_doc d JOIN article_search_state s ON s.id = 1 \
         SET d.model_epoch = s.model_epoch",
    ))
    .await?;
    Ok(rows.len())
}

struct WorkerLiveness(Arc<AtomicBool>);

impl Drop for WorkerLiveness {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

async fn initialize(index: &ArticleSearchIndex) {
    if let Err(err) = index.load().await {
        warn!(error = %err, "article search initial load failed");
    }
    // A compatible persisted snapshot (including a trained empty corpus) can
    // serve immediately. Do not contend with an existing retrain on rolling boot.
    let initialized = index.inner.read().await.initialized;
    if !initialized {
        match retrain(index.conn()).await {
            Ok(Some(n)) => info!(docs = n, "article search index built"),
            Ok(None) => {}
            Err(err) => warn!(error = %err, "initial article index build failed"),
        }
        if let Err(err) = index.load().await {
            warn!(error = %err, "article search reload failed");
        }
    }
}

/// Boot-time ensure + the background worker: drain the queue every
/// `TICK_SECS`, reconcile by content hash every `SWEEP_EVERY_TICKS` ticks, and
/// retrain when drift crosses the threshold. Never returns under normal
/// operation; panics would kill the spawned task without taking the API down.
pub async fn run_worker(index: ArticleSearchIndex) {
    let _liveness = WorkerLiveness(index.worker_running.clone());
    index.worker_running.store(true, Ordering::Release);
    if let Err(err) = store::ensure_schema(index.conn()).await {
        warn!(error = %err, "article search schema setup failed; worker exiting");
        return;
    }
    initialize(&index).await;
    let mut tick: u32 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
        // A different instance may have owned GET_LOCK during our first boot.
        // Recover on the existing tick without blocking that owner or claiming ready.
        let initialized = index.inner.read().await.initialized;
        if !initialized {
            initialize(&index).await;
            continue;
        }
        tick = tick.wrapping_add(1);
        worker_tick(&index, tick).await;
    }
}

/// One worker iteration: periodic hash sweep, queue drain, then either a
/// retrain (drift crossed the threshold) or a snapshot fold-in reload.
async fn worker_tick(index: &ArticleSearchIndex, tick: u32) {
    if tick.is_multiple_of(SWEEP_EVERY_TICKS) {
        match reconcile(index.conn()).await {
            Ok(dirty) if dirty > 0 => {
                debug!(dirty, "article search reconcile enqueued drifted rows")
            }
            Ok(_) => {}
            Err(err) => warn!(error = %err, "article search reconcile failed"),
        }
    }
    let dirty = match drain_queue(index, index.conn()).await {
        Ok(n) => n,
        Err(err) => {
            warn!(error = %err, "article search queue drain failed");
            return;
        }
    };
    let docs = index.doc_count().await;
    let should_retrain = (docs == 0 && dirty > 0)
        || dirty >= RETRAIN_MIN_DIRTY
        || (docs > 0 && dirty as f32 / docs.max(1) as f32 >= RETRAIN_RATIO);
    if should_retrain {
        match retrain(index.conn()).await {
            Ok(Some(n)) => {
                info!(docs = n, "article search model retrained");
                if let Err(err) = index.load().await {
                    warn!(error = %err, "article search reload failed");
                }
            }
            Ok(None) => {}
            Err(err) => warn!(error = %err, "article search retrain failed"),
        }
    } else if dirty > 0 {
        // Fold-in path: reload so freshly synced rows are searchable.
        if let Err(err) = index.load().await {
            warn!(error = %err, "article search reload failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lsa::{serialize_model, serialize_terms, serialize_vector};
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult, Value};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    /// A 1-dimension model over three terms; every term maps to the same latent
    /// direction so any indexed document scores cosine ~1 against any query.
    fn toy_model() -> LsaModel {
        LsaModel {
            dims: 1,
            vocab: vec!["alpha".into(), "beta".into(), "gamma".into()],
            index: HashMap::from([
                ("alpha".into(), 0_u32),
                ("beta".into(), 1_u32),
                ("gamma".into(), 2_u32),
            ]),
            idf: vec![2.0, 1.5, 1.0],
            basis: vec![1.0, 1.0, 1.0],
        }
    }

    /// `(article_id, [(term_id, tf)], plain_len)`
    type FixtureDoc = (i32, Vec<(u32, u32)>, u32);

    /// Builds a snapshot around `model` from `(article_id, terms, plain_len)` docs.
    fn make_snapshot(model: LsaModel, docs: Vec<FixtureDoc>) -> Snapshot {
        let mut doc_ids = Vec::new();
        let mut vectors = Vec::new();
        let mut doc_lens = Vec::new();
        let mut postings: HashMap<u32, Vec<(u32, u32)>> = HashMap::new();
        for (slot, (article_id, terms, len)) in docs.into_iter().enumerate() {
            doc_ids.push(article_id);
            doc_lens.push(len.max(1));
            let sparse: SparseVector = terms.iter().map(|&(tid, tf)| (tid, tf as f32)).collect();
            vectors.push(model.embed(&sparse));
            for &(tid, tf) in &terms {
                postings.entry(tid).or_default().push((slot as u32, tf));
            }
        }
        for posts in postings.values_mut() {
            posts.sort_by_key(|(slot, _)| *slot);
        }
        let avg =
            doc_lens.iter().map(|&l| l as f64).sum::<f64>() as f32 / doc_lens.len().max(1) as f32;
        Snapshot {
            initialized: true,
            epoch: 1,
            model,
            doc_ids,
            vectors,
            postings,
            doc_lens,
            avg_len: avg.max(1.0),
        }
    }

    fn mock_conn() -> MockDatabase {
        MockDatabase::new(DatabaseBackend::MySql)
    }

    fn index_on(conn: sea_orm::DatabaseConnection) -> ArticleSearchIndex {
        ArticleSearchIndex::new(Database::from_connection(conn))
    }

    #[test]
    fn expand_query_matches_exact_prefix_and_fuzzy_terms() {
        let snapshot = make_snapshot(toy_model(), Vec::new());

        // Exact vocabulary hit → full weight, nothing else expanded.
        let expanded = snapshot.expand_query(&["alpha".into()]);
        assert_eq!(expanded, vec![(0, 1.0)]);

        // Unknown token that prefixes a vocab term → PREFIX_WEIGHT.
        let expanded = snapshot.expand_query(&["alp".into()]);
        assert_eq!(expanded, vec![(0, PREFIX_WEIGHT)]);

        // Edit-distance-1 token that prefixes nothing → FUZZY_WEIGHT.
        let expanded = snapshot.expand_query(&["gama".into()]);
        assert_eq!(expanded, vec![(2, FUZZY_WEIGHT)]);

        // Short tokens cannot fuzzy-match and empty tokens are skipped.
        assert!(snapshot.expand_query(&["ab".into()]).is_empty());
        assert_eq!(
            snapshot.expand_query(&[String::new(), "beta".into()]),
            vec![(1, 1.0)]
        );
    }

    #[test]
    fn expand_query_caps_prefixes_and_query_length() {
        // More prefix candidates than PREFIX_CAP → the loop stops at the cap.
        let vocab: Vec<String> = (0..30).map(|i| format!("term{i:02}")).collect();
        let model = LsaModel {
            dims: 0,
            index: vocab
                .iter()
                .enumerate()
                .map(|(i, t)| (t.clone(), i as u32))
                .collect(),
            vocab,
            idf: vec![1.0; 30],
            basis: Vec::new(),
        };
        let snapshot = make_snapshot(model, Vec::new());
        let expanded = snapshot.expand_query(&["term".into()]);
        assert_eq!(expanded.len(), PREFIX_CAP);
        assert!(expanded.iter().all(|&(_, w)| w == PREFIX_WEIGHT));

        // Tokens beyond MAX_QUERY_TOKENS never reach the accumulator.
        let snapshot = make_snapshot(toy_model(), Vec::new());
        let tokens: Vec<String> = (0..20).map(|_| "alpha".into()).collect();
        let expanded = snapshot.expand_query(&tokens);
        assert_eq!(expanded, vec![(0, MAX_QUERY_TOKENS as f32)]);
    }

    #[test]
    fn query_sparse_applies_idf_and_normalizes() {
        let snapshot = make_snapshot(toy_model(), Vec::new());

        // idf[0]=2.0, idf[1]=1.5 → raw (2.0, 1.5), norm 2.5 → (0.8, 0.6).
        let sparse = snapshot.query_sparse(&[(0, 1.0), (1, 1.0)]);
        assert_eq!(sparse.len(), 2);
        assert!((sparse[0].1 - 0.8).abs() < 1e-6);
        assert!((sparse[1].1 - 0.6).abs() < 1e-6);

        // Unknown term ids fall back to idf 1.0.
        let sparse = snapshot.query_sparse(&[(99, 1.0)]);
        assert_eq!(sparse, vec![(99, 1.0)]);

        // A zero-magnitude vector stays zero instead of dividing by zero.
        let sparse = snapshot.query_sparse(&[(0, 0.0)]);
        assert_eq!(sparse, vec![(0, 0.0)]);
    }

    #[test]
    fn snapshot_search_scores_semantic_and_lexical_components() {
        let snapshot = make_snapshot(
            toy_model(),
            vec![
                (7, vec![(0, 4), (1, 1)], 20),
                (9, vec![(1, 3)], 15),
                (11, vec![(2, 2)], 10),
            ],
        );

        // Empty and unexpandable phrases short-circuit.
        assert!(snapshot.search("").is_empty());
        assert!(snapshot.search("!!!").is_empty());
        assert!(snapshot.search("unrelated").is_empty());

        // All docs share the latent direction; the doc actually containing
        // "alpha" additionally earns the lexical component and ranks first.
        let hits = snapshot.search("alpha");
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].article_id, 7);
        assert!(hits[0].semantic > 0.9);
        assert!(hits[0].lexical > hits[1].lexical);

        // Equal scores fall back to article-id order.
        assert_eq!(hits[1].article_id, 9);
        assert_eq!(hits[2].article_id, 11);
    }

    #[test]
    fn snapshot_search_lexical_only_filters_below_min_score() {
        let mut model = toy_model();
        model.dims = 0;
        model.basis = Vec::new();
        let snapshot = make_snapshot(
            model,
            vec![(1, vec![(0, 4), (1, 4)], 10), (2, vec![(0, 1)], 10)],
        );

        // dims=0 → no semantic component; a single weak term stays under
        // MIN_SCORE while the two-term doc survives.
        let hits = snapshot.search("alpha beta");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].article_id, 1);
        assert_eq!(hits[0].semantic, 0.0);
    }

    #[tokio::test]
    async fn load_without_state_leaves_the_index_empty() {
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let index = index_on(conn);
        index.load().await.expect("load without state");
        assert_eq!(index.doc_count().await, 0);
    }

    #[tokio::test]
    async fn load_rejects_mismatched_schema_and_undecodable_blobs() {
        // Wrong schema version → wait for a retrain, keep the empty snapshot.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("schema_version", 999_i32.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 1_i32.into()),
                    ("model", vec![1_u8].into()),
                ])],
            ])
            .into_connection();
        let index = index_on(conn);
        index.load().await.expect("schema mismatch is not fatal");
        assert_eq!(index.doc_count().await, 0);

        // A blob that fails to decode also just waits for the next retrain.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 1_i32.into()),
                    ("model", vec![9_u8, 9, 9].into()),
                ])],
            ])
            .into_connection();
        let index = index_on(conn);
        index.load().await.expect("corrupt blob is not fatal");
        assert_eq!(index.doc_count().await, 0);
    }

    #[tokio::test]
    async fn load_swaps_in_docs_and_skips_bad_rows() {
        let model = toy_model();
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 1_i32.into()),
                    ("model_epoch", 3_i32.into()),
                    ("model", serialize_model(&model).into()),
                ])],
                vec![
                    // Wrong blob length → not deserializable.
                    mock_row([
                        ("article_id", 20_i32.into()),
                        ("plain_len", 10_i32.into()),
                        ("model_epoch", 3_i32.into()),
                        ("vector", vec![1_u8, 2, 3].into()),
                        ("terms", vec![].into()),
                    ]),
                    // Decodes but the dimension does not match the model.
                    mock_row([
                        ("article_id", 21_i32.into()),
                        ("plain_len", 10_i32.into()),
                        ("model_epoch", 3_i32.into()),
                        ("vector", serialize_vector(&[1.0, 2.0]).into()),
                        ("terms", vec![].into()),
                    ]),
                    mock_row([
                        ("article_id", 22_i32.into()),
                        ("plain_len", 10_i32.into()),
                        ("model_epoch", 3_i32.into()),
                        ("vector", serialize_vector(&[1.0]).into()),
                        ("terms", serialize_terms(&[(0, 4)]).into()),
                    ]),
                ],
            ])
            .into_connection();
        let index = index_on(conn);
        index.load().await.expect("load");

        assert_eq!(index.doc_count().await, 1);
        let page = index.search("alpha", 10, 0, None).await.expect("search");
        assert_eq!(page.total, 1);
        assert_eq!(page.hits[0].article_id, 22);
        assert!(
            page.hits[0].lexical > 0.0,
            "skipped corrupt rows must not shift posting slots"
        );
    }

    #[tokio::test]
    async fn load_defers_incomplete_publication_and_preserves_the_warm_snapshot() {
        let doc = |epoch: i32, valid: bool| {
            mock_row([
                ("article_id", 1_i32.into()),
                ("model_epoch", epoch.into()),
                ("plain_len", 10_i32.into()),
                (
                    "vector",
                    if valid {
                        serialize_vector(&[1.0]).into()
                    } else {
                        vec![1_u8].into()
                    },
                ),
                ("terms", serialize_terms(&[(0, 4)]).into()),
            ])
        };
        for rows in [
            vec![doc(7_i32, true), doc(0_i32, true)],
            Vec::new(),
            vec![doc(7_i32, false)],
        ] {
            for warm in [false, true] {
                let conn = mock_conn()
                    .append_query_results([
                        vec![mock_row([
                            ("schema_version", store::SCHEMA_VERSION.into()),
                            ("model_epoch", 7_i32.into()),
                            ("doc_count", 1_i32.into()),
                            ("model", serialize_model(&toy_model()).into()),
                        ])],
                        rows.clone(),
                        vec![mock_row([("ready", 1_i32.into())])],
                    ])
                    .into_connection();
                let index = index_on(conn);
                index.worker_running.store(true, Ordering::Release);
                if warm {
                    *index.inner.write().await =
                        make_snapshot(toy_model(), vec![(99, vec![(0, 4)], 10)]);
                }
                index.load().await.expect("defer inconsistent publication");
                assert_eq!(index.is_ready().await, warm);
                let snapshot = index.inner.read().await;
                assert_eq!(snapshot.doc_ids, if warm { vec![99] } else { Vec::new() });
            }
        }
    }

    #[tokio::test]
    async fn load_accepts_incremental_row_count_changes_under_the_same_model() {
        let conn = mock_conn()
            .append_query_results([
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("model_epoch", 7_i32.into()),
                    ("doc_count", 1_i32.into()),
                    ("model", serialize_model(&toy_model()).into()),
                ])],
                [1_i32, 2]
                    .map(|id| {
                        mock_row([
                            ("article_id", id.into()),
                            ("model_epoch", 7_i32.into()),
                            ("plain_len", 10_i32.into()),
                            ("vector", serialize_vector(&[1.0]).into()),
                            ("terms", serialize_terms(&[(0, 4)]).into()),
                        ])
                    })
                    .to_vec(),
            ])
            .into_connection();
        let index = index_on(conn);
        index.load().await.expect("incremental docs");
        assert_eq!(index.doc_count().await, 2);
        assert!(index.inner.read().await.initialized);
    }

    #[tokio::test]
    async fn refresh_if_stale_reloads_only_when_the_epoch_moves() {
        // No state row → nothing to reload.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let index = index_on(conn);
        index.refresh_if_stale().await.expect("probe without state");
        assert_eq!(index.doc_count().await, 0);

        // Same epoch → the probe returns without touching docs.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("model_epoch", 1_i32.into()),
                    ("doc_count", 5_i32.into()),
                ])],
            ])
            .into_connection();
        let index = index_on(conn);
        *index.inner.write().await = make_snapshot(toy_model(), Vec::new());
        index
            .refresh_if_stale()
            .await
            .expect("same epoch skips reload");

        // Moved epoch → full reload (state + docs queries follow the probe).
        let model = toy_model();
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("model_epoch", 9_i32.into()),
                    ("doc_count", 1_i32.into()),
                ])],
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 1_i32.into()),
                    ("model_epoch", 9_i32.into()),
                    ("model", serialize_model(&model).into()),
                ])],
                vec![mock_row([
                    ("article_id", 30_i32.into()),
                    ("plain_len", 10_i32.into()),
                    ("model_epoch", 9_i32.into()),
                    ("vector", serialize_vector(&[1.0]).into()),
                    ("terms", serialize_terms(&[(0, 1)]).into()),
                ])],
            ])
            .into_connection();
        let index = index_on(conn);
        index
            .refresh_if_stale()
            .await
            .expect("reload on epoch bump");
        assert_eq!(index.doc_count().await, 1);
    }

    #[tokio::test]
    async fn index_search_paginates_and_survives_probe_failures() {
        let conn = mock_conn()
            .append_query_errors([DbErr::Custom("probe down".to_string())])
            .into_connection();
        let index = index_on(conn);
        *index.inner.write().await = make_snapshot(
            toy_model(),
            vec![(7, vec![(0, 4)], 20), (9, vec![(1, 3)], 15)],
        );

        // The failed refresh probe degrades to the warm snapshot.
        let page = index
            .search("alpha", 10, 0, None)
            .await
            .expect("warm search");
        assert_eq!(page.total, 2);

        let page = index.search("alpha", 1, 1, None).await.expect("paginated");
        assert_eq!(page.hits.len(), 1);
        assert_eq!(page.hits[0].article_id, 9);
        assert_eq!(page.total, 2);
    }

    #[tokio::test]
    async fn expanded_terms_reports_exact_and_expanded_vocabulary() {
        let conn = mock_conn().into_connection();
        let index = index_on(conn);
        *index.inner.write().await = make_snapshot(toy_model(), Vec::new());

        let terms = index.expanded_terms("alpha alp gama").await;
        assert!(terms.contains(&"alpha".to_string()));
        assert!(terms.contains(&"gamma".to_string())); // reached via fuzzy expansion
        assert!(index.expanded_terms("zzz").await.is_empty());
    }

    #[tokio::test]
    async fn sync_article_skips_untrained_models_and_writes_trained_ones() {
        let conn = mock_conn().into_connection();
        let article = store::ArticleSource {
            id: 5,
            name: "alpha alpha".into(),
            article_abstract: Some("beta".into()),
            content: Some("<p>alpha gamma gamma</p>".into()),
        };

        // dims=0 → nothing is written until a retrain produces a basis.
        let untrained = Snapshot::empty();
        assert!(
            !sync_article(&conn, &untrained, &article)
                .await
                .expect("untrained sync")
        );

        let conn = mock_conn()
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let trained = make_snapshot(toy_model(), Vec::new());
        assert!(
            sync_article(&conn, &trained, &article)
                .await
                .expect("trained sync")
        );
    }

    #[tokio::test]
    async fn drain_queue_processes_fetches_deletions_and_failures() {
        let model = toy_model();
        // pending [] → nothing to do.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let index = index_on(mock_conn().into_connection());
        *index.inner.write().await = make_snapshot(model.clone(), Vec::new());
        assert_eq!(drain_queue(&index, &conn).await.expect("empty drain"), 0);

        // pending [7] → fetch row → sync (upsert exec) → dequeue exec.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 7_i32.into())])],
                vec![mock_row([
                    ("id", 7_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", "beta".into()),
                ])],
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                2
            ])
            .into_connection();
        assert_eq!(drain_queue(&index, &conn).await.expect("synced drain"), 1);

        // pending [8] → article gone → index row deleted, queue row removed.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 8_i32.into())])],
                vec![],
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                2
            ])
            .into_connection();
        assert_eq!(drain_queue(&index, &conn).await.expect("delete drain"), 1);

        // pending [9] → fetch blows up → attempt is marked, drift stays 0.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 9_i32.into())])],
            ])
            .append_query_errors([DbErr::Custom("fetch lost".to_string())])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        assert_eq!(drain_queue(&index, &conn).await.expect("error drain"), 0);

        // pending [10] → fetch ok but the upsert fails → attempt marked.
        // Results and errors share the mock's exec queue in append order, so
        // the error lands on the upsert and the Ok on mark_attempt.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 10_i32.into())])],
                vec![mock_row([
                    ("id", 10_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", Value::String(None)),
                ])],
            ])
            .append_exec_errors([DbErr::Custom("upsert blew up".to_string())])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        assert_eq!(drain_queue(&index, &conn).await.expect("sync error"), 0);
    }

    #[tokio::test]
    async fn reconcile_enqueues_drift_and_purges_orphans() {
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                // indexed_hashes
                vec![mock_row([
                    ("article_id", 1_i32.into()),
                    ("content_hash", vec![1_u8; 16].into()),
                ])],
                // sweep_hashes — article 2 drifted
                vec![
                    mock_row([
                        ("id", 1_i32.into()),
                        ("content_hash", vec![1_u8; 16].into()),
                    ]),
                    mock_row([
                        ("id", 2_i32.into()),
                        ("content_hash", vec![2_u8; 16].into()),
                    ]),
                ],
                // stale-epoch docs
                vec![mock_row([("article_id", 3_i32.into())])],
                // orphaned docs
                vec![mock_row([("article_id", 4_i32.into())])],
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                3
            ])
            .into_connection();

        let dirty = reconcile(&conn).await.expect("reconcile");
        assert_eq!(dirty, 3);
    }

    #[tokio::test]
    async fn retrain_bails_without_the_lock_and_rebuilds_with_it() {
        // Another instance holds the advisory lock → no retrain happens.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("acquired", 0_i64.into())])],
            ])
            .into_connection();
        assert_eq!(retrain(&conn).await.expect("contended retrain"), None);

        // Lock held → corpus read, per-doc upserts, state save, epoch stamp,
        // lock release — two articles in, two docs out.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("acquired", 1_i64.into())])],
                vec![
                    mock_row([
                        ("id", 1_i32.into()),
                        ("name", "alpha beta".into()),
                        ("abstract", "alpha".into()),
                        ("content", "<p>alpha gamma</p>".into()),
                    ]),
                    mock_row([
                        ("id", 2_i32.into()),
                        ("name", "beta".into()),
                        ("abstract", Value::String(None)),
                        ("content", "gamma".into()),
                    ]),
                ],
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                5
            ])
            .into_connection();
        assert_eq!(retrain(&conn).await.expect("retrain"), Some(2));
    }

    #[tokio::test]
    async fn retrain_rejects_a_disconnected_database() {
        let error = retrain(&DatabaseConnection::default())
            .await
            .expect_err("a named lock requires a MySQL pool");
        assert!(error.to_string().contains("requires MySQL"));
    }

    #[tokio::test]
    async fn retrain_keeps_the_primary_error_when_release_also_fails() {
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("acquired", 1_i64.into())])],
            ])
            .append_query_errors([DbErr::Custom("retrain source read failed".into())])
            .append_exec_errors([DbErr::Custom("lock release also failed".into())])
            .into_connection();
        let error = retrain(&conn).await.expect_err("primary retrain failure");
        assert!(error.to_string().contains("retrain source read failed"));
    }

    /// The API coverage CI job explicitly invokes this real-database regression.
    #[tokio::test]
    #[ignore = "requires isolated MySQL and ARTICLE_SEARCH_LOCK_TEST_DB_URL; API coverage CI runs it"]
    async fn mysql_retrain_lock_is_session_scoped_and_cleans_up() {
        use sea_orm::{
            SqlxMySqlConnector,
            sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions},
        };
        let url = std::env::var("ARTICLE_SEARCH_LOCK_TEST_DB_URL")
            .expect("isolated MySQL fixture URL is required");
        let options: MySqlConnectOptions = url.parse().expect("valid fixture URL");
        // Never run this regression against the application's database.
        assert_eq!(options.get_database(), Some("article_search_lock_test"));
        let pool = MySqlPoolOptions::new()
            .max_connections(4)
            .min_connections(4)
            .connect_with(options.clone())
            .await
            .expect("isolated fixture");
        let conn = SqlxMySqlConnector::from_sqlx_mysql_pool(pool.clone());
        // Own and reset only this explicitly named disposable fixture DB.
        pool.execute("DROP TABLE IF EXISTS tanah_article, article_search_state, article_search_doc, article_search_queue")
            .await.expect("reset isolated fixture");

        let first = RetrainLock::acquire(&conn)
            .await
            .expect("acquire")
            .expect("lock");
        let holder: Option<u64> =
            sqlx::query_scalar("SELECT IS_USED_LOCK('article_search_retrain')")
                .fetch_one(&pool)
                .await
                .expect("inspect holder");
        let mut other = pool.acquire().await.expect("another physical session");
        let other_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
            .fetch_one(&mut *other)
            .await
            .expect("other session id");
        assert_ne!(holder, Some(other_id));
        drop(other);
        // Sharing the same pool must not re-enter the first session's lock.
        assert!(
            RetrainLock::acquire(&conn)
                .await
                .expect("second worker")
                .is_none()
        );
        first.release().await.expect("same-session release");
        assert_retrain_lock_free(&pool).await;

        // The empty fixture has no source table: a real retrain SQL error
        // must release ownership without closing the shared pool.
        assert!(retrain(&conn).await.is_err());
        assert_retrain_lock_free(&pool).await;

        // Cancellation bypasses release(); close-on-drop must still free it.
        let (ready, acquired) = tokio::sync::oneshot::channel();
        let worker_conn = conn.clone();
        let worker = tokio::spawn(async move {
            let lock = RetrainLock::acquire(&worker_conn)
                .await
                .expect("worker acquire")
                .expect("worker owns lock");
            ready.send(()).expect("signal acquisition");
            std::future::pending::<()>().await;
            drop(lock);
        });
        acquired.await.expect("worker started");
        assert!(
            RetrainLock::acquire(&conn)
                .await
                .expect("contender")
                .is_none()
        );
        worker.abort();
        assert!(worker.await.expect_err("worker cancelled").is_cancelled());
        assert_retrain_lock_free(&pool).await;
        let next = RetrainLock::acquire(&conn)
            .await
            .expect("reacquire")
            .expect("next worker");
        next.release().await.expect("next release");

        pool.execute("CREATE TABLE IF NOT EXISTS lock_cancellation_probe (id INT PRIMARY KEY, value INT NOT NULL)")
            .await.expect("isolated probe table");
        pool.execute("DELETE FROM lock_cancellation_probe")
            .await
            .expect("empty isolated probe");
        let (ready, started) = tokio::sync::oneshot::channel();
        let work_conn = conn.clone();
        let in_flight = tokio::spawn(async move {
            let lock = RetrainLock::acquire(&work_conn)
                .await
                .expect("work acquire")
                .expect("work lock");
            let id = lock
                .query_one_raw(Statement::from_string(
                    DbBackend::MySql,
                    "SELECT CONNECTION_ID() AS id",
                ))
                .await
                .expect("work session")
                .expect("work session row")
                .try_get::<u64>("", "id")
                .expect("work id");
            ready.send(id).expect("signal work session");
            lock.execute_raw(Statement::from_string(
                DbBackend::MySql,
                "INSERT INTO lock_cancellation_probe VALUES (1, SLEEP(0.5))",
            ))
            .await
            .expect("delayed mutation");
            lock.release().await.expect("work release");
        });
        let work_id = started.await.expect("work started");
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let state: Option<String> = sqlx::query_scalar(
                    "SELECT STATE FROM information_schema.PROCESSLIST WHERE ID = ?",
                )
                .bind(work_id)
                .fetch_optional(&pool)
                .await
                .expect("observe in-flight SQL")
                .flatten();
                if state.as_deref() == Some("User sleep") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("mutation must be running before cancellation");
        in_flight.abort();
        assert!(
            in_flight
                .await
                .expect_err("in-flight worker cancelled")
                .is_cancelled()
        );
        let newer = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(lock) = RetrainLock::acquire(&conn).await.expect("new worker") {
                    break lock;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cancelled session eventually frees its lock");
        let still_running: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID = ? AND INFO IS NOT NULL",
        )
        .bind(work_id)
        .fetch_one(&pool)
        .await
        .expect("old SQL status");
        assert_eq!(
            still_running, 0,
            "a newer worker must never overlap cancelled in-flight SQL"
        );
        newer.release().await.expect("new worker release");

        // Losing the named lock is reported instead of treating a successful
        // SQL response (RELEASE_LOCK=0/NULL) as a successful release.
        let mut lost = RetrainLock::acquire(&conn)
            .await
            .expect("acquire lost lock")
            .expect("lost lock guard");
        if let RetrainLock::MySql(session) = &mut lost {
            let _: Option<i64> =
                sqlx::query_scalar("SELECT RELEASE_LOCK('article_search_retrain')")
                    .fetch_one(&mut **session.get_mut())
                    .await
                    .expect("simulate lost ownership");
        } else {
            panic!("real MySQL session required");
        }
        assert!(lost.release().await.is_err());
        assert_retrain_lock_free(&pool).await;

        // Exercise the complete production retrain path, including the same
        // typed integer/blob parameters used by SeaORM's normal binder.
        pool.execute("CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY, name TEXT NOT NULL, abstract TEXT NULL, content TEXT NULL, perek_id INT NOT NULL, author_id INT NOT NULL)")
            .await.expect("isolated article source");
        pool.execute("INSERT INTO tanah_article VALUES (1, 'alpha beta', 'alpha', '<p>alpha gamma</p>', 1, 1), (2, 'beta gamma', NULL, 'gamma delta', 1, 1)")
            .await.expect("isolated source rows");
        store::ensure_schema(&conn)
            .await
            .expect("derived fixture schema");
        assert_eq!(
            retrain(&conn).await.expect("real complete retrain"),
            Some(2)
        );
        let state: (i32, i32, i32) = sqlx::query_as(
            "SELECT schema_version, model_epoch, doc_count FROM article_search_state WHERE id = 1",
        )
        .fetch_one(&pool)
        .await
        .expect("trained state");
        assert_eq!(state, (store::SCHEMA_VERSION, 1, 2));
        let docs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM article_search_doc WHERE model_epoch = 1 AND OCTET_LENGTH(vector) > 0 AND OCTET_LENGTH(terms) > 0",
        ).fetch_one(&pool).await.expect("bound document blobs");
        assert_eq!(docs, 2);

        // The adapter runs the body on its retained session, so a one-slot
        // pool is supported rather than requiring spare connection capacity.
        let small_pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("one-slot pool");
        let small = SqlxMySqlConnector::from_sqlx_mysql_pool(small_pool.clone());
        let single = RetrainLock::acquire(&small)
            .await
            .expect("one-slot acquire")
            .expect("one-slot owns lock");
        let row = single
            .query_one_raw(Statement::from_string(
                DbBackend::MySql,
                "SELECT CONNECTION_ID() AS id",
            ))
            .await
            .expect("same-session query")
            .expect("session id");
        let id: u64 = row.try_get("", "id").expect("decode session id");
        let owner = single
            .query_one_raw(Statement::from_string(
                DbBackend::MySql,
                "SELECT IS_USED_LOCK('article_search_retrain') AS id",
            ))
            .await
            .expect("lock owner query")
            .expect("lock owner row");
        assert_eq!(owner.try_get::<u64>("", "id").expect("owner id"), id);
        assert_eq!(single.get_database_backend(), DbBackend::MySql);
        assert!(matches!(
            single
                .execute_raw(Statement::from_string(
                    DbBackend::MySql,
                    "INSERT INTO lock_adapter_missing_table VALUES (1)"
                ))
                .await,
            Err(DbErr::Exec(_))
        ));
        assert!(matches!(
            single
                .execute_unprepared("UPDATE lock_adapter_missing_table SET id = 2")
                .await,
            Err(DbErr::Exec(_))
        ));
        assert!(matches!(
            single
                .query_one_raw(Statement::from_string(
                    DbBackend::MySql,
                    "SELECT id FROM lock_adapter_missing_table"
                ))
                .await,
            Err(DbErr::Query(_))
        ));
        assert!(matches!(
            single
                .query_all_raw(Statement::from_string(
                    DbBackend::MySql,
                    "SELECT id FROM lock_adapter_missing_table"
                ))
                .await,
            Err(DbErr::Query(_))
        ));
        assert!(
            single
                .query_one_raw(Statement::from_string(
                    DbBackend::MySql,
                    "SELECT 1 AS value WHERE FALSE"
                ))
                .await
                .expect("empty result")
                .is_none()
        );
        let after_error = single
            .query_one_raw(Statement::from_string(
                DbBackend::MySql,
                "SELECT CONNECTION_ID() AS id",
            ))
            .await
            .expect("session survives SQL error")
            .expect("session id after error");
        assert_eq!(
            after_error.try_get::<u64>("", "id").expect("same session"),
            id
        );
        single
            .execute_unprepared("UPDATE lock_cancellation_probe SET value = value + 1")
            .await
            .expect("same-session unprepared statement");
        single.release().await.expect("one-slot release");
        assert_eq!(
            retrain(&small).await.expect("one-slot complete retrain"),
            Some(2)
        );
        small_pool.close().await;
        pool.close().await;
    }

    async fn assert_retrain_lock_free(pool: &sqlx::MySqlPool) {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let free: Option<i64> =
                    sqlx::query_scalar("SELECT IS_FREE_LOCK('article_search_retrain')")
                        .fetch_one(pool)
                        .await
                        .expect("inspect named lock");
                if free == Some(1) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("dropped session must release its named lock");
    }

    #[tokio::test]
    async fn run_worker_exits_when_schema_setup_fails() {
        let conn = mock_conn()
            .append_exec_errors([DbErr::Custom("no database".to_string())])
            .into_connection();
        let index = index_on(conn);
        // Never reaches the tick loop — returns immediately.
        run_worker(index).await;
    }

    #[tokio::test]
    async fn run_worker_boots_and_parks_in_the_tick_sleep() {
        let model = toy_model();
        let conn = mock_conn()
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1
                };
                3
            ])
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 1_i32.into()),
                    ("model", serialize_model(&model).into()),
                ])],
                vec![],
                vec![mock_row([("ready", 1_i32.into())])],
            ])
            .into_connection();
        let index = index_on(conn);
        let handle = tokio::spawn(run_worker(index.clone()));
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        // Even an empty loaded snapshot is valid; no GET_LOCK was attempted.
        assert!(index.is_ready().await);
        assert!(!handle.is_finished());
        handle.abort();
        let _ = handle.await;
        assert!(
            !index.is_ready().await,
            "cancelled worker must not remain ready"
        );
    }

    #[tokio::test]
    async fn cold_worker_recovers_after_another_instance_releases_the_lock() {
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![], // first load: no model
                vec![mock_row([("acquired", 0_i64.into())])],
                vec![], // other owner has not published yet
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 1_i32.into()),
                    ("model", serialize_model(&toy_model()).into()),
                ])],
                vec![],
                vec![mock_row([("ready", 1_i32.into())])],
            ])
            .into_connection();
        let index = index_on(conn);
        let _liveness = WorkerLiveness(index.worker_running.clone());
        index.worker_running.store(true, Ordering::Release);
        initialize(&index).await;
        assert!(!index.is_ready().await);
        initialize(&index).await;
        assert!(index.is_ready().await);
    }

    #[tokio::test]
    async fn readiness_rejects_cold_missing_failed_and_invalid_database_probes() {
        for result in [
            Ok(vec![]),
            Ok(vec![mock_row([("ready", 0_i32.into())])]),
            Ok(vec![mock_row([("wrong_column", 1_i32.into())])]),
            Err(DbErr::Custom("database unavailable".into())),
        ] {
            let conn = match result {
                Ok(rows) => mock_conn().append_query_results([rows]),
                Err(err) => mock_conn().append_query_errors([err]),
            }
            .into_connection();
            let index = index_on(conn);
            assert!(!index.is_ready().await, "cold snapshot is not ready");
            *index.inner.write().await = make_snapshot(toy_model(), Vec::new());
            assert!(
                !index.is_ready().await,
                "snapshot without a worker is not ready"
            );
            index.worker_running.store(true, Ordering::Release);
            assert!(!index.is_ready().await);
        }
    }

    #[tokio::test]
    async fn worker_trains_the_first_queued_article_after_an_empty_corpus() {
        let article = || {
            mock_row([
                ("id", 7_i32.into()),
                ("name", "alpha".into()),
                ("abstract", Value::String(None)),
                ("content", "alpha beta".into()),
            ])
        };
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 7_i32.into())])],
                vec![article()],
                vec![mock_row([("acquired", 1_i64.into())])],
                vec![article()],
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 1_i32.into()),
                    ("model_epoch", 2_i32.into()),
                    ("model", serialize_model(&toy_model()).into()),
                ])],
                vec![mock_row([
                    ("article_id", 7_i32.into()),
                    ("plain_len", 10_i32.into()),
                    ("model_epoch", 2_i32.into()),
                    ("vector", serialize_vector(&[1.0]).into()),
                    ("terms", serialize_terms(&[(0, 4)]).into()),
                ])],
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1
                };
                5
            ])
            .into_connection();
        let index = index_on(conn);
        worker_tick(&index, 1).await;
        assert_eq!(index.doc_count().await, 1);
        assert_eq!(index.inner.read().await.search("alpha")[0].article_id, 7);
    }

    #[tokio::test]
    async fn worker_tick_sweeps_drains_and_folds_in() {
        // Ordinary tick with an empty queue → nothing happens.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![],
            ])
            .into_connection();
        let index = index_on(conn);
        worker_tick(&index, 1).await;

        // Sweep tick → reconcile queries, then the drain.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![], // indexed hashes
                vec![], // sweep hashes
                vec![], // stale docs
                vec![], // orphans
                vec![], // pending
            ])
            .into_connection();
        let index = index_on(conn);
        worker_tick(&index, SWEEP_EVERY_TICKS).await;

        // Drain failure logs and returns without touching reload logic.
        let conn = mock_conn()
            .append_query_errors([DbErr::Custom("queue gone".to_string())])
            .into_connection();
        let index = index_on(conn);
        worker_tick(&index, 2).await;

        // dirty=1 on a small index → drift ratio ≥ RETRAIN_RATIO → retrain.
        let model = toy_model();
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 7_i32.into())])], // pending
                vec![mock_row([
                    ("id", 7_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", "beta".into()),
                ])], // fetch
                vec![mock_row([("acquired", 1_i64.into())])],   // retrain lock
                vec![mock_row([
                    ("id", 7_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", "beta".into()),
                ])], // corpus
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 9_i32.into()),
                    ("model", serialize_model(&model).into()),
                ])], // reload state
                vec![],                                         // reload docs
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                6
            ])
            .into_connection();
        let index = index_on(conn);
        *index.inner.write().await = make_snapshot(toy_model(), vec![(1, vec![(0, 1)], 10)]);
        worker_tick(&index, 3).await;

        // dirty=1 on a large index → under the ratio → fold-in reload only.
        let conn = mock_conn()
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                vec![mock_row([("article_id", 8_i32.into())])], // pending
                vec![mock_row([
                    ("id", 8_i32.into()),
                    ("name", "alpha".into()),
                    ("abstract", Value::String(None)),
                    ("content", "beta".into()),
                ])], // fetch
                vec![mock_row([
                    ("schema_version", store::SCHEMA_VERSION.into()),
                    ("doc_count", 0_i32.into()),
                    ("model_epoch", 2_i32.into()),
                    ("model", serialize_model(&toy_model()).into()),
                ])], // fold-in load state
                vec![],                                         // fold-in docs
            ])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                2
            ])
            .into_connection();
        let index = index_on(conn);
        let big: Vec<FixtureDoc> = (100..200).map(|id| (id, vec![(0, 1)], 10)).collect();
        *index.inner.write().await = make_snapshot(toy_model(), big);
        worker_tick(&index, 4).await;
    }
}
