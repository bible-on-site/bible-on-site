use async_graphql::SimpleObject;

/// A Tanahpedia person match, used to resolve a display name to the internal
/// `entityId`/`personId` pair needed by other family-graph operations.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonSummary {
    pub entity_id: String,
    pub person_id: String,
    pub display_name: String,
}

/// A union (marriage/pilegesh/etc.) link involving a given person, along with
/// enough context about the other party to identify it in the UI.
#[derive(SimpleObject, Debug, Clone)]
pub struct TanahpediaPersonUnionSummary {
    pub id: String,
    pub union_type: String,
    pub union_order: Option<i32>,
    pub source_citation: Option<String>,
    pub person1_id: String,
    pub person2_id: String,
    pub other_person_id: String,
    pub other_display_name: String,
}
