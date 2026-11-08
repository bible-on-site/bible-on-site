//! DTOs for the typed article-relationship contract (#3102). Field docs are
//! the GraphQL schema descriptions — keep them accurate: the LLM
//! draft/approval pipeline (#3103) reads this catalogue to know which
//! relationships exist and how to write them.

use async_graphql::{Enum, InputObject, SimpleObject};

/// The typed contract envelope: the catalogue version (consumers pin
/// against it — it bumps when relationship semantics change) plus the
/// relationship entries themselves.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleRelationshipContract {
    pub contract_version: i32,
    pub capabilities: Vec<ArticleRelationshipCapability>,
}

/// One relationship kind from the shared catalogue
/// (`web/shared/article-relationships/registry.json`). `pending-schema`
/// entries are surfaced honestly — their write/read paths go live when the
/// owning schema lands; a client must never treat them as "unsupported =
/// clear".
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleRelationshipCapability {
    /// Stable machine key — mutations/proposals name this, never tables.
    pub key: String,
    /// Hebrew UI label for grouped admin sections.
    pub label: String,
    /// What the link expresses semantically.
    pub meaning: String,
    /// Semantic target kind (perek, author, dedication, moed, …).
    pub target_kind: String,
    /// `exactly-one` | `zero-or-one` | `many`.
    pub cardinality: String,
    /// Editable fields carried on the link itself (e.g. expiresAt).
    pub link_metadata: Vec<String>,
    /// The aggregate owning the write path (article, dedication,
    /// annotation-pipeline).
    pub ownership: String,
    /// The API shared-secret scope authorizing writes; null = no API write.
    pub permission: Option<String>,
    /// `read` | `add` | `replace` | `remove` | `clear`.
    pub operations: Vec<String>,
    /// The validated write contract — mutation name + field semantics.
    pub write_contract: String,
    /// Where the link is readable (public projection vs admin-only).
    pub read_contract: String,
    /// The invalidation entity-change the write enqueues.
    pub invalidates: String,
    /// `supported` | `pending-schema`.
    pub status: String,
    /// Owning issue while status is `pending-schema`.
    pub pending_issue: Option<i32>,
}

/// One canonical {perekId, pasuk} coordinate an article verifiably covers
/// (read shape — the same fields as the public `Article.coveringSources`).
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct CoveringSource {
    pub perek_id: i32,
    pub pasuk: i32,
}

/// One canonical {perekId, pasuk} to store. `pasuk` must be >= 1 and within
/// the perek's canonical `pasuk_count`; duplicates are rejected.
#[derive(InputObject, Debug, Clone, PartialEq)]
pub struct CoveringSourceInput {
    pub perek_id: i32,
    pub pasuk: i32,
}

/// One dedication assignment pointing at this article — management view
/// (includes expired assignments the public `dedications` query hides).
/// Writes go through the dedication mutations: the dedication aggregate
/// owns its full target set.
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct ArticleDedicationLink {
    /// The owning dedication id.
    pub dedication_id: i32,
    /// The honoured subject (null only when the joined row is missing — a
    /// dangling link, which the FK prevents in practice).
    pub subject: Option<String>,
    /// Assignment-level expiry (UTC ISO-8601; null = ongoing).
    pub expires_at: Option<String>,
    /// Whole-dedication expiry (UTC ISO-8601; null = ongoing).
    pub dedication_expires_at: Option<String>,
}

/// One stored mention annotation the pipeline computed over the article
/// body — an editorial annotation record, NOT an explicit article-to-entry
/// FK: `intendedName` resolves to a live entry by name at display time.
/// Pipeline-owned: read-only through this API by design.
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct ArticleMentionAnnotation {
    /// Stable annotation id (uuid).
    pub id: String,
    /// The Tanahpedia name the annotation intends.
    pub intended_name: String,
    /// Entity type name (PERSON, PLACE, …).
    pub entity_type: String,
    /// Disambiguation hint the pipeline recorded, when any.
    pub disambiguation: Option<String>,
    /// Pipeline confidence (decimal rendered as a string — exact, lossless).
    pub confidence: Option<String>,
    /// `auto` | `manual` | `held` | `rejected`.
    pub acceptance: String,
    /// The model/pipeline revision that produced it.
    pub model_revision: String,
    /// Character span in the article body the annotation was computed on.
    pub span_start: Option<i32>,
    pub span_end: Option<i32>,
    /// The annotated surface text.
    pub surface: String,
    /// SHA-256 hex of the article content the annotation was computed on.
    pub content_hash: Option<String>,
    /// True when `contentHash` still matches the live article body — false
    /// means the annotation is stale and the public site no longer shows it.
    pub current_content: bool,
}

/// One moed link of the article — the `moadim` relationship (#3101). The
/// link itself carries no metadata; the moed fields are for picker display.
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct ArticleMoedLink {
    /// tanah_moed.id — the value `updateArticleRelationships.moedIds` takes.
    pub moed_id: i32,
    /// The moed's canonical slug (its public /moadim/{slug} identity).
    pub slug: String,
    /// Hebrew display name for pickers/lists.
    pub name: String,
}

/// The article-centric relationship read: every DB-supported link with its
/// current state, stable ids and the freshness tokens the mutation checks.
#[derive(SimpleObject, Debug, Clone)]
pub struct ArticleRelationships {
    pub article_id: i32,
    /// `primaryPerek` — required, exactly one.
    pub perek_id: i32,
    /// `author` — required, exactly one.
    pub author_id: i32,
    /// True: `coveringSources` is the verified coverage; false: coverage is
    /// unknown (readers fall back to the primary perek).
    pub coverage_verified: bool,
    /// Lowercase hex of the generated `content_hash` — echo back as
    /// `expectedContentHash` for the stale-edit check.
    pub content_hash: String,
    /// `coveringSources` — the verified pasuk coordinates.
    pub covering_sources: Vec<CoveringSource>,
    /// `dedicationAssignments` — every dedication link (incl. expired).
    pub dedications: Vec<ArticleDedicationLink>,
    /// `mentionAnnotations` — pipeline-owned annotations (all states).
    pub mention_annotations: Vec<ArticleMentionAnnotation>,
    /// `moadim` — the article's explicit moed links (#3101).
    pub moadim: Vec<ArticleMoedLink>,
}

/// The result of `updateArticleRelationships`: the post-write state, the
/// pre-write snapshot (`previous` — re-submit its fields to undo) and the
/// website-invalidation outcome (APPLIED / FAILED / SKIPPED).
#[derive(SimpleObject, Debug, Clone)]
pub struct UpdateArticleRelationshipsResult {
    pub relationships: ArticleRelationships,
    /// The link state before this write — the supported undo record.
    pub previous: ArticleRelationships,
    /// `APPLIED` | `FAILED` | `SKIPPED` — FAILED means the write committed
    /// but the website has not expired its caches yet.
    pub revalidation: String,
}

/// Relationship kinds whose targets the lookup endpoint searches. Only
/// kinds with a real search surface are listed — `pasukCoordinate` targets
/// are validated inline by the write contract, and pipeline/pending kinds
/// have no picker by design.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum ArticleRelationshipTargetKind {
    /// Canonical perakim — matched by their Hebrew label (e.g. "בראשית א").
    Perek,
    /// Authors — matched by name substring.
    Author,
    /// Dedications — matched by subject substring (for pickers that choose
    /// which dedication an article assignment belongs to).
    Dedication,
    /// Moadim — matched by Hebrew name or slug substring (#3101).
    Moed,
}

/// One lookup hit for a relationship target picker.
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct ArticleRelationshipTarget {
    /// The relationship kind this target belongs to.
    pub kind: ArticleRelationshipTargetKind,
    /// The target id — the value the write contract takes (`perekId`,
    /// `authorId`, or the dedication id used inside `DedicationTargetInput`).
    pub id: i32,
    /// Human-readable picker label (e.g. "בראשית א", the author name).
    pub label: String,
    /// Secondary context for the picker (e.g. the perek's pasuk bound).
    pub hint: Option<String>,
}

/// `updateArticleRelationships` input. Every field is optional in the
/// protocol sense: an omitted field leaves its relation untouched, so a
/// single-link edit never disturbs unrelated links. `source` is required —
/// it is the audit actor recorded with the before/after change.
#[derive(InputObject, Debug, Clone)]
pub struct UpdateArticleRelationshipsInput {
    /// Names the actor/pipeline performing the write (e.g. `admin`,
    /// `llm-proposal-42`); recorded in the audit log entry.
    pub source: String,
    /// `primaryPerek` replacement — must be an existing canonical perek id;
    /// cannot be cleared (the association is required).
    pub perek_id: Option<i32>,
    /// `author` replacement — must be an existing author id; cannot be
    /// cleared.
    pub author_id: Option<i32>,
    /// Full `moadim` link-set replacement (#3101): every id must reference an
    /// existing moed and be unique; omitted leaves links untouched, an
    /// explicit empty list clears them.
    pub moed_ids: Option<Vec<i32>>,
    /// Full `coveringSources` replacement set; omit to keep the stored set.
    /// An explicit empty list clears the set and marks coverage unknown.
    pub covering_sources: Option<Vec<CoveringSourceInput>>,
    /// The verified flag for the submitted set (default false when a set is
    /// given). Alone, it toggles the flag on the persisted set — `true`
    /// always requires at least one stored covering source.
    pub coverage_verified: Option<bool>,
    /// Stale-edit guard: the `contentHash` the caller last read. A mismatch
    /// rejects the write — reload and re-apply instead of overwriting an
    /// unseen change.
    pub expected_content_hash: Option<String>,
    /// Stale-edit guard for the covering set: the exact {perekId,pasuk} set
    /// the caller last read (order-insensitive). A mismatch rejects the
    /// write for the same reason.
    pub expected_covering_sources: Option<Vec<CoveringSourceInput>>,
    /// Stale-edit guard for the moed link set (#3101): the exact moed ids
    /// the caller last read in `articleRelationships.moadim`
    /// (order-insensitive). The generated `contentHash` covers only the
    /// article row, so a second full-set replacement could otherwise erase
    /// links its caller never saw; a mismatch rejects the write.
    pub expected_moed_ids: Option<Vec<i32>>,
}
