//! DTOs for מועדים על הפרק (#3101): the public catalogue read and the
//! authorized catalogue/link writes. Sections carry ordered inclusive
//! canonical ranges — a moed may span several books and noncontiguous
//! readings without pretending to be one reading-unit parent.
use async_graphql::{ComplexObject, Context, ErrorExtensions, InputObject, Result, SimpleObject};

use crate::{providers::Database, services::moed_service};

/// One inclusive canonical scripture range inside a moed section.
#[derive(SimpleObject, Debug, Clone, PartialEq)]
pub struct MoedRange {
    pub id: i32,
    /// 1-based order inside the section.
    pub position: i32,
    /// Inclusive start coordinate.
    pub perek_id_start: i32,
    pub pasuk_start: i32,
    /// Inclusive end coordinate.
    pub perek_id_end: i32,
    pub pasuk_end: i32,
}

/// One labelled reading section of a moed (e.g. מגילת איכה, a custom-scoped
/// הפטרה) with its ordered ranges.
#[derive(SimpleObject, Debug, Clone)]
pub struct MoedSection {
    pub id: i32,
    /// Section heading shown on the moed page.
    pub label: String,
    /// 1-based display order inside the moed.
    pub position: i32,
    /// The section's ordered inclusive ranges.
    pub ranges: Vec<MoedRange>,
}

/// One moed of the catalogue. `slug` is the canonical Hebrew name-based URL
/// segment; `annualOrder` is wheel/display ordering, never a calendar rule.
#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Moed {
    pub id: i32,
    /// Canonical Hebrew URL segment for /moadim/{slug}.
    pub slug: String,
    /// Hebrew display name.
    pub name: String,
    /// Short editorial description, when curated.
    pub summary: Option<String>,
    /// Display-only Hebrew month anchor (e.g. תשרי).
    pub hebrew_month: Option<String>,
    /// Display-only date label (e.g. א'-ב' בתשרי).
    pub date_label: Option<String>,
    /// Wheel/display ordering — not calendar math.
    pub annual_order: i32,
    /// FALSE moadim are hidden from the public surface (404 on the detail
    /// route); drafts stay admin-manageable.
    pub published: bool,
    /// Ordered labelled reading sections (empty when none are curated).
    pub sections: Vec<MoedSection>,
    /// Ordered ids of explicitly linked articles (the `articles` union read
    /// resolves the actual Article rows together with range-matched ones).
    pub explicit_article_ids: Vec<i32>,
}

#[ComplexObject]
impl Moed {
    /// The moed's articles: the deduplicated union of explicit links and
    /// articles whose scripture coverage overlaps the stored ranges —
    /// the same union the public detail page renders.
    async fn articles(&self, ctx: &Context<'_>) -> Result<Vec<crate::dtos::article::Article>> {
        let db = ctx.data::<Database>()?;
        moed_service::articles_for_moed(db, self)
            .await
            .map_err(|e| e.extend())
    }
}

/// One range in the moed write payload. Both perek ids must be canonical and
/// every pasuk inside its perek's pasuk_count; the start coordinate must not
/// come after the end.
#[derive(InputObject, Debug, Clone)]
pub struct MoedRangeInput {
    pub perek_id_start: i32,
    pub pasuk_start: i32,
    pub perek_id_end: i32,
    pub pasuk_end: i32,
}

/// One section in the moed write payload — list position is the display
/// order; each section needs at least one range.
#[derive(InputObject, Debug, Clone)]
pub struct MoedSectionInput {
    pub label: String,
    pub ranges: Vec<MoedRangeInput>,
}

/// `upsertMoed` input. `id` omitted creates; supplied updates that row.
/// `sections` is the FULL ordered section set — it replaces the stored one
/// (omitted/None leaves the stored sections untouched).
#[derive(InputObject, Debug, Clone)]
pub struct UpsertMoedInput {
    pub id: Option<i32>,
    /// Hebrew display name (required).
    pub name: String,
    /// Canonical Hebrew slug; omitted derives from `name`. Must be unique.
    pub slug: Option<String>,
    pub summary: Option<String>,
    /// Display-only Hebrew month anchor; not a calendar rule.
    pub hebrew_month: Option<String>,
    /// Display-only date label.
    pub date_label: Option<String>,
    /// Wheel/display ordering — unique across moadim.
    pub annual_order: i32,
    pub published: bool,
    /// Full ordered section set when supplied; omit to keep stored sections.
    pub sections: Option<Vec<MoedSectionInput>>,
}

/// The result of `upsertMoed` / `deleteMoed` — the post-write moed (None on
/// delete) plus the website-invalidation outcome (APPLIED / FAILED /
/// SKIPPED).
#[derive(SimpleObject, Debug, Clone)]
pub struct UpsertMoedResult {
    pub moed: Option<Moed>,
    /// `APPLIED` | `FAILED` | `SKIPPED` — FAILED means the write committed
    /// but the website has not expired its caches yet.
    pub revalidation: String,
}
