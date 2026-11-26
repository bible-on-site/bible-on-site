use async_graphql::{ComplexObject, Context, ErrorExtensions, Result, SimpleObject};

use crate::{
    dtos::{
        reading_metric::{ReadingMetric, ReadingProgressUnit},
        tanahpedia_images::TanahpediaImageLink,
    },
    providers::Database,
    services::{reading_metrics_service, tanahpedia_images_service},
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

    /// Public image links attached to this entry, ordered by the link's
    /// `sortOrder` (#3769). Resolved only when selected; reads as empty while
    /// the additive image tables are pending deploy.
    async fn images(&self, ctx: &Context<'_>) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entry_images(ctx.data::<Database>()?, &self.id)
            .await
            .map_err(|e| e.extend())
    }

    /// Public image links attached to this entry's subject entities — the
    /// entity-scope side of the entry gallery (e.g. the subject's portraits).
    /// Resolved only when selected.
    async fn entity_images(&self, ctx: &Context<'_>) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entity_images_for_entry(ctx.data::<Database>()?, &self.id)
            .await
            .map_err(|e| e.extend())
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
/// type (`PERSON`, `PLACE`, ...) or a subcategory (`PROPHET`, `KING`,
/// `TANAH_COMMENTATOR`, animal kinds `BEHEMA`/`CHAYA`/`OF`/`SHERETZ` and
/// purities `TAHOR`/`TAMEH`).
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

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
    use entities::tanahpedia::entry_metric_block;
    use sea_orm::{DatabaseBackend, MockDatabase};

    /// Detail DTO for the resolver-shape test — the complex `progress_units`
    /// field must resolve through the real schema machinery (issue #2607).
    struct Query;
    #[Object]
    impl Query {
        async fn entry(&self) -> TanahpediaEntryDetail {
            TanahpediaEntryDetail {
                id: "entry-x".to_string(),
                unique_name: "entry-x".to_string(),
                title: "Entry".to_string(),
                content: Some("<p>body</p>".to_string()),
                updated_at: "2026-01-01".to_string(),
                entities: vec![],
                occurrences: vec![],
                reading_metric: None,
            }
        }
    }

    #[tokio::test]
    async fn progress_units_maps_the_stored_block_rows() {
        let unit = |block_idx, cumulative| entry_metric_block::Model {
            entry_id: "entry-x".to_string(),
            block_idx,
            word_count: 10,
            cumulative_words: cumulative,
            calc_version: 1,
        };
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_metric_block::Model, Vec<_>, _>([vec![
                    unit(0, 10),
                    unit(1, 20),
                ]])
                .into_connection(),
        );
        let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
            .data(db)
            .finish();

        let res = schema
            .execute("{ entry { progressUnits { key wordCount cumulativeWords } } }")
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let units = res.data.into_json().unwrap()["entry"]["progressUnits"].clone();
        assert_eq!(units[0]["key"], "0");
        assert_eq!(units[0]["wordCount"], 10);
        assert_eq!(units[1]["cumulativeWords"], 20);
    }

    /// One JOIN row in the shape `ImageLinkRow` reads — link fields plus the
    /// attached image record (#3769).
    fn image_link_row() -> std::collections::BTreeMap<String, sea_orm::Value> {
        use sea_orm::Value;
        [
            ("id", "l1".into()),
            ("owner_id", "entry-x".into()),
            ("sort_order", 0_i16.into()),
            ("is_primary", true.into()),
            ("image_id", "img1".into()),
            ("url", "https://cdn.example.com/img.jpg".into()),
            ("width", 800_u16.into()),
            ("height", 600_u16.into()),
            ("alt_text", "תיאור התמונה".into()),
            ("caption", Value::String(None)),
            ("creator", Value::String(None)),
            ("credit_line", Value::String(None)),
            ("source_name", "Wikimedia Commons".into()),
            ("source_url", Value::String(None)),
            ("license_name", "CC BY-SA 4.0".into()),
            ("license_url", Value::String(None)),
            ("is_public_domain", false.into()),
            ("modifications", Value::String(None)),
            ("permission_evidence", "evidence".into()),
            ("is_public", true.into()),
            ("revision", 1_i32.into()),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
    }

    /// The complex `images`/`entityImages` fields resolve each gallery scope
    /// on demand (#3769): entry-scope links first, then the batched
    /// entity-scope query over the entry's linked entities.
    #[tokio::test]
    async fn images_and_entity_images_resolve_the_public_links() {
        use sea_orm::Value;
        use std::collections::BTreeMap;
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // `images` — entry-scope link rows
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![image_link_row()],
                ])
                // `entityImages` — batched entity-scope link rows
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![image_link_row()],
                ])
                .into_connection(),
        );
        let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
            .data(db)
            .finish();

        let res = schema
            .execute(
                "{ entry { images { id ownerKind ownerId isPrimary image { imageId url } } entityImages { id ownerKind image { imageId } } } }",
            )
            .await;

        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let entry = res.data.into_json().unwrap()["entry"].clone();
        assert_eq!(entry["images"][0]["id"], "l1");
        assert_eq!(entry["images"][0]["ownerKind"], "ENTRY");
        assert_eq!(entry["images"][0]["image"]["imageId"], "img1");
        assert_eq!(entry["entityImages"][0]["ownerKind"], "ENTITY");
        assert_eq!(entry["entityImages"][0]["image"]["imageId"], "img1");
    }
}
