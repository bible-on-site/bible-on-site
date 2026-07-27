use async_graphql::{InputObject, SimpleObject};

#[derive(InputObject, Debug, Clone)]
pub struct PutTanahpediaPersonNodeInput {
    pub entity_id: String,
    pub person_id: String,
    pub display_name: String,
    pub sex_id: String,
    pub sex: String,
    pub sex_alt_group_id: Option<String>,
}

#[derive(InputObject, Debug, Clone)]
pub struct PutTanahpediaParentChildInput {
    pub id: String,
    pub parent_person_id: String,
    pub child_person_id: String,
    pub relationship_type: String,
    pub parent_role: String,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
}

#[derive(InputObject, Debug, Clone)]
pub struct PutTanahpediaPersonUnionInput {
    pub id: String,
    pub person1_id: String,
    pub person2_id: String,
    pub union_type: String,
    pub union_order: Option<i32>,
    pub start_date: Option<i32>,
    pub end_date: Option<i32>,
    pub end_reason: Option<String>,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
    pub person_source_citation: Option<String>,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaFamilyLinkWriteResult {
    pub id: String,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonNodeWriteResult {
    pub entity_id: String,
    pub person_id: String,
    pub sex_id: String,
}

/// A Tanahpedia person match, used to resolve a display name to the internal
/// `entityId`/`personId` pair needed by other family-graph operations.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonSummary {
    pub entity_id: String,
    pub person_id: String,
    pub display_name: String,
}

/// A Tanahpedia entity match of any type (`PERSON`, `PLACE`, `EVENT`, `WAR`,
/// `ANIMAL`, `OBJECT`, `TEMPLE_TOOL`, `PLANT`, `ASTRONOMICAL_OBJECT`,
/// `SAYING`, `SEFER`, `PROPHECY`, `NATION`), used to resolve a display name to
/// its internal `entityId` regardless of domain.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntitySummary {
    pub entity_id: String,
    pub entity_type: String,
    pub display_name: String,
}

/// A union (marriage/pilegesh/etc.) link involving a given person, along with
/// enough context about the other party to identify it in the UI.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonUnionSummary {
    pub id: String,
    pub union_type: String,
    pub union_order: Option<i32>,
    pub start_date: Option<i32>,
    pub end_date: Option<i32>,
    pub end_reason: Option<String>,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
    pub person_source_citation: Option<String>,
    pub person1_id: String,
    pub person2_id: String,
    pub other_person_id: String,
    pub other_display_name: String,
}

/// A parent/child link involving a given person, along with enough context
/// about the other party to identify it in the UI. `queried_is_parent` tells
/// the caller whether the queried person is the parent (`true`) or the child
/// (`false`) side of this link.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonParentChildSummary {
    pub id: String,
    pub relationship_type: String,
    pub parent_role: String,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
    pub parent_id: String,
    pub child_id: String,
    pub other_person_id: String,
    pub other_display_name: String,
    pub queried_is_parent: bool,
}

/// One of a person's (possibly several, alternate-opinion) display names.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonName {
    pub id: String,
    pub name: String,
    pub name_type: String,
    pub alt_group_id: Option<String>,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonSex {
    pub id: String,
    pub sex: String,
    pub alt_group_id: Option<String>,
}

/// A direct Tanah citation (perek + pasuk) attached to any Tanahpedia entity —
/// the "source for the entity itself", as opposed to a specific relationship's
/// `sourceCitation` free-text field.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaEntityTanahSource {
    pub perek_id: i32,
    pub pasuk_number: i32,
    pub segment_start: Option<i32>,
    pub segment_end: Option<i32>,
    /// Human-readable Hebrew citation, e.g. `"בראשית ל ד"`.
    pub citation: String,
}

/// The full reviewable detail of a Tanahpedia person: every name, sex,
/// birth/death fact (each field is a list because the schema allows multiple
/// alternate-opinion rows per person), and the entity-level Tanah citations
/// for the person as a whole.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonDetail {
    pub entity_id: String,
    pub person_id: String,
    pub display_name: String,
    pub names: Vec<TanahpediaPersonName>,
    pub sexes: Vec<String>,
    pub sex_rows: Vec<TanahpediaPersonSex>,
    pub birth_dates: Vec<i32>,
    pub death_dates: Vec<i32>,
    pub death_causes: Vec<String>,
    pub birth_place_ids: Vec<String>,
    pub tanah_sources: Vec<TanahpediaEntityTanahSource>,
}
