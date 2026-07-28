use async_graphql::{InputObject, SimpleObject};

#[derive(InputObject, Debug, Clone)]
pub struct PutTanahpediaEntryEntityLinkInput {
    pub id: String,
    pub entry_unique_name: String,
    pub entity_id: String,
}

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
pub struct DeleteTanahpediaPersonNodeInput {
    pub entity_id: String,
    pub person_id: String,
    pub sex_id: String,
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
pub struct TanahpediaEntryEntityLinkWriteResult {
    pub id: String,
    pub entry_id: String,
    pub entity_id: String,
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

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::{InputType, registry::Registry, value};

    #[test]
    fn entry_entity_link_input_parses_all_graphql_fields() {
        let input = PutTanahpediaEntryEntityLinkInput::parse(Some(value!({
            "id": "entry-entity-1",
            "entryUniqueName": "שמשון",
            "entityId": "entity-1"
        })))
        .expect("entry/entity link input should parse");

        assert_eq!(input.id, "entry-entity-1");
        assert_eq!(input.entry_unique_name, "שמשון");
        assert_eq!(input.entity_id, "entity-1");
    }

    #[test]
    fn person_node_input_parses_all_graphql_fields() {
        let input = PutTanahpediaPersonNodeInput::parse(Some(value!({
            "entityId": "entity-1",
            "personId": "person-1",
            "displayName": "שמשון",
            "sexId": "sex-1",
            "sex": "MALE",
            "sexAltGroupId": "alternate-1"
        })))
        .expect("person node input should parse");

        assert_eq!(input.entity_id, "entity-1");
        assert_eq!(input.person_id, "person-1");
        assert_eq!(input.display_name, "שמשון");
        assert_eq!(input.sex_id, "sex-1");
        assert_eq!(input.sex, "MALE");
        assert_eq!(input.sex_alt_group_id.as_deref(), Some("alternate-1"));
    }

    #[test]
    fn delete_person_node_input_parses_and_serializes_all_graphql_fields() {
        assert!(DeleteTanahpediaPersonNodeInput::parse(None).is_err());
        let input = DeleteTanahpediaPersonNodeInput::parse(Some(value!({
            "entityId": "entity-1",
            "personId": "person-1",
            "sexId": "sex-1"
        })))
        .expect("delete person node input should parse");

        assert_eq!(input.entity_id, "entity-1");
        assert_eq!(input.person_id, "person-1");
        assert_eq!(input.sex_id, "sex-1");
        assert_eq!(
            DeleteTanahpediaPersonNodeInput::type_name(),
            "DeleteTanahpediaPersonNodeInput"
        );
        assert_eq!(
            DeleteTanahpediaPersonNodeInput::qualified_type_name(),
            "DeleteTanahpediaPersonNodeInput!"
        );
        let mut registry = Registry::default();
        assert_eq!(
            DeleteTanahpediaPersonNodeInput::create_type_info(&mut registry),
            "DeleteTanahpediaPersonNodeInput!"
        );
        assert!(
            registry
                .types
                .contains_key("DeleteTanahpediaPersonNodeInput")
        );
        assert_eq!(
            DeleteTanahpediaPersonNodeInput::federation_fields().as_deref(),
            Some("{ entityId personId sexId }")
        );
        assert!(input.as_raw_value().is_some());
        let cloned = input.clone();
        assert!(format!("{cloned:?}").contains("person-1"));
        assert_eq!(
            input.to_value(),
            value!({
                "entityId": "entity-1",
                "personId": "person-1",
                "sexId": "sex-1"
            })
        );
    }
}
