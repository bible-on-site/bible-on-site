use async_graphql::{InputObject, SimpleObject};

/// The render-side view of a Tanahpedia image asset (#3769) — everything a
/// reader page or JSON-LD `ImageObject` needs. Private editorial fields
/// (`permission_evidence`, `is_public`) are deliberately absent here; the
/// authorized `TanahpediaImageAsset` shape carries them.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaImage {
    /// `tanahpedia_image.id`.
    pub image_id: String,
    /// Served asset URL (CDN/S3 public object or external host).
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub alt_text: String,
    pub caption: Option<String>,
    /// Artist / photographer when known.
    pub creator: Option<String>,
    /// Concise display credit line.
    pub credit_line: Option<String>,
    /// Holding collection/site, e.g. Wikimedia Commons.
    pub source_name: Option<String>,
    /// Source item page URL.
    pub source_url: Option<String>,
    /// License / rights statement; `None` when public domain.
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub is_public_domain: bool,
    /// Changes from the source item, e.g. crops.
    pub modifications: Option<String>,
}

/// A link between an image asset and its owner — `ENTRY` scopes
/// `tanahpedia_entry_image`, `ENTITY` scopes `tanahpedia_entity_image`.
/// Public reads only surface links whose image is `is_public`.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaImageLink {
    /// `tanahpedia_{entry,entity}_image.id`.
    pub id: String,
    /// `ENTRY` or `ENTITY`.
    pub owner_kind: String,
    /// `entry_id` or `entity_id`.
    pub owner_id: String,
    pub sort_order: i32,
    pub is_primary: bool,
    pub image: TanahpediaImage,
}

/// The full image record including private editorial fields — authorized
/// clients only (`tanahpediaImageAsset`, mutation results).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaImageAsset {
    pub image_id: String,
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub alt_text: String,
    pub caption: Option<String>,
    pub creator: Option<String>,
    pub credit_line: Option<String>,
    pub source_name: Option<String>,
    pub source_url: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub is_public_domain: bool,
    pub modifications: Option<String>,
    /// Permission / public-domain evidence; never exposed publicly.
    pub permission_evidence: Option<String>,
    pub is_public: bool,
}

/// Editor view of an image link — same link fields as `TanahpediaImageLink`
/// but carries the full asset (including private fields and unpublished
/// images). Authorized clients only.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaImageLinkFull {
    pub id: String,
    pub owner_kind: String,
    pub owner_id: String,
    pub sort_order: i32,
    pub is_primary: bool,
    pub image: TanahpediaImageAsset,
}

/// Upsert payload for `putTanahpediaImageAsset` — `id` null creates a new
/// asset, otherwise the existing row is updated.
#[derive(InputObject, Debug, Clone)]
pub struct TanahpediaImageAssetInput {
    pub id: Option<String>,
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub alt_text: String,
    pub caption: Option<String>,
    pub creator: Option<String>,
    pub credit_line: Option<String>,
    pub source_name: Option<String>,
    pub source_url: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub is_public_domain: Option<bool>,
    pub modifications: Option<String>,
    pub permission_evidence: Option<String>,
    pub is_public: Option<bool>,
}

/// Attach or update an entity-image link. `id` null attaches `imageId` to
/// `entityId`; a present `id` updates that link's order/primary flag.
#[derive(InputObject, Debug, Clone)]
pub struct TanahpediaEntityImageLinkInput {
    pub id: Option<String>,
    pub entity_id: String,
    pub image_id: String,
    pub sort_order: Option<i32>,
    pub is_primary: Option<bool>,
}

/// Attach or update an entry-image link. `id` null attaches `imageId` to
/// `entryId`; a present `id` updates that link's order/primary flag.
#[derive(InputObject, Debug, Clone)]
pub struct TanahpediaEntryImageLinkInput {
    pub id: Option<String>,
    pub entry_id: String,
    pub image_id: String,
    pub sort_order: Option<i32>,
    pub is_primary: Option<bool>,
}
