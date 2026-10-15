use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::dtos::tanahpedia_entries::{
    TanahpediaCategoryCount, TanahpediaCategoryHomepage, TanahpediaEntityWithEntries,
    TanahpediaEntry, TanahpediaEntryDetail, TanahpediaSearchHit, TanahpediaSynonymTarget,
};
use crate::providers::Database;
use crate::services::{tanahpedia_entries_service, tanahpedia_search_service};

const MAX_ENTRIES_LIMIT: i32 = 500;
const MAX_RECENT_LIMIT: i32 = 50;

#[derive(Default)]
pub struct TanahpediaEntriesQuery;

#[Object]
impl TanahpediaEntriesQuery {
    /// Published Tanahpedia entries ordered by title — the public browse list.
    /// `limit` clamps to 500, `offset` paginates.
    async fn tanahpedia_entries(
        &self,
        ctx: &Context<'_>,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> Result<Vec<TanahpediaEntry>> {
        let limit = clamp_i32(limit, 50, MAX_ENTRIES_LIMIT);
        let offset = offset.unwrap_or(0).max(0) as u64;
        tanahpedia_entries_service::get_entries(ctx.data::<Database>()?, limit, offset)
            .await
            .map_err(|e| e.extend())
    }

    /// Entries most recently updated — the landing "עודכנו לאחרונה" section.
    /// `limit` clamps to 50.
    async fn tanahpedia_recent_entries(
        &self,
        ctx: &Context<'_>,
        limit: Option<i32>,
    ) -> Result<Vec<TanahpediaEntry>> {
        let limit = clamp_i32(limit, 10, MAX_RECENT_LIMIT);
        tanahpedia_entries_service::get_recent_entries(ctx.data::<Database>()?, limit)
            .await
            .map_err(|e| e.extend())
    }

    /// A single entry by its canonical `unique_name`, with linked entities and
    /// the Tanah occurrences of those entities. `None` when no entry owns the
    /// name — callers then try `tanahpediaSynonymTargets` for alias /
    /// disambiguation resolution, like the website does.
    async fn tanahpedia_entry(
        &self,
        ctx: &Context<'_>,
        unique_name: String,
    ) -> Result<Option<TanahpediaEntryDetail>> {
        tanahpedia_entries_service::get_entry_detail(ctx.data::<Database>()?, &unique_name)
            .await
            .map_err(|e| e.extend())
    }

    /// Lexical search over published entries — title, unique_name, alias names
    /// (direct and disambiguation targets) and body content — returning ranked
    /// hits with a snippet-ready `excerpt`. Shares the website `/search`
    /// `tanahpedia` provider's matching and relevance conventions: same Hebrew
    /// normalization, same score tiers, one hit per entry.
    async fn search_tanahpedia_entries(
        &self,
        ctx: &Context<'_>,
        phrase: String,
        limit: Option<i32>,
    ) -> Result<Vec<TanahpediaSearchHit>> {
        tanahpedia_search_service::search_entries(ctx.data::<Database>()?, &phrase, limit)
            .await
            .map_err(|e| e.extend())
    }

    /// Entries a synonym name can lead to: 0 results = unknown name, 1 = plain
    /// alias (open `uniqueName`), several = ambiguous — the client renders a
    /// chooser.
    async fn tanahpedia_synonym_targets(
        &self,
        ctx: &Context<'_>,
        name: String,
    ) -> Result<Vec<TanahpediaSynonymTarget>> {
        tanahpedia_entries_service::get_synonym_targets(ctx.data::<Database>()?, &name)
            .await
            .map_err(|e| e.extend())
    }

    /// Published-entry counts per category key — base entity types plus the
    /// `PROPHET`/`KING` roles and animal kind/purity subcategories — for the
    /// landing category grid.
    async fn tanahpedia_category_counts(
        &self,
        ctx: &Context<'_>,
    ) -> Result<Vec<TanahpediaCategoryCount>> {
        tanahpedia_entries_service::get_category_counts(ctx.data::<Database>()?)
            .await
            .map_err(|e| e.extend())
    }

    /// All entities of a category with the entries that describe them —
    /// powers the 0/1/many-entry listing pages. `entityType` is a base entity
    /// type (`PERSON`, `PLACE`, ...); `sub` optionally narrows it
    /// (`PROPHET`/`KING` under `PERSON`, `BEHEMA`/`CHAYA`/`OF`/`SHERETZ` or
    /// `TAHOR`/`TAMEH` under `ANIMAL`).
    async fn tanahpedia_entities(
        &self,
        ctx: &Context<'_>,
        entity_type: String,
        sub: Option<String>,
    ) -> Result<Vec<TanahpediaEntityWithEntries>> {
        tanahpedia_entries_service::get_entities_with_entries(
            ctx.data::<Database>()?,
            &entity_type,
            sub.as_deref(),
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Entities whose Hebrew-date anniversary falls on the given Hebrew
    /// month/day — the landing "היום בתנ"ך" section. `hebrewMonth` uses the
    /// legacy numbering stored in the date columns (1=Tishrei..5=Shevat,
    /// 6/13/14=Adar variants, 7=Nisan..12=Elul); `hebrewDay` is 1-30.
    async fn tanahpedia_today_entities(
        &self,
        ctx: &Context<'_>,
        hebrew_month: i32,
        hebrew_day: i32,
    ) -> Result<Vec<TanahpediaEntityWithEntries>> {
        if !(1..=14).contains(&hebrew_month) || !(1..=30).contains(&hebrew_day) {
            return Ok(Vec::new());
        }
        let month_day = hebrew_month * 100 + hebrew_day;
        tanahpedia_entries_service::get_today_entities(ctx.data::<Database>()?, month_day)
            .await
            .map_err(|e| e.extend())
    }

    /// Homepage configuration (layout + intro content) for an entity type, if
    /// one is configured.
    async fn tanahpedia_category_homepage(
        &self,
        ctx: &Context<'_>,
        entity_type: String,
    ) -> Result<Option<TanahpediaCategoryHomepage>> {
        tanahpedia_entries_service::get_category_homepage(ctx.data::<Database>()?, &entity_type)
            .await
            .map_err(|e| e.extend())
    }
}

fn clamp_i32(value: Option<i32>, default: i32, max: i32) -> u64 {
    value.unwrap_or(default).clamp(1, max) as u64
}
