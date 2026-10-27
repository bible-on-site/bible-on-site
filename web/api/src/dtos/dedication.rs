use async_graphql::{Enum, InputObject, SimpleObject};

use crate::services::dedications_service::{DedicationAggregate, ScopeMatch};

/// The target kind of a dedication assignment (#2731). Matches the scope link
/// tables one-to-one; `PEREK` covers both the legacy single-perek case
/// (`perekIdLow == perekIdHigh`) and inclusive ranges.
#[derive(Enum, Copy, Clone, Eq, PartialEq, Debug)]
pub enum DedicationScopeKind {
    /// Inclusive canonical perek-id range (`perekIdLow`/`perekIdHigh`).
    Perek,
    /// Whole canonical sefer, including its additionals (`seferId`).
    Sefer,
    /// Whole canonical helek — 1 תורה, 2 נביאים, 3 כתובים (`helekId`).
    Helek,
    /// Weekly parasha unit of the shared division (`parashaId`); joined
    /// readings share the unit id.
    Parasha,
    /// One article (`articleId`).
    Article,
    /// One Tanahpedia entry by canonical entry id (`entryId`).
    TanahpediaEntry,
    /// The whole מסורה על הפרק feature; carries no target id.
    Masora,
}

/// One assignment of a dedication to a target, as matched by the requesting
/// reading context. `expiresAt` is the assignment-level expiry (UTC ISO-8601
/// string; `null` = ongoing).
#[derive(SimpleObject, Debug, Clone)]
pub struct DedicationScope {
    pub kind: DedicationScopeKind,
    pub perek_id_low: Option<i32>,
    pub perek_id_high: Option<i32>,
    pub sefer_id: Option<i32>,
    pub helek_id: Option<i32>,
    pub parasha_id: Option<i32>,
    pub article_id: Option<i32>,
    pub entry_id: Option<String>,
    /// Assignment expiry as a UTC ISO-8601 string; `null` means ongoing.
    pub expires_at: Option<String>,
}

/// A dedication honouring `subject` for `purposes`, with the assignments that
/// matched the requested reading context (or every assignment for the admin
/// list). `expiresAt` retires the whole dedication (UTC ISO-8601; `null` =
/// ongoing).
#[derive(SimpleObject, Debug, Clone)]
pub struct Dedication {
    pub id: i32,
    pub subject: String,
    /// Purpose descriptions (לע"נ, רפואה שלימה, ...) — content, not markup.
    pub purposes: Vec<String>,
    /// Whole-dedication expiry as a UTC ISO-8601 string; `null` means ongoing.
    pub expires_at: Option<String>,
    pub scopes: Vec<DedicationScope>,
}

impl From<DedicationAggregate> for Dedication {
    fn from(value: DedicationAggregate) -> Self {
        Self {
            id: value.dedication.id,
            subject: value.dedication.subject,
            purposes: value.purposes,
            expires_at: value
                .dedication
                .expires_at
                .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
            scopes: value.scopes.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ScopeMatch> for DedicationScope {
    fn from(value: ScopeMatch) -> Self {
        let (kind, low, high, sefer, helek, parasha, article, entry) = match value.target {
            crate::services::dedications_service::ScopeTarget::Perek { low, high } => (
                DedicationScopeKind::Perek,
                Some(low),
                Some(high),
                None,
                None,
                None,
                None,
                None,
            ),
            crate::services::dedications_service::ScopeTarget::Sefer { sefer_id } => (
                DedicationScopeKind::Sefer,
                None,
                None,
                Some(sefer_id),
                None,
                None,
                None,
                None,
            ),
            crate::services::dedications_service::ScopeTarget::Helek { helek_id } => (
                DedicationScopeKind::Helek,
                None,
                None,
                None,
                Some(helek_id),
                None,
                None,
                None,
            ),
            crate::services::dedications_service::ScopeTarget::Parasha { parasha_id } => (
                DedicationScopeKind::Parasha,
                None,
                None,
                None,
                None,
                Some(parasha_id),
                None,
                None,
            ),
            crate::services::dedications_service::ScopeTarget::Article { article_id } => (
                DedicationScopeKind::Article,
                None,
                None,
                None,
                None,
                None,
                Some(article_id),
                None,
            ),
            crate::services::dedications_service::ScopeTarget::TanahpediaEntry { entry_id } => (
                DedicationScopeKind::TanahpediaEntry,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(entry_id),
            ),
            crate::services::dedications_service::ScopeTarget::Masora => (
                DedicationScopeKind::Masora,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
        };
        Self {
            kind,
            perek_id_low: low,
            perek_id_high: high,
            sefer_id: sefer,
            helek_id: helek,
            parasha_id: parasha,
            article_id: article,
            entry_id: entry,
            expires_at: value
                .expires_at
                .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        }
    }
}

/// Reading-context input for the shared applicability resolver: pass every
/// identity the current context carries and the API returns the union of
/// active, non-expired dedications over direct targets and ancestors
/// (perek → sefer → helek).
#[derive(InputObject, Debug, Clone, Default)]
pub struct DedicationContextInput {
    /// Canonical perek ids in the context (a single perek page passes one id;
    /// a parasha page passes its unit's covered perakim so sefer/helek
    /// ancestors resolve).
    pub perek_ids: Option<Vec<i32>>,
    /// Canonical sefer ids (a sefer page passes one; a parasha page may pass
    /// none — perekIds already imply them).
    pub sefer_ids: Option<Vec<i32>>,
    /// Canonical helek ids (bookshelf passes 1,2,3; usually implied).
    pub helek_ids: Option<Vec<i32>>,
    /// Weekly parasha unit ids of the shared division.
    pub parasha_ids: Option<Vec<i32>>,
    /// Canonical Tanahpedia entry ids.
    pub entry_ids: Option<Vec<String>>,
    /// Article ids.
    pub article_ids: Option<Vec<i32>>,
    /// True when the context is a מסורה על הפרק reading unit — the
    /// feature-level scope applies across all of them.
    pub masora: Option<bool>,
}

/// One assignment to write: `kind` selects which target field is required.
#[derive(InputObject, Debug, Clone)]
pub struct DedicationTargetInput {
    pub kind: DedicationScopeKind,
    pub perek_id_low: Option<i32>,
    pub perek_id_high: Option<i32>,
    pub sefer_id: Option<i32>,
    pub helek_id: Option<i32>,
    pub parasha_id: Option<i32>,
    pub article_id: Option<i32>,
    pub entry_id: Option<String>,
    /// Assignment expiry as a UTC ISO-8601 string; `null`/omitted = ongoing.
    pub expires_at: Option<String>,
}

/// Fields for `createDedication`. `subject` must be non-empty; purposes are
/// `tanah_dedication_type` ids and must all exist; `targets` may be empty (an
/// unassigned dedication is legal) but every supplied target is validated.
#[derive(InputObject, Debug, Clone)]
pub struct CreateDedicationInput {
    pub subject: String,
    /// Whole-dedication expiry as a UTC ISO-8601 string; `null` = ongoing.
    pub expires_at: Option<String>,
    pub purpose_type_ids: Option<Vec<i32>>,
    pub targets: Option<Vec<DedicationTargetInput>>,
}

/// Fields for `updateDedication`: every field omitted keeps its stored value.
/// `expiresAt` uses an explicit `clearExpiresAt` flag for nulling because a
/// GraphQL `null` is indistinguishable from "field omitted".
#[derive(InputObject, Debug, Clone)]
pub struct UpdateDedicationInput {
    pub subject: Option<String>,
    /// New whole-dedication expiry (UTC ISO-8601). Ignored when
    /// `clearExpiresAt` is true.
    pub expires_at: Option<String>,
    /// Set true to remove the whole-dedication expiry.
    pub clear_expires_at: Option<bool>,
    /// Full purpose-id replacement set when provided.
    pub purpose_type_ids: Option<Vec<i32>>,
    /// Full target-list replacement when provided — existing assignments not
    /// listed here are removed.
    pub targets: Option<Vec<DedicationTargetInput>>,
}
