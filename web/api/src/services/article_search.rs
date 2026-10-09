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
use std::sync::Arc;
use std::time::Duration;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr};
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
}

impl ArticleSearchIndex {
    /// Creates the index handle; call [`ArticleSearchIndex::load`] to populate.
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Snapshot::empty())),
            db,
            reload_lock: Arc::new(Mutex::new(())),
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
        let mut doc_ids = Vec::with_capacity(rows.len());
        let mut vectors = Vec::with_capacity(rows.len());
        let mut doc_lens = Vec::with_capacity(rows.len());
        let mut postings: HashMap<u32, Vec<(u32, u32)>> = HashMap::new();
        for (slot, row) in rows.into_iter().enumerate() {
            let Some(vector) = deserialize_vector(&row.vector) else {
                continue;
            };
            if vector.len() != model.dims {
                continue;
            }
            doc_ids.push(row.article_id);
            vectors.push(vector);
            doc_lens.push(row.plain_len.max(1) as u32);
            for (tid, tf) in deserialize_terms(&row.terms) {
                postings.entry(tid).or_default().push((slot as u32, tf));
            }
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
    /// validated by the resolver. A stale-snapshot refresh failure degrades to
    /// searching the warm snapshot rather than failing the query.
    pub async fn search(
        &self,
        phrase: &str,
        limit: usize,
        offset: usize,
    ) -> Result<SearchPage, DbErr> {
        if let Err(err) = self.refresh_if_stale().await {
            warn!(error = %err, "article search refresh probe failed; serving warm snapshot");
        }
        let snapshot = self.inner.read().await;
        let hits = snapshot.search(phrase);
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
    // Orphaned docs — articles deleted outside the queue path, or made
    // non-distributable since they were indexed.
    let orphans = conn
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::MySql,
            "SELECT d.article_id FROM article_search_doc d \
             LEFT JOIN tanah_article a ON a.id = d.article_id \
             WHERE a.id IS NULL OR a.distributable = FALSE",
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

/// Retrains the model over the whole corpus and rewrites all document rows.
/// Guarded by a MySQL advisory lock so multiple API instances never retrain
/// concurrently. Returns the trained doc count, or `None` when another
/// instance holds the lock.
pub async fn retrain(conn: &DatabaseConnection) -> Result<Option<usize>, DbErr> {
    if !store::try_lock(conn).await? {
        debug!("another instance is retraining the article index");
        return Ok(None);
    }
    let result = retrain_locked(conn).await;
    if let Err(err) = store::release_lock(conn).await {
        warn!(error = %err, "failed to release article-search retrain lock");
    }
    result.map(Some)
}

async fn retrain_locked(conn: &DatabaseConnection) -> Result<usize, DbErr> {
    let rows = conn
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::MySql,
            "SELECT id, name, abstract, content FROM tanah_article WHERE distributable = TRUE",
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

/// Boot-time ensure + the background worker: drain the queue every
/// `TICK_SECS`, reconcile by content hash every `SWEEP_EVERY_TICKS` ticks, and
/// retrain when drift crosses the threshold. Never returns under normal
/// operation; panics would kill the spawned task without taking the API down.
pub async fn run_worker(index: ArticleSearchIndex) {
    if let Err(err) = store::ensure_schema(index.conn()).await {
        warn!(error = %err, "article search schema setup failed; worker exiting");
        return;
    }
    if let Err(err) = index.load().await {
        warn!(error = %err, "article search initial load failed");
    }
    // First boot (no state row) or schema bump → full rebuild from the
    // authoritative tables.
    match store::state_probe(index.conn()).await {
        Ok(Some((_, docs))) if docs > 0 => {}
        _ => match retrain(index.conn()).await {
            Ok(Some(n)) => info!(docs = n, "article search index built"),
            Ok(None) => {}
            Err(err) => warn!(error = %err, "initial article index build failed"),
        },
    }
    if let Err(err) = index.load().await {
        warn!(error = %err, "article search reload failed");
    }
    let mut tick: u32 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
        tick = tick.wrapping_add(1);
        if tick.is_multiple_of(SWEEP_EVERY_TICKS) {
            match reconcile(index.conn()).await {
                Ok(dirty) if dirty > 0 => {
                    debug!(dirty, "article search reconcile enqueued drifted rows")
                }
                Ok(_) => {}
                Err(err) => warn!(error = %err, "article search reconcile failed"),
            }
        }
        let dirty = match drain_queue(&index, index.conn()).await {
            Ok(n) => n,
            Err(err) => {
                warn!(error = %err, "article search queue drain failed");
                continue;
            }
        };
        let docs = index.doc_count().await;
        let should_retrain = dirty >= RETRAIN_MIN_DIRTY
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
}
