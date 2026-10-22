use async_graphql::SimpleObject;

/// A person related to the focal person in a family edge — carries the linked
/// entry (when one exists) so clients can render the name as a link.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilyRelatedPerson {
    /// `tanahpedia_person.id` of the related person.
    pub person_id: String,
    /// `tanahpedia_entity.id` of the related person.
    pub entity_id: String,
    pub display_name: String,
    /// Canonical entry slug describing the related person; `None` when the
    /// person has no entry (clients render the name plain).
    pub entry_unique_name: Option<String>,
    pub entry_title: Option<String>,
    /// `MALE`/`FEMALE`/`UNKNOWN` from `tanahpedia_person_sex` (non-alt row);
    /// `None` when unrecorded.
    pub sex: Option<String>,
}

/// A parent edge of the focal person (`tanahpedia_person_parent_child` where
/// the focal person is the child).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilyParentEdge {
    pub related: TanahpediaFamilyRelatedPerson,
    /// `FATHER`/`MOTHER` lookup code.
    pub parent_role: String,
    /// `BIOLOGICAL`/`ADOPTIVE`/`STEP` lookup code.
    pub relationship_type: String,
    /// Alternate-opinion group id; `None` for the primary modeling.
    pub alt_group_id: Option<String>,
    /// Free-text source citation backing this edge (e.g. "בראשית יא כו").
    pub source_citation: Option<String>,
}

/// A child edge of the focal person (`tanahpedia_person_parent_child` where
/// the focal person is the parent).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilyChildEdge {
    pub related: TanahpediaFamilyRelatedPerson,
    pub parent_role: String,
    pub relationship_type: String,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
    /// Positive one-based birth order on the parent-child edge.
    pub birth_order: Option<i32>,
    /// The other parent of this child, when modeled (groups children by
    /// spouse — e.g. "ילדים מ-שרה").
    pub co_parent_entity_id: Option<String>,
    pub co_parent_display_name: Option<String>,
    /// Union order of the focal person with the co-parent, when modeled.
    pub co_parent_union_order: Option<i32>,
}

/// A union (marriage/pilegesh/betrothal/…) edge of the focal person.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilySpouseEdge {
    pub related: TanahpediaFamilyRelatedPerson,
    /// `MARRIAGE`/`PILEGESH`/`BETROTHAL`/… lookup code.
    pub union_type: String,
    pub union_order: Option<i32>,
    pub alt_group_id: Option<String>,
    /// Source citation classifying the union itself.
    pub source_citation: Option<String>,
    /// Source citation about the spouse person (when it differs from the
    /// union-classifying source).
    pub person_source_citation: Option<String>,
    /// `DEATH`/`DIVORCE` lookup code when the union ended.
    pub union_end_reason: Option<String>,
    /// `YYYYMMDD` Hebrew-calendar dates when modeled.
    pub union_start_date: Option<i32>,
    pub union_end_date: Option<i32>,
}

/// A sibling of the focal person — persons sharing at least one parent edge.
/// The related-person fields are flattened into the object, mirroring the
/// website's `siblings: PersonFamilyRelatedPerson[]` shape.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilySibling {
    #[graphql(flatten)]
    pub related: TanahpediaFamilyRelatedPerson,
    /// `YYYYMMDD` birth date (non-alt row); `None` when unrecorded — used to
    /// split "אחים מבוגרים"/"אחים צעירים" relative to the focal birth date.
    pub birth_date_yyyymmdd: Option<i32>,
    /// Citation of the shared parent-child edge backing the sibling link.
    pub source_citation: Option<String>,
}

/// The family neighborhood of a `PERSON` entity — parents, children, spouses
/// and siblings with their source citations. Mirrors the website's
/// `PersonFamilySummary` (`/pedia` entry pages).
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonFamily {
    /// `tanahpedia_person.id` of the focal person.
    pub focal_person_id: String,
    /// `tanahpedia_entity.id` of the focal person (echoes the request).
    pub focal_entity_id: String,
    pub focal_display_name: String,
    /// `MALE`/`FEMALE`/`UNKNOWN` from the first recorded sex row; `None` when
    /// unrecorded (same lookup as the website).
    pub focal_sex: Option<String>,
    /// `YYYYMMDD` birth date of the focal person (non-alt row); `None` when
    /// unrecorded — clients then fall back to a generic sibling section.
    pub focal_birth_yyyymmdd: Option<i32>,
    pub parents: Vec<TanahpediaFamilyParentEdge>,
    pub children: Vec<TanahpediaFamilyChildEdge>,
    pub spouses: Vec<TanahpediaFamilySpouseEdge>,
    pub siblings: Vec<TanahpediaFamilySibling>,
}

/// A place identification pin for the places map (OpenStreetMap tiles — no
/// API key), with the place's first linked entry for in-app navigation.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPlaceMarker {
    /// `tanahpedia_place_identification.id` (the pin row).
    pub place_id: String,
    /// Entity display name of the place.
    pub place_name: String,
    /// Modern identification name, when recorded.
    pub modern_name: Option<String>,
    pub lat: f64,
    pub lng: f64,
    /// Canonical entry slug of the place's first linked entry; `None` when
    /// the place has no entry.
    pub entry_unique_name: Option<String>,
}
