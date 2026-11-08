//! Authorized management of an article's DB-supported content relationships
//! (#3102): the typed contract the admin server, the public API and the LLM
//! draft/approval pipeline (#3103) all consume.
//!
//! Covered today:
//! - `primaryPerek` / `author` — required single-valued associations; they can
//!   be replaced but never cleared (NOT NULL columns, no editorial "none").
//! - `coveringSources` + `coverageVerified` — verified pasuk-level coverage;
//!   replace/clear semantics identical to the admin's `covering-sources.ts`.
//! - `dedicationAssignments` — article-scoped dedication links; the dedication
//!   aggregate owns its target list, so writes stay on the dedication
//!   mutations and this service only projects them article-centric.
//! - `mentionAnnotations` — stored span/name annotations owned by the mention
//!   pipeline (`data/annotations` + `devops/import-tanahpedia-mentions.mts`);
//!   read-only here by design — a second write path would compete with the
//!   pipeline's dedupe/content-hash lifecycle.
//! - `moadim` (#3101) — the article↔moed many-to-many; `moedIds` replaces
//!   the full link set. Explicit links are the editorially approved set —
//!   unapproved pipeline proposals (#3103) never land here.
//! - `recurringHebrewDate` (#3098) — pending schema; surfaced honestly as
//!   `pending-schema`, never silently dropped.
//!
//! The relationship catalogue itself lives in
//! `web/shared/article-relationships/registry.json` — the single source of
//! truth compiled into this binary and imported by the admin TS side.

use std::collections::{BTreeSet, HashSet};
use std::sync::LazyLock;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, Statement, TransactionTrait,
};

use crate::common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError};
use crate::common::website_revalidate::{
    ArticleAssociations, ArticleCoveringSpan, Revalidation, WebsiteRevalidator,
};
use crate::dtos::article_relationships::{
    ArticleDedicationLink, ArticleMentionAnnotation, ArticleMoedLink, ArticleRelationships,
    CoveringSource, CoveringSourceInput, UpdateArticleRelationshipsInput,
};
use crate::providers::Database;
use crate::services::article_search::store;
use crate::services::moed_service;
use entities::{
    article, article_covering_source, article_dedication, author, dedication, moed, perek,
};

/// The shared registry, embedded at compile time so the API's
/// `articleRelationshipCapabilities` can never drift from the file the admin
/// and the LLM pipeline consume (`web/shared/article-relationships/`).
/// Anchored at the crate root (not this file's depth): `web/api` in the
/// worktree, `/app` inside the build image where the Dockerfile copies the
/// registry to `/shared/article-relationships`.
const REGISTRY_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/article-relationships/registry.json"
));

/// One registry entry — the Rust mirror of `ArticleRelationshipEntry` in the
/// shared TS module; field names must stay identical for parity.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub key: String,
    pub label: String,
    pub meaning: String,
    pub target_kind: String,
    pub cardinality: String,
    pub link_metadata: Vec<String>,
    pub ownership: String,
    pub permission: Option<String>,
    pub operations: Vec<String>,
    pub write_contract: String,
    pub read_contract: String,
    pub invalidates: String,
    pub status: String,
    #[serde(default)]
    pub pending_issue: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub contract_version: i64,
    pub relationships: Vec<RegistryEntry>,
}

static REGISTRY: LazyLock<Registry> = LazyLock::new(|| {
    // A compile-time artifact: a malformed file is a unit-test failure, not
    // a runtime condition.
    serde_json::from_str(REGISTRY_JSON)
        .expect("article-relationship registry.json must match the Registry shape")
});

/// The parsed catalogue — one entry per DB-supported relationship,
/// including honest `pending-schema` rows for #3098/#3101.
pub fn relationship_registry() -> &'static [RegistryEntry] {
    &REGISTRY.relationships
}

/// The shared contract version — #3103 consumers pin against it.
pub fn contract_version() -> i32 {
    REGISTRY.contract_version as i32
}

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

const ARTICLE_NOT_FOUND: &str = "Article Not Found";
const UTC_ISO: &str = "%Y-%m-%dT%H:%M:%SZ";

/// One row of the management decoration projection: the stored annotation
/// plus whether its `content_hash` still matches the live article body — the
/// same staleness check the public website applies before rendering it.
#[derive(Debug, FromQueryResult)]
struct MentionRow {
    id: String,
    intended_name: String,
    entity_type: String,
    disambiguation: Option<String>,
    confidence: Option<String>,
    acceptance: String,
    model_revision: String,
    span_start: Option<i32>,
    span_end: Option<i32>,
    surface: String,
    content_hash: Option<String>,
    current_content: i64,
}

/// The aggregated relationship read — the article row plus every link list.
#[derive(Debug)]
pub struct ArticleRelationshipsAggregate {
    pub article: article::Model,
    /// Lowercase hex of the row's generated `content_hash` — the freshness
    /// token clients echo back as `expectedContentHash`.
    pub content_hash: String,
    pub covering_sources: Vec<article_covering_source::Model>,
    pub dedications: Vec<ArticleDedicationLink>,
    pub mention_annotations: Vec<ArticleMentionAnnotation>,
    /// The article's explicit moed links — the `moadim` relationship (#3101).
    pub moadim: Vec<ArticleMoedLink>,
}

/// Loads the article's generated `content_hash` as lowercase hex — the
/// column is a stored generated expression so it is not on the entity.
async fn load_content_hash(
    conn: &impl ConnectionTrait,
    article_id: i32,
) -> Result<String, ServiceError> {
    #[derive(FromQueryResult)]
    struct HashRow {
        h: Option<String>,
    }
    let row = HashRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        "SELECT HEX(content_hash) AS h FROM tanah_article WHERE id = ?",
        [article_id.into()],
    ))
    .one(conn)
    .await
    .map_err(db_error)?;
    Ok(row.and_then(|r| r.h).unwrap_or_default().to_lowercase())
}

/// Loads the article's dedication assignments joined to their dedication
/// rows — all states including expired (this is the management view).
async fn load_article_dedications(
    conn: &impl ConnectionTrait,
    article_id: i32,
) -> Result<Vec<ArticleDedicationLink>, ServiceError> {
    let links = article_dedication::Entity::find()
        .filter(article_dedication::Column::ArticleId.eq(article_id))
        .all(conn)
        .await
        .map_err(db_error)?;
    if links.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<i32> = links.iter().map(|link| link.dedication_id).collect();
    let dedications = dedication::Entity::find()
        .filter(dedication::Column::Id.is_in(ids))
        .all(conn)
        .await
        .map_err(db_error)?;
    let by_id: std::collections::HashMap<i32, dedication::Model> =
        dedications.into_iter().map(|d| (d.id, d)).collect();
    let mut out = links
        .into_iter()
        .map(|link| {
            let dedication = by_id.get(&link.dedication_id);
            ArticleDedicationLink {
                dedication_id: link.dedication_id,
                subject: dedication.map(|d| d.subject.clone()),
                expires_at: link.expires_at.map(|t| t.format(UTC_ISO).to_string()),
                dedication_expires_at: dedication
                    .and_then(|d| d.expires_at.map(|t| t.format(UTC_ISO).to_string())),
            }
        })
        .collect::<Vec<_>>();
    out.sort_by_key(|link| link.dedication_id);
    Ok(out)
}

/// Loads the article's stored mention annotations — all acceptance states,
/// since this is the management projection. `current_content` is computed
/// in SQL against the live `content` column (SHA-256, the pipeline's hash).
async fn load_mention_annotations(
    conn: &impl ConnectionTrait,
    article_id: i32,
) -> Result<Vec<ArticleMentionAnnotation>, ServiceError> {
    let rows = MentionRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        "SELECT d.id, d.intended_name, d.entity_type, d.disambiguation,
                CAST(d.confidence AS CHAR) AS confidence,
                d.acceptance, d.model_revision, d.span_start, d.span_end,
                d.surface, d.content_hash,
                (d.content_hash IS NOT NULL AND d.content_hash = LOWER(SHA2(IFNULL(a.content, ''), 256))) AS current_content
         FROM tanahpedia_mention_decoration d
         JOIN tanah_article a ON a.id = d.article_id
         WHERE d.source_kind = 'article' AND d.article_id = ?
         ORDER BY d.span_start",
        [article_id.into()],
    ))
    .all(conn)
    .await
    .map_err(db_error)?;
    Ok(rows
        .into_iter()
        .map(|row| ArticleMentionAnnotation {
            id: row.id,
            intended_name: row.intended_name,
            entity_type: row.entity_type,
            disambiguation: row.disambiguation,
            confidence: row.confidence,
            acceptance: row.acceptance,
            model_revision: row.model_revision,
            span_start: row.span_start,
            span_end: row.span_end,
            surface: row.surface,
            content_hash: row.content_hash,
            current_content: row.current_content != 0,
        })
        .collect())
}

async fn load_covering_sources(
    conn: &impl ConnectionTrait,
    article_id: i32,
) -> Result<Vec<article_covering_source::Model>, ServiceError> {
    article_covering_source::Entity::find()
        .filter(article_covering_source::Column::ArticleId.eq(article_id))
        .order_by_asc(article_covering_source::Column::PerekId)
        .order_by_asc(article_covering_source::Column::Pasuk)
        .all(conn)
        .await
        .map_err(db_error)
}

/// The article-centric read the admin/LLM pipeline uses: current links with
/// stable ids and the freshness tokens the write path checks.
pub async fn load_relationships(
    db: &Database,
    article_id: i32,
) -> Result<ArticleRelationshipsAggregate, ServiceError> {
    let conn = db.get_connection();
    let article = article::Entity::find_by_id(article_id)
        .one(conn)
        .await
        .map_err(db_error)?
        .ok_or_else(|| ServiceError::not_found(ARTICLE_NOT_FOUND, None::<sea_orm::DbErr>))?;
    Ok(ArticleRelationshipsAggregate {
        content_hash: load_content_hash(conn, article_id).await?,
        covering_sources: load_covering_sources(conn, article_id).await?,
        dedications: load_article_dedications(conn, article_id).await?,
        mention_annotations: load_mention_annotations(conn, article_id).await?,
        moadim: moed_service::load_article_moed_links(conn, article_id).await?,
        article,
    })
}

impl From<ArticleRelationshipsAggregate> for ArticleRelationships {
    fn from(value: ArticleRelationshipsAggregate) -> Self {
        Self {
            article_id: value.article.id,
            perek_id: value.article.perek_id as i32,
            author_id: value.article.author_id as i32,
            coverage_verified: value.article.coverage_verified,
            content_hash: value.content_hash,
            covering_sources: value
                .covering_sources
                .into_iter()
                .map(|model| CoveringSource {
                    perek_id: model.perek_id,
                    pasuk: model.pasuk as i32,
                })
                .collect(),
            dedications: value.dedications,
            mention_annotations: value.mention_annotations,
            moadim: value.moadim,
        }
    }
}

/// A normalized covering coordinate — validated shape before the DB checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Coordinate {
    perek_id: i32,
    pasuk: i32,
}

/// Mirrors `normalizeCoveringSources` in the admin's `covering-sources.ts`:
/// integer coordinates, pasuk >= 1 and no duplicate mappings — the composite
/// PK is the backstop, not the contract.
fn normalize_coordinates(
    rows: &[CoveringSourceInput],
    field: &str,
) -> Result<Vec<Coordinate>, ServiceError> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        if row.pasuk < 1 {
            return Err(ServiceError::bad_request(&format!(
                "{field}: covering source pasuk must be at least 1 (got {} for perek {})",
                row.pasuk, row.perek_id
            )));
        }
        let coordinate = Coordinate {
            perek_id: row.perek_id,
            pasuk: row.pasuk,
        };
        if !seen.insert(coordinate) {
            return Err(ServiceError::bad_request(&format!(
                "{field}: duplicate covering source for perek {} pasuk {}",
                row.perek_id, row.pasuk
            )));
        }
        out.push(coordinate);
    }
    Ok(out)
}

/// Mirrors `assertCoveringSourcesExist` in the admin's `covering-sources.ts`:
/// every perek must be canonical and carry its corpus pasuk_count, and every
/// pasuk must be inside that bound — a NULL count means the corpus counts
/// were never loaded, so the write is rejected rather than guessed.
async fn assert_coordinates_exist(
    conn: &impl ConnectionTrait,
    rows: &[Coordinate],
) -> Result<(), ServiceError> {
    let perek_ids: Vec<i32> = {
        let mut ids: Vec<i32> = rows.iter().map(|row| row.perek_id).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    if perek_ids.is_empty() {
        return Ok(());
    }
    let bounds = perek::Entity::find()
        .filter(perek::Column::Id.is_in(perek_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(db_error)?;
    let bound_by_id: std::collections::HashMap<i32, Option<i32>> = bounds
        .into_iter()
        .map(|model| (model.id, model.pasuk_count.map(|count| count as i32)))
        .collect();
    for perek_id in &perek_ids {
        match bound_by_id.get(perek_id) {
            None => {
                return Err(ServiceError::bad_request(&format!(
                    "Covering source perek {perek_id} does not exist"
                )));
            }
            Some(None) => {
                return Err(ServiceError::bad_request(&format!(
                    "Canonical pasuk count is missing for perek {perek_id}; apply tanah_perek_pasuk_count_data.sql"
                )));
            }
            _ => {}
        }
    }
    for row in rows {
        if let Some(Some(count)) = bound_by_id.get(&row.perek_id)
            && row.pasuk > *count
        {
            return Err(ServiceError::bad_request(&format!(
                "Covering source pasuk {} is out of range for perek {} (1-{count})",
                row.pasuk, row.perek_id
            )));
        }
    }
    Ok(())
}

/// Merges single-pasuk rows into contiguous spans — the Rust twin of the
/// admin's `mergeCoveringSpans` so the `coveringSpans` invalidation payload
/// is identical whichever side produced it.
fn merge_covering_spans(rows: &[article_covering_source::Model]) -> Vec<ArticleCoveringSpan> {
    let mut spans: Vec<ArticleCoveringSpan> = Vec::new();
    for row in rows {
        match spans.last_mut() {
            Some(last)
                if last.perek_id == row.perek_id && row.pasuk as i32 <= last.pasuk_to + 1 =>
            {
                last.pasuk_to = last.pasuk_to.max(row.pasuk as i32);
            }
            _ => spans.push(ArticleCoveringSpan {
                perek_id: row.perek_id,
                pasuk_from: row.pasuk as i32,
                pasuk_to: row.pasuk as i32,
            }),
        }
    }
    spans
}

fn is_hex(value: &str, len: usize) -> bool {
    value.len() == len && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Validates a `moedIds` replacement set — positive, unique moed ids —
/// before the transaction starts (target existence is checked inside the
/// lock by `replace_article_moed_links`).
fn normalize_moed_ids(rows: &[i32], field: &str) -> Result<Vec<i32>, ServiceError> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(rows.len());
    for id in rows {
        if *id < 1 {
            return Err(ServiceError::bad_request(&format!(
                "{field}: moed id must be a positive integer (got {id})"
            )));
        }
        if !seen.insert(*id) {
            return Err(ServiceError::bad_request(&format!(
                "{field}: duplicate moed id {id}"
            )));
        }
        out.push(*id);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Target lookup / discovery
// ---------------------------------------------------------------------------

/// Upper bound for target-picker pages — beyond it the request is rejected
/// rather than truncated so abuse is visible (mirrors article search).
pub const TARGET_SEARCH_MAX_LIMIT: i32 = 50;
pub const TARGET_SEARCH_DEFAULT_LIMIT: i32 = 20;

/// One lookup hit for a relationship target picker.
#[derive(Debug, Clone, PartialEq)]
pub struct TargetHit {
    pub id: i32,
    pub label: String,
    pub hint: Option<String>,
}

/// Normalizes for picker matching: trims, lowercases (English), collapses
/// whitespace and strips Hebrew quote marks so the typed query matches the
/// displayed label regardless of gershayim style.
fn normalize_query(query: &str) -> String {
    query
        .replace(['\'', '"', '\u{05f3}', '\u{05f4}'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The perek picker label — the website's `compiled_source` shape:
/// "{sefer name} {additional letter?} {perek in context, Hebrew}".
fn perek_label(model: &perek::Model) -> Option<String> {
    let sefer_name = model.sefer_name.as_ref()?;
    let perek_heb = crate::dtos::perek::number_to_hebrew(model.perek_in_context.unwrap_or(1))
        .replace(['\'', '"', '\u{05f3}', '\u{05f4}'], "");
    Some(match &model.additional_letter {
        Some(letter) => format!(
            "{} {} {}",
            sefer_name,
            letter.replace(['\'', '"', '\u{05f3}', '\u{05f4}'], ""),
            perek_heb
        ),
        None => format!("{} {}", sefer_name, perek_heb),
    })
}

/// Human-readable target lookup for pickers — the searched relation kinds
/// are the ones an editor chooses targets for (`pasukCoordinate` targets
/// are validated inline by the write contract, not searched).
///
/// Each kind loads its candidate set in one query and filters in memory:
/// perakim (929) and authors/dedications (small curated sets) are bounded
/// catalogs, so a normalized substring match beats a LIKE with manual
/// escaping.
pub async fn search_targets(
    db: &Database,
    kind: crate::dtos::article_relationships::ArticleRelationshipTargetKind,
    query: &str,
    limit: Option<i32>,
) -> Result<Vec<TargetHit>, ServiceError> {
    use crate::dtos::article_relationships::ArticleRelationshipTargetKind as Kind;

    let limit = limit.unwrap_or(TARGET_SEARCH_DEFAULT_LIMIT);
    if !(1..=TARGET_SEARCH_MAX_LIMIT).contains(&limit) {
        return Err(ServiceError::bad_request(&format!(
            "limit must be between 1 and {TARGET_SEARCH_MAX_LIMIT}"
        )));
    }
    let needle = normalize_query(query);
    let conn = db.get_connection();
    let hits = match kind {
        Kind::Perek => {
            let perakim = perek::Entity::find()
                .order_by_asc(perek::Column::PerekId)
                .all(conn)
                .await
                .map_err(db_error)?;
            perakim
                .iter()
                .filter_map(|model| {
                    let label = perek_label(model)?;
                    Some(TargetHit {
                        id: model.id,
                        hint: model.pasuk_count.map(|count| format!("{} פסוקים", count)),
                        label,
                    })
                })
                .filter(|hit| needle.is_empty() || normalize_query(&hit.label).contains(&needle))
                .take(limit as usize)
                .collect()
        }
        Kind::Author => {
            let authors = author::Entity::find()
                .order_by_asc(author::Column::Name)
                .all(conn)
                .await
                .map_err(db_error)?;
            authors
                .into_iter()
                .map(|model| TargetHit {
                    id: model.id,
                    label: model.name,
                    hint: None,
                })
                .filter(|hit| needle.is_empty() || normalize_query(&hit.label).contains(&needle))
                .take(limit as usize)
                .collect()
        }
        Kind::Dedication => {
            let dedications = dedication::Entity::find()
                .order_by_asc(dedication::Column::Subject)
                .all(conn)
                .await
                .map_err(db_error)?;
            dedications
                .into_iter()
                .map(|model| TargetHit {
                    id: model.id,
                    hint: model
                        .expires_at
                        .map(|t| format!("פג תוקף {}", t.format(UTC_ISO))),
                    label: model.subject,
                })
                .filter(|hit| needle.is_empty() || normalize_query(&hit.label).contains(&needle))
                .take(limit as usize)
                .collect()
        }
        Kind::Moed => {
            let moadim = moed::Entity::find()
                .order_by_asc(moed::Column::Name)
                .all(conn)
                .await
                .map_err(db_error)?;
            moadim
                .into_iter()
                .map(|model| TargetHit {
                    id: model.id,
                    hint: Some(model.slug.clone()),
                    label: model.name,
                })
                .filter(|hit| {
                    needle.is_empty()
                        || normalize_query(&hit.label).contains(&needle)
                        || hit
                            .hint
                            .as_deref()
                            .is_some_and(|slug| normalize_query(slug).contains(&needle))
                })
                .take(limit as usize)
                .collect()
        }
    };
    Ok(hits)
}

/// The mutation result: the post-commit aggregate plus the pre-commit
/// snapshot (the supported undo path — re-submit its fields to restore) and
/// the website invalidation outcome. `previous.contentHash` is the freshness
/// token the undo write itself needs, i.e. the post-write hash.
#[derive(Debug)]
pub struct UpdateOutcome {
    pub relationships: ArticleRelationships,
    pub previous: ArticleRelationships,
    pub revalidation: &'static str,
}

/// Applies the relationship writes declared by `input` in one transaction.
///
/// Omitted fields leave their relation untouched; an explicitly empty
/// `coveringSources` clears only that relation — a single-link edit never
/// replaces unrelated fields/links. `expectedContentHash` /
/// `expectedCoveringSources` / `expectedMoedIds` are the freshness
/// contract: supplied snapshots are compared under the article row lock,
/// so a stale editor can never overwrite a newer link it never saw.
pub async fn update_relationships(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    article_id: i32,
    input: UpdateArticleRelationshipsInput,
) -> Result<UpdateOutcome, ServiceError> {
    let source = input.source.trim();
    if source.is_empty() {
        return Err(ServiceError::bad_request(
            "source is required — name the actor/pipeline performing this write",
        ));
    }
    let expected_hash = input
        .expected_content_hash
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if is_hex(value, 32) {
                Ok(value.to_lowercase())
            } else {
                Err(ServiceError::bad_request(
                    "expectedContentHash must be the 32-hex contentHash returned by articleRelationships",
                ))
            }
        })
        .transpose()?;
    let covering_rows = input
        .covering_sources
        .as_deref()
        .map(|rows| normalize_coordinates(rows, "coveringSources"))
        .transpose()?;
    let expected_covering = input
        .expected_covering_sources
        .as_deref()
        .map(|rows| normalize_coordinates(rows, "expectedCoveringSources"))
        .transpose()?;
    let moed_ids = input
        .moed_ids
        .as_deref()
        .map(|ids| normalize_moed_ids(ids, "moedIds"))
        .transpose()?;
    let expected_moed_ids = input
        .expected_moed_ids
        .as_deref()
        .map(|ids| normalize_moed_ids(ids, "expectedMoedIds"))
        .transpose()?;

    let txn = db.get_connection().begin().await.map_err(db_error)?;
    // Lock the article row for the whole read-check-write sequence: the
    // freshness comparisons below run against the latest committed state and
    // concurrent writers serialize on this lock.
    let current = article::Entity::find_by_id(article_id)
        .lock_exclusive()
        .one(&txn)
        .await
        .map_err(db_error)?
        .ok_or_else(|| ServiceError::not_found(ARTICLE_NOT_FOUND, None::<sea_orm::DbErr>))?;

    if let Some(expected) = expected_hash {
        let actual = load_content_hash(&txn, article_id).await?;
        if actual != expected {
            return Err(ServiceError::bad_request(
                "the article was changed since this edit loaded - reload its relationships and submit again",
            ));
        }
    }

    let previous_covering = load_covering_sources(&txn, article_id).await?;
    if let Some(expected) = expected_covering {
        let mut actual: Vec<Coordinate> = previous_covering
            .iter()
            .map(|row| Coordinate {
                perek_id: row.perek_id,
                pasuk: row.pasuk as i32,
            })
            .collect();
        actual.sort_unstable();
        let mut expected_sorted = expected;
        expected_sorted.sort_unstable();
        if actual != expected_sorted {
            return Err(ServiceError::bad_request(
                "the article's covering sources were changed since this edit loaded - reload and submit again",
            ));
        }
    }
    // Pre-write moed link set — the undo snapshot plus half of the old∪new
    // invalidation payload when `moedIds` lands below.
    let previous_moadim = moed_service::load_article_moed_links(&txn, article_id).await?;
    // content_hash covers the article row alone, never junction rows — a
    // full-set moed replacement needs its own snapshot guard so a stale
    // editor cannot erase links it never saw.
    if let Some(expected) = expected_moed_ids {
        let mut actual: Vec<i32> = previous_moadim.iter().map(|link| link.moed_id).collect();
        actual.sort_unstable();
        let mut expected_sorted = expected;
        expected_sorted.sort_unstable();
        if actual != expected_sorted {
            return Err(ServiceError::bad_request(
                "the article's moed links were changed since this edit loaded - reload and submit again",
            ));
        }
    }

    // Target validation — inside the lock so the checked state is the
    // committed state. Single-valued relations validate their target exists.
    if let Some(perek_id) = input.perek_id
        && perek::Entity::find_by_id(perek_id)
            .one(&txn)
            .await
            .map_err(db_error)?
            .is_none()
    {
        return Err(ServiceError::bad_request(&format!(
            "Perek {perek_id} does not exist"
        )));
    }
    if let Some(author_id) = input.author_id
        && author::Entity::find_by_id(author_id)
            .one(&txn)
            .await
            .map_err(db_error)?
            .is_none()
    {
        return Err(ServiceError::bad_request(&format!(
            "Author {author_id} does not exist"
        )));
    }
    if let Some(rows) = &covering_rows {
        assert_coordinates_exist(&txn, rows).await?;
    }

    let mut changed = false;

    // Single-valued fields: only provided values that actually differ move.
    {
        let mut update = article::Entity::update_many().filter(article::Column::Id.eq(article_id));
        let mut fields_changed = false;
        if let Some(perek_id) = input.perek_id
            && perek_id as i16 != current.perek_id
        {
            update = update.col_expr(article::Column::PerekId, Expr::value(perek_id as i16));
            fields_changed = true;
        }
        if let Some(author_id) = input.author_id
            && author_id as i16 != current.author_id
        {
            update = update.col_expr(article::Column::AuthorId, Expr::value(author_id as i16));
            fields_changed = true;
        }
        if fields_changed {
            update.exec(&txn).await.map_err(db_error)?;
            changed = true;
        }
    }

    // Coverage semantics — mirrors the admin's replaceCoveringSources /
    // updateCoverageVerified contract: an explicit set (empty included) is
    // stored verbatim with the declared verified flag (default false), and a
    // flag-only write toggles the state on the persisted set. Verified
    // always requires at least one stored row.
    let mut coverage_state_changed = false;
    if let Some(rows) = &covering_rows {
        let verified = input.coverage_verified.unwrap_or(false);
        if verified && rows.is_empty() {
            return Err(ServiceError::bad_request(
                "Verified coverage requires at least one covering source; submit coverageVerified: false to keep coverage unknown",
            ));
        }
        article_covering_source::Entity::delete_many()
            .filter(article_covering_source::Column::ArticleId.eq(article_id))
            .exec(&txn)
            .await
            .map_err(db_error)?;
        let models: Vec<article_covering_source::ActiveModel> = rows
            .iter()
            .map(|row| article_covering_source::ActiveModel {
                article_id: sea_orm::Set(article_id),
                perek_id: sea_orm::Set(row.perek_id),
                pasuk: sea_orm::Set(row.pasuk as i16),
                created_at: sea_orm::NotSet,
            })
            .collect();
        if !models.is_empty() {
            article_covering_source::Entity::insert_many(models)
                .exec(&txn)
                .await
                .map_err(db_error)?;
        }
        article::Entity::update_many()
            .col_expr(article::Column::CoverageVerified, Expr::value(verified))
            .filter(article::Column::Id.eq(article_id))
            .exec(&txn)
            .await
            .map_err(db_error)?;
        changed = true;
        coverage_state_changed = true;
    } else if let Some(verified) = input.coverage_verified {
        if verified && previous_covering.is_empty() {
            return Err(ServiceError::bad_request(
                "Cannot verify coverage for an article with no covering sources; add covering sources or submit coverageVerified: false",
            ));
        }
        if verified != current.coverage_verified {
            article::Entity::update_many()
                .col_expr(article::Column::CoverageVerified, Expr::value(verified))
                .filter(article::Column::Id.eq(article_id))
                .exec(&txn)
                .await
                .map_err(db_error)?;
            changed = true;
        }
        coverage_state_changed = true;
    }

    // Moed link-set replacement — the `moadim` relationship (#3101). The
    // (id, slug) pairs of the old ∪ new targets are collected inside the
    // transaction so the post-commit invalidation expires every moed page
    // the edit touched without a second lookup.
    let mut affected_moadim: Vec<(i32, String)> = Vec::new();
    if let Some(ids) = &moed_ids
        && moed_service::replace_article_moed_links(&txn, article_id, ids).await?
    {
        changed = true;
        let mut moed_id_union: BTreeSet<i32> =
            previous_moadim.iter().map(|link| link.moed_id).collect();
        moed_id_union.extend(ids.iter().copied());
        affected_moadim = moed_service::moed_id_slugs(&txn, &moed_id_union).await?;
    }

    let previous = ArticleRelationshipsAggregate {
        // Loaded post-write on purpose: it is the freshness token the undo
        // write must present, since the generated hash covers the link fields.
        content_hash: load_content_hash(&txn, article_id).await?,
        article: current.clone(),
        covering_sources: previous_covering,
        dedications: load_article_dedications(&txn, article_id).await?,
        mention_annotations: load_mention_annotations(&txn, article_id).await?,
        moadim: previous_moadim,
    };

    if changed {
        // Same-transaction enqueue: perek/author/coverage changes alter the
        // article's search projection (and its generated content_hash), so
        // the index must refresh — identical to the admin save path.
        store::enqueue(&txn, article_id).await.map_err(db_error)?;
    }

    txn.commit().await.map_err(db_error)?;

    // Post-commit website invalidation — the same `article` entity change the
    // admin server posts, carrying old ∪ new associations and the destroyed
    // covering spans.
    let revalidation = if changed {
        let mut perek_ids = HashSet::from([current.perek_id as i32]);
        if let Some(perek_id) = input.perek_id {
            perek_ids.insert(perek_id);
        }
        let mut author_ids = HashSet::from([current.author_id as i32]);
        if let Some(author_id) = input.author_id {
            author_ids.insert(author_id);
        }
        let mut perek_sorted: Vec<i32> = perek_ids.into_iter().collect();
        perek_sorted.sort_unstable();
        let mut author_sorted: Vec<i32> = author_ids.into_iter().collect();
        author_sorted.sort_unstable();
        let covering_spans = if coverage_state_changed {
            merge_covering_spans(&previous.covering_sources)
        } else {
            Vec::new()
        };
        revalidator
            .invalidate_article_with_moadim(
                article_id,
                &ArticleAssociations {
                    perek_ids: perek_sorted,
                    author_ids: author_sorted,
                    covering_spans,
                },
                &affected_moadim,
            )
            .await
            .as_str()
    } else {
        Revalidation::Skipped.as_str()
    };

    let updated = load_relationships(db, article_id).await?;
    // The audit record: the actor (`source`) plus before/after link state.
    // Correction/undo is supported by re-submitting `previous`' fields.
    let previous_covering_count = previous.covering_sources.len();
    let new_covering_count = updated.covering_sources.len();
    tracing::info!(
        %source,
        %article_id,
        previous_perek_id = current.perek_id,
        previous_author_id = current.author_id,
        previous_covering_count,
        previous_coverage_verified = current.coverage_verified,
        previous_moed_ids = ?previous
            .moadim
            .iter()
            .map(|link| link.moed_id)
            .collect::<Vec<_>>(),
        new_perek_id = updated.article.perek_id,
        new_author_id = updated.article.author_id,
        new_covering_count,
        new_coverage_verified = updated.article.coverage_verified,
        new_moed_ids = ?updated
            .moadim
            .iter()
            .map(|link| link.moed_id)
            .collect::<Vec<_>>(),
        revalidation,
        "Article relationships updated"
    );

    Ok(UpdateOutcome {
        relationships: updated.into(),
        previous: previous.into(),
        revalidation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_deserializes_and_lists_every_relationship() {
        let keys: Vec<&str> = relationship_registry()
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert_eq!(
            keys,
            [
                "primaryPerek",
                "author",
                "coveringSources",
                "dedicationAssignments",
                "mentionAnnotations",
                "recurringHebrewDate",
                "moadim"
            ]
        );
        let pending: Vec<&RegistryEntry> = relationship_registry()
            .iter()
            .filter(|entry| entry.status == "pending-schema")
            .collect();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].pending_issue, Some(3098));
        // #3101 landed — moadim is a supported replace/clear relationship.
        let moadim = relationship_registry()
            .iter()
            .find(|entry| entry.key == "moadim")
            .unwrap();
        assert_eq!(moadim.status, "supported");
        assert_eq!(moadim.pending_issue, None);
        // Supported entries all carry operations; pending ones do not.
        for entry in relationship_registry() {
            if entry.status == "supported" {
                assert!(!entry.operations.is_empty(), "{}", entry.key);
            } else {
                assert!(entry.operations.is_empty(), "{}", entry.key);
            }
        }
    }

    #[test]
    fn normalize_coordinates_rejects_invalid_and_duplicate_rows() {
        assert!(
            normalize_coordinates(
                &[CoveringSourceInput {
                    perek_id: 1,
                    pasuk: 0
                }],
                "coveringSources"
            )
            .is_err()
        );
        assert!(
            normalize_coordinates(
                &[
                    CoveringSourceInput {
                        perek_id: 1,
                        pasuk: 1
                    },
                    CoveringSourceInput {
                        perek_id: 1,
                        pasuk: 1
                    }
                ],
                "coveringSources"
            )
            .is_err()
        );
        assert_eq!(
            normalize_coordinates(
                &[
                    CoveringSourceInput {
                        perek_id: 2,
                        pasuk: 1
                    },
                    CoveringSourceInput {
                        perek_id: 1,
                        pasuk: 1
                    }
                ],
                "coveringSources"
            )
            .unwrap()
            .len(),
            2
        );
    }

    #[test]
    fn merge_covering_spans_merges_contiguous_pesukim_only() {
        let row = |perek_id, pasuk| article_covering_source::Model {
            article_id: 1,
            perek_id,
            pasuk,
            created_at: chrono::Utc::now(),
        };
        let spans = merge_covering_spans(&[row(1, 1), row(1, 2), row(1, 4), row(2, 1)]);
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0].pasuk_from, 1);
        assert_eq!(spans[0].pasuk_to, 2);
        assert_eq!(spans[1].pasuk_from, 4);
        assert_eq!(spans[1].pasuk_to, 4);
        assert_eq!(spans[2].perek_id, 2);
    }

    #[test]
    fn hex_check_accepts_only_exact_length_hex() {
        assert!(is_hex("0123456789abcdef0123456789ABCDEF", 32));
        assert!(!is_hex("0123", 32));
        assert!(!is_hex("0123456789abcdef0123456789abcdeg", 32));
    }

    #[test]
    fn normalize_query_strips_marks_and_collapses_whitespace() {
        assert_eq!(normalize_query("  בראשית   א  "), "בראשית א");
        assert_eq!(normalize_query("בראשית \"א"), "בראשית א");
        assert_eq!(normalize_query("BERESHIT"), "bereshit");
    }

    #[test]
    fn covering_source_input_and_update_input_derives_are_exercised() {
        let coordinate = CoveringSourceInput {
            perek_id: 1,
            pasuk: 2,
        };
        let cloned = coordinate.clone();
        assert_eq!(coordinate, cloned);
        assert_ne!(
            coordinate,
            CoveringSourceInput {
                perek_id: 1,
                pasuk: 3
            }
        );
        assert!(format!("{coordinate:?}").contains("CoveringSourceInput"));

        let input = UpdateArticleRelationshipsInput {
            source: "admin".to_string(),
            perek_id: Some(1),
            author_id: None,
            moed_ids: None,
            covering_sources: Some(vec![coordinate]),
            coverage_verified: None,
            expected_content_hash: None,
            expected_covering_sources: None,
            expected_moed_ids: None,
        };
        let input = input.clone();
        assert!(format!("{input:?}").contains("UpdateArticleRelationshipsInput"));
    }

    #[test]
    fn perek_label_matches_the_website_compiled_source() {
        let mut model = perek::Model {
            id: 1,
            perek_id: Some(1),
            sefer_id: Some(1),
            sefer_name: Some("בראשית".to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(1),
            perek_in_context: Some(1),
            date: None,
            hebdate: None,
            tseit: None,
            header: None,
            pasuk_count: Some(31),
        };
        assert_eq!(perek_label(&model).as_deref(), Some("בראשית א"));
        model.additional_letter = Some("א".to_string());
        assert_eq!(perek_label(&model).as_deref(), Some("בראשית א א"));
        model.sefer_name = None;
        assert!(perek_label(&model).is_none());
    }

    mod update {
        use super::*;
        use crate::dtos::article_relationships::ArticleRelationshipTargetKind;
        use entities::article_moed;
        use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult, Value};
        use std::collections::BTreeMap;

        fn skipped_revalidator() -> WebsiteRevalidator {
            WebsiteRevalidator::new(None, None)
        }

        fn article_model(id: i32) -> article::Model {
            article::Model {
                id,
                perek_id: 1,
                author_id: 2,
                article_abstract: None,
                name: format!("article-{id}"),
                priority: 1,
                content: Some("content".to_string()),
                coverage_verified: false,
            }
        }

        fn covering_model(
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

        fn hash_row(hash: &str) -> BTreeMap<String, Value> {
            [("h".to_string(), hash.to_string().into())]
                .into_iter()
                .collect()
        }

        fn input() -> UpdateArticleRelationshipsInput {
            UpdateArticleRelationshipsInput {
                source: "admin".to_string(),
                perek_id: None,
                author_id: None,
                moed_ids: None,
                covering_sources: None,
                coverage_verified: None,
                expected_content_hash: None,
                expected_covering_sources: None,
                expected_moed_ids: None,
            }
        }

        /// Asserts no INSERT/UPDATE/DELETE statement ran — validation
        /// failures must leave the store untouched.
        fn assert_no_writes(db: &Database) {
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            for verb in ["INSERT INTO", "UPDATE `", "DELETE FROM"] {
                assert!(!log.contains(verb), "unexpected write {verb}: {log}");
            }
        }

        /// The queries of the post-commit `load_relationships` reload
        /// (empty link sets for the fixture article).
        fn reload_results(mock: MockDatabase, article: article::Model) -> MockDatabase {
            mock.append_query_results::<article::Model, Vec<_>, _>([vec![article]])
                .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]])
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
        }

        #[tokio::test]
        async fn rejects_blank_source_and_bad_hash_without_touching_the_db() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql).into_connection(),
            );
            for mut edit in [input(), input()] {
                edit.source = "   ".to_string();
                let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                    .await
                    .unwrap_err();
                assert!(matches!(err, ServiceError::BadRequest(_)));
            }
            let mut edit = input();
            edit.expected_content_hash = Some("not-hex".to_string());
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(
                db.get_connection()
                    .clone()
                    .into_transaction_log()
                    .is_empty()
            );
        }

        #[tokio::test]
        async fn rejects_a_stale_expected_content_hash_inside_the_lock() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.expected_content_hash = Some("a".repeat(32));
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            // The stale write must never reach the database.
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn rejects_a_stale_expected_covering_set() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    // The stored set is {1:1} — the caller's snapshot says empty.
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                        covering_model(7, 1, 1),
                    ]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.expected_covering_sources = Some(vec![]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
        }

        #[tokio::test]
        async fn rejects_a_stale_expected_moed_link_set() {
            // content_hash covers the article row only — the moed junction
            // set gets its own snapshot guard so a stale editor cannot
            // erase links it never saw.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    // The stored link set is {moed 3} — the caller's
                    // snapshot says {4} (it last read a different set).
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![moed_link(3)]])
                    .append_query_results::<moed::Model, Vec<_>, _>([vec![moed_row(3, "סוכות")]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.expected_moed_ids = Some(vec![4]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("moed links were changed"));
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn accepts_a_matching_expected_moed_link_set() {
            // The same stored set {3} echoed back passes the guard and the
            // write proceeds to target validation (unknown perek 9999 —
            // the lock ordering proves the guard ran first and matched).
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![moed_link(3)]])
                    .append_query_results::<moed::Model, Vec<_>, _>([vec![moed_row(3, "סוכות")]])
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.expected_moed_ids = Some(vec![3]);
            edit.perek_id = Some(9999);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(err.to_string().contains("Perek 9999 does not exist"));
        }

        #[tokio::test]
        async fn rejects_unknown_targets_and_out_of_range_pesukim() {
            // Unknown perek for the single-valued replacement.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.perek_id = Some(9999);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("does not exist"));

            // Pasuk beyond the canonical bound.
            let perek_bound = |id: i32, count: i16| perek::Model {
                id,
                perek_id: Some(id),
                sefer_id: Some(1),
                sefer_name: Some("בראשית".to_string()),
                additional: None,
                additional_letter: None,
                perek: Some(1),
                perek_in_context: Some(1),
                date: None,
                hebdate: None,
                tseit: None,
                header: None,
                pasuk_count: Some(count),
            };
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![perek_bound(1, 31)]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.covering_sources = Some(vec![CoveringSourceInput {
                perek_id: 1,
                pasuk: 32,
            }]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("out of range"));
        }

        #[tokio::test]
        async fn verified_coverage_requires_at_least_one_source_row() {
            for covering in [Some(vec![]), None] {
                let db = Database::from_connection(
                    MockDatabase::new(DatabaseBackend::MySql)
                        .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                        .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                        .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                        .append_query_results::<perek::Model, Vec<_>, _>([vec![]])
                        .into_connection(),
                );
                let mut edit = input();
                edit.covering_sources = covering;
                edit.coverage_verified = Some(true);
                let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                    .await
                    .unwrap_err();
                assert!(matches!(err, ServiceError::BadRequest(_)), "{err}");
            }
        }

        #[tokio::test]
        async fn replaces_the_covering_set_and_enqueues_the_search_update() {
            let perek_bound = perek::Model {
                id: 1,
                perek_id: Some(1),
                sefer_id: Some(1),
                sefer_name: Some("בראשית".to_string()),
                additional: None,
                additional_letter: None,
                perek: Some(1),
                perek_in_context: Some(1),
                date: None,
                hebdate: None,
                tseit: None,
                header: None,
                pasuk_count: Some(31),
            };
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                // lock read + previous covering set {1:3,1:4}
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 3),
                    covering_model(7, 1, 4),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // coordinate bound check
                .append_query_results::<perek::Model, Vec<_>, _>([vec![perek_bound]])
                // delete + insert + flag update + enqueue
                .append_exec_results((0..4).map(|_| MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // `previous` snapshot reads: hash, dedications, mentions
                .append_query_results([vec![hash_row("c".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, {
                let mut after = article_model(7);
                after.coverage_verified = true;
                after
            });
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.covering_sources = Some(vec![
                CoveringSourceInput {
                    perek_id: 1,
                    pasuk: 1,
                },
                CoveringSourceInput {
                    perek_id: 1,
                    pasuk: 2,
                },
            ]);
            edit.coverage_verified = Some(true);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();

            assert_eq!(outcome.revalidation, "SKIPPED");
            // previous holds the pre-write covering set — the undo record.
            assert_eq!(
                outcome
                    .previous
                    .covering_sources
                    .iter()
                    .map(|row| row.pasuk)
                    .collect::<Vec<_>>(),
                [3, 4]
            );
            assert!(outcome.relationships.coverage_verified);
            // The set replacement, the flag update and the search-index
            // enqueue all ran inside one committed transaction.
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            assert!(
                log.contains("DELETE FROM `tanah_article_covering_source`"),
                "{log}"
            );
            assert!(
                log.contains("INSERT INTO `tanah_article_covering_source`"),
                "{log}"
            );
            assert!(log.contains("UPDATE `tanah_article`"), "{log}");
            assert!(log.contains("INSERT INTO article_search_queue"), "{log}");
        }

        #[tokio::test]
        async fn omitted_fields_are_a_no_op_write() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // previous snapshot reads
                .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, article_model(7));
            let db = Database::from_connection(mock.into_connection());

            let outcome = update_relationships(&db, &skipped_revalidator(), 7, input())
                .await
                .unwrap();
            assert_eq!(outcome.revalidation, "SKIPPED");
            // No UPDATE/DELETE/INSERT ran: only selects + begin/commit.
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn missing_article_is_not_found() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let err = update_relationships(&db, &skipped_revalidator(), 7, input())
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::NotFound(_)));
        }

        #[tokio::test]
        async fn search_targets_filters_by_normalized_label() {
            let perek = |id: i32, sefer_name: &str, n: i32| perek::Model {
                id,
                perek_id: Some(id),
                sefer_id: Some(1),
                sefer_name: Some(sefer_name.to_string()),
                additional: None,
                additional_letter: None,
                perek: Some(n),
                perek_in_context: Some(n),
                date: None,
                hebdate: None,
                tseit: None,
                header: None,
                pasuk_count: Some(31),
            };
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![
                        perek(1, "בראשית", 1),
                        perek(2, "בראשית", 2),
                        perek(3, "שמות", 1),
                    ]])
                    .into_connection(),
            );
            let hits = search_targets(&db, ArticleRelationshipTargetKind::Perek, "שמות", Some(10))
                .await
                .unwrap();
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].id, 3);
            assert_eq!(hits[0].label, "שמות א");

            let err = search_targets(&db, ArticleRelationshipTargetKind::Perek, "", Some(0))
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
        }

        fn moed_row(id: i32, slug: &str) -> moed::Model {
            moed::Model {
                id,
                slug: slug.to_string(),
                name: slug.replace('-', " "),
                summary: None,
                hebrew_month: None,
                date_label: None,
                annual_order: id as i16,
                published: true,
            }
        }

        fn moed_link(moed_id: i32) -> article_moed::Model {
            article_moed::Model {
                article_id: 7,
                moed_id,
                created_at: chrono::NaiveDate::from_ymd_opt(2020, 1, 1)
                    .unwrap()
                    .and_hms_opt(0, 0, 0)
                    .unwrap(),
            }
        }

        fn perek_row(id: i32, pasuk_count: Option<i16>) -> perek::Model {
            perek::Model {
                id,
                perek_id: Some(id),
                sefer_id: Some(1),
                sefer_name: Some("בראשית".to_string()),
                additional: None,
                additional_letter: None,
                perek: Some(1),
                perek_in_context: Some(1),
                date: None,
                hebdate: None,
                tseit: None,
                header: None,
                pasuk_count,
            }
        }

        #[tokio::test]
        async fn rejects_duplicate_and_unknown_moed_ids() {
            // Duplicates fail normalization before any database access.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql).into_connection(),
            );
            let mut edit = input();
            edit.moed_ids = Some(vec![1, 1]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("duplicate moed id"));
            assert!(
                db.get_connection()
                    .clone()
                    .into_transaction_log()
                    .is_empty()
            );

            // An id that does not exist fails inside the lock.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    // previous moed link set (empty)
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    // moed existence check for the submitted ids
                    .append_query_results::<moed::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.moed_ids = Some(vec![99]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("Moed 99 does not exist"));
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn replaces_the_moed_link_set_and_keeps_the_undo_record() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                // lock read + previous covering set (empty)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                // previous moed link set {moed 1}
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![moed_link(1)]])
                .append_query_results::<moed::Model, Vec<_>, _>([vec![moed_row(1, "פסח")]])
                // replace: existence check for the submitted ids {2}
                .append_query_results::<moed::Model, Vec<_>, _>([vec![moed_row(2, "סוכות")]])
                // current links read {1}
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![moed_link(1)]])
                // delete link(1) + insert link(2)
                .append_exec_results((0..2).map(|_| MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // moed_id_slugs for the old ∪ new invalidation payload {1,2}
                .append_query_results::<moed::Model, Vec<_>, _>([vec![
                    moed_row(1, "פסח"),
                    moed_row(2, "סוכות"),
                ]])
                // previous snapshot reads: hash, dedications, mentions
                .append_query_results([vec![hash_row("d".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]])
                // search-index enqueue
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }]);
            // Post-commit reload — `reload_results` ends with the
            // article_moed read (empty here; the link-set assertion lives on
            // `previous` and the transaction log).
            mock = reload_results(mock, article_model(7));
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.moed_ids = Some(vec![2]);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();

            assert_eq!(outcome.revalidation, "SKIPPED");
            // `previous` carries the pre-write set — the undo record.
            assert_eq!(
                outcome
                    .previous
                    .moadim
                    .iter()
                    .map(|link| (link.moed_id, link.slug.as_str()))
                    .collect::<Vec<_>>(),
                [(1, "פסח")]
            );
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            assert!(log.contains("DELETE FROM `tanah_article_moed`"), "{log}");
            assert!(log.contains("INSERT INTO `tanah_article_moed`"), "{log}");
            assert!(log.contains("INSERT INTO article_search_queue"), "{log}");
        }

        #[tokio::test]
        async fn moed_target_search_matches_name_and_slug() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<moed::Model, Vec<_>, _>([vec![
                        moed_row(1, "ראש-השנה"),
                        moed_row(2, "סוכות"),
                    ]])
                    .into_connection(),
            );
            let hits = search_targets(&db, ArticleRelationshipTargetKind::Moed, "סוכ", Some(10))
                .await
                .unwrap();
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].id, 2);
            assert_eq!(hits[0].hint.as_deref(), Some("סוכות"));
        }

        #[tokio::test]
        async fn replaces_perek_and_author_and_invalidates_old_and_new() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                // lock read + previous covering set
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 1),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // single-valued target existence checks
                .append_query_results::<perek::Model, Vec<_>, _>([vec![perek_row(3, Some(10))]])
                .append_query_results::<author::Model, Vec<_>, _>([vec![author::Model {
                    id: 4,
                    name: "רמב\"ם".to_string(),
                    details: String::new(),
                }]])
                // article update + search-index enqueue
                .append_exec_results((0..2).map(|_| MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, {
                let mut after = article_model(7);
                after.perek_id = 3;
                after.author_id = 4;
                after
            });
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.perek_id = Some(3);
            edit.author_id = Some(4);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();

            assert_eq!(outcome.revalidation, "SKIPPED");
            assert_eq!(outcome.relationships.perek_id, 3);
            assert_eq!(outcome.relationships.author_id, 4);
            // `previous` is the undo record — the pre-write association.
            assert_eq!(outcome.previous.perek_id, 1);
            assert_eq!(outcome.previous.author_id, 2);
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            assert!(log.contains("UPDATE `tanah_article`"), "{log}");
            assert!(log.contains("INSERT INTO article_search_queue"), "{log}");
            // The covering rows were untouched — the undo record still holds them.
            assert_eq!(outcome.previous.covering_sources.len(), 1);
        }

        #[tokio::test]
        async fn rejects_an_unknown_author_target() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    // previous moed link set (empty)
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<author::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.author_id = Some(9999);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("does not exist"));
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn flag_only_verified_toggle_updates_the_article() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 1),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // flag update + search-index enqueue
                .append_exec_results((0..2).map(|_| MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, {
                let mut after = article_model(7);
                after.coverage_verified = true;
                after
            });
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.coverage_verified = Some(true);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();
            assert!(outcome.relationships.coverage_verified);
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            assert!(log.contains("UPDATE `tanah_article`"), "{log}");
            // A flag toggle touches no covering rows.
            assert!(
                !log.contains("INSERT INTO `tanah_article_covering_source`"),
                "{log}"
            );
        }

        #[tokio::test]
        async fn flag_only_same_value_stays_write_free() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 1),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, article_model(7));
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.coverage_verified = Some(false);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();
            assert!(!outcome.relationships.coverage_verified);
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn explicit_empty_covering_set_clears_the_rows() {
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 3),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // delete + flag update + search-index enqueue (no insert —
                // the replacement set is empty)
                .append_exec_results((0..3).map(|_| MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }))
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("b".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, article_model(7));
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.covering_sources = Some(vec![]);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();
            assert!(!outcome.relationships.coverage_verified);
            assert!(outcome.relationships.covering_sources.is_empty());
            // The undo record keeps the cleared coordinate.
            assert_eq!(outcome.previous.covering_sources.len(), 1);
            let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
            assert!(
                log.contains("DELETE FROM `tanah_article_covering_source`"),
                "{log}"
            );
            assert!(
                !log.contains("INSERT INTO `tanah_article_covering_source`"),
                "{log}"
            );
        }

        #[tokio::test]
        async fn covering_source_validation_rejects_missing_perek_and_missing_count() {
            // A perek id that is not canonical at all.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    // previous moed link set (empty)
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.covering_sources = Some(vec![CoveringSourceInput {
                perek_id: 9999,
                pasuk: 1,
            }]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("does not exist"), "{err}");
            assert_no_writes(&db);

            // A canonical perek whose corpus pasuk count was never loaded.
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                    .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![]])
                    // previous moed link set (empty)
                    .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                    .append_query_results::<perek::Model, Vec<_>, _>([vec![perek_row(1, None)]])
                    .into_connection(),
            );
            let mut edit = input();
            edit.covering_sources = Some(vec![CoveringSourceInput {
                perek_id: 1,
                pasuk: 1,
            }]);
            let err = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)));
            assert!(err.to_string().contains("pasuk count is missing"), "{err}");
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn matching_freshness_tokens_proceed_to_the_write() {
            // The caller's snapshot matches the locked state — the guards
            // pass and the (otherwise empty) write commits untouched.
            let mut mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<article::Model, Vec<_>, _>([vec![article_model(7)]])
                // expectedContentHash comparison read
                .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
                .append_query_results::<article_covering_source::Model, Vec<_>, _>([vec![
                    covering_model(7, 1, 1),
                ]])
                // previous moed link set (empty)
                .append_query_results::<article_moed::Model, Vec<_>, _>([vec![]])
                // `previous` snapshot reads
                .append_query_results([vec![hash_row("a".repeat(32).as_str())]])
                .append_query_results::<article_dedication::Model, Vec<_>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<_>, _>([vec![]]);
            mock = reload_results(mock, article_model(7));
            let db = Database::from_connection(mock.into_connection());

            let mut edit = input();
            edit.expected_content_hash = Some("a".repeat(32));
            // Order-insensitive: [{1:1}] matches the stored set.
            edit.expected_covering_sources = Some(vec![CoveringSourceInput {
                perek_id: 1,
                pasuk: 1,
            }]);
            let outcome = update_relationships(&db, &skipped_revalidator(), 7, edit)
                .await
                .unwrap();
            assert_eq!(outcome.revalidation, "SKIPPED");
            assert_no_writes(&db);
        }

        #[tokio::test]
        async fn a_database_error_surfaces_as_internal() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_errors([DbErr::Custom("db down".to_string())])
                    .into_connection(),
            );
            let err = load_relationships(&db, 7).await.unwrap_err();
            assert!(matches!(err, ServiceError::InternalServerError(_)));
        }

        #[tokio::test]
        async fn search_targets_covers_author_and_dedication_kinds() {
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<author::Model, Vec<_>, _>([vec![
                        author::Model {
                            id: 1,
                            name: "רש\"י".to_string(),
                            details: String::new(),
                        },
                        author::Model {
                            id: 2,
                            name: "רמב\"ם".to_string(),
                            details: String::new(),
                        },
                    ]])
                    .into_connection(),
            );
            let hits = search_targets(&db, ArticleRelationshipTargetKind::Author, "רמב", Some(10))
                .await
                .unwrap();
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].id, 2);
            assert_eq!(hits[0].label, "רמב\"ם");
            assert_eq!(hits[0].hint, None);

            let expiry =
                chrono::NaiveDateTime::parse_from_str("2030-01-02 03:04:05", "%Y-%m-%d %H:%M:%S")
                    .unwrap();
            let dedications = || {
                vec![
                    dedication::Model {
                        id: 5,
                        subject: "לעילוי נשמת".to_string(),
                        expires_at: Some(expiry),
                    },
                    dedication::Model {
                        id: 6,
                        subject: "לרפואה שלמה".to_string(),
                        expires_at: None,
                    },
                ]
            };
            let db = Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<dedication::Model, Vec<_>, _>([dedications()])
                    .append_query_results::<dedication::Model, Vec<_>, _>([dedications()])
                    .into_connection(),
            );
            let hits = search_targets(
                &db,
                ArticleRelationshipTargetKind::Dedication,
                "רפואה",
                Some(10),
            )
            .await
            .unwrap();
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].id, 6);
            assert_eq!(hits[0].hint, None);

            // Expiry renders as the picker's secondary hint.
            let hits = search_targets(&db, ArticleRelationshipTargetKind::Dedication, "", Some(10))
                .await
                .unwrap();
            assert_eq!(hits.len(), 2);
            assert_eq!(
                hits[0].hint.as_deref(),
                Some("פג תוקף 2030-01-02T03:04:05Z")
            );
        }
    }
}
