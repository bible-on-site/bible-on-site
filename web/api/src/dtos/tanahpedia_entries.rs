use async_graphql::{ComplexObject, Context, ErrorExtensions, Result, SimpleObject};

use crate::{
    dtos::reading_metric::{ReadingMetric, ReadingProgressUnit},
    providers::Database,
    services::reading_metrics_service,
};

/// Lightweight reference to a published Tanahpedia entry — the stable identity
/// used by client routes and in-content links.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntryStub {
    pub id: String,
    /// Canonical entry slug (`unique_name`); synonyms resolve to this value.
    pub unique_name: String,
    pub title: String,
}

/// A published Tanahpedia entry (live `tanahpedia_entry` row). Drafts and
/// review states live in `tanahpedia_entry_revision`, a separate admin flow.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntry {
    pub id: String,
    pub unique_name: String,
    pub title: String,
    /// Admin-authored HTML body; `None` when the entry has no content yet.
    pub content: Option<String>,
    pub updated_at: String,
}

/// An entity linked to an entry through `tanahpedia_entry_entity`.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaLinkedEntity {
    /// `tanahpedia_entry_entity.id`
    pub id: String,
    pub entity_id: String,
    /// `PERSON`, `PLACE`, `EVENT`, `WAR`, `ANIMAL`, `OBJECT`, `TEMPLE_TOOL`,
    /// `PLANT`, `ASTRONOMICAL_OBJECT`, `SAYING`, `SEFER`, `TANAH_SEFER`,
    /// `PROPHECY`, `NATION`.
    pub entity_type: String,
    /// Display name of the linked entity.
    pub entity_name: String,
}

/// A Tanah text occurrence attached to one of the entry's entities: a perek +
/// pasuk pair plus optional sub-pasuk segment coordinates.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntryOccurrence {
    /// `tanah_perek.id` (1-929).
    pub perek_id: i32,
    /// 1-based pasuk index within the perek.
    pub pasuk_number: i32,
    /// 0-based segment index; `None` means the whole pasuk.
    pub segment_start: Option<i32>,
    /// 0-based segment index (inclusive); `None` means the whole pasuk.
    pub segment_end: Option<i32>,
}

/// An entry with its linked entities and Tanah occurrences — everything a
/// reader page needs in a single round trip.
#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct TanahpediaEntryDetail {
    pub id: String,
    pub unique_name: String,
    pub title: String,
    pub content: Option<String>,
    pub updated_at: String,
    pub entities: Vec<TanahpediaLinkedEntity>,
    pub occurrences: Vec<TanahpediaEntryOccurrence>,
    /// Shared persisted reading metrics over the authored entry body
    /// (issue #2607). `null` = unknown/not computed.
    pub reading_metric: Option<ReadingMetric>,
}

#[ComplexObject]
impl TanahpediaEntryDetail {
    /// Ordered readable-block units over the entry body for word-weighted
    /// reading-position progress (issue #2607). Resolved only when selected.
    /// Empty when uncomputed.
    async fn progress_units(&self, ctx: &Context<'_>) -> Result<Vec<ReadingProgressUnit>> {
        let units =
            reading_metrics_service::block_units_by_entry_id(ctx.data::<Database>()?, &self.id)
                .await
                .map_err(|e| e.extend())?;
        Ok(units.into_iter().map(Into::into).collect())
    }
}

/// An entity of a given type with the entries that describe it — zero, one or
/// several (clients render the name plain, linked, or disambiguated).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntityWithEntries {
    pub entity_id: String,
    pub entity_type: String,
    pub entity_name: String,
    pub linked_entries: Vec<TanahpediaEntryStub>,
}

/// Number of published entries linked to a category key — either a base entity
/// type (`PERSON`, `PLACE`, ...) or a subcategory (`PROPHET`, `KING`, animal
/// kinds `BEHEMA`/`CHAYA`/`OF`/`SHERETZ` and purities `TAHOR`/`TAMEH`).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaCategoryCount {
    pub category: String,
    pub count: i32,
}

/// One entry a synonym can lead to. A single target means a plain alias;
/// several mean the name is ambiguous and the reader has to choose.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaSynonymTarget {
    pub entry_id: String,
    pub unique_name: String,
    pub title: String,
    /// Human label distinguishing ambiguous targets (e.g. "דתן ואבירם");
    /// `None` for direct synonym links.
    pub label: Option<String>,
}

/// Category homepage configuration (`tanahpedia_category_homepage`).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaCategoryHomepage {
    pub entity_type: String,
    /// `LIST`, `MAP`, `GALLERY` or `TIMELINE`.
    pub layout_type: String,
    /// Admin-authored HTML intro rendered above the listing.
    pub content: Option<String>,
}

/// One ranked Tanahpedia search hit — the API counterpart of the website's
/// `/search` `tanahpedia` result (`searchTanahpediaEntries` in
/// `web/bible-on-site/src/lib/search/db-content.ts`).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaSearchHit {
    pub id: String,
    /// Canonical entry slug (`unique_name`) — the client's navigation key.
    pub unique_name: String,
    pub title: String,
    /// Snippet source text, selected like the website's `plain` field: the
    /// body window around the match for content hits, the `נקרא גם:` alias
    /// list when an alias drove the match, or the body lead-in for a
    /// title-only match. Empty when the entry has no body and no aliases.
    pub excerpt: String,
    /// Relevance score — the website/app tier ladder (90/80/60 word scores,
    /// whole-phrase 100/110) with the name fields (title, unique_name, alias
    /// names) at ×2 weight over body content.
    pub score: i32,
}
