use std::collections::{HashMap, HashSet};

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::perek::number_to_hebrew,
    dtos::tanahpedia_family::{
        PutTanahpediaEntryEntityLinkInput, PutTanahpediaParentChildInput,
        PutTanahpediaPersonNodeInput, PutTanahpediaPersonUnionInput, TanahpediaEntitySummary,
        TanahpediaEntityTanahSource, TanahpediaEntryEntityLinkWriteResult,
        TanahpediaFamilyLinkWriteResult, TanahpediaPersonDetail, TanahpediaPersonName,
        TanahpediaPersonNodeWriteResult, TanahpediaPersonParentChildSummary, TanahpediaPersonSex,
        TanahpediaPersonSummary, TanahpediaPersonUnionSummary,
    },
    providers::Database,
};
use entities::perek;
use entities::tanahpedia::{
    entity, entity_tanah_source, entry, entry_entity, lookup_name_type, lookup_parent_child_type,
    lookup_parent_role, lookup_union_end_reason, lookup_union_type, person, person_birth_date,
    person_birth_place, person_death_cause, person_death_date, person_name, person_parent_child,
    person_sex, person_union,
};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, IntoActiveModel, QueryFilter, QuerySelect,
    TransactionTrait,
};

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

fn required(value: String, field: &str, max_len: usize) -> Result<String, ServiceError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ServiceError::bad_request(&format!("{field} is required")));
    }
    if value.chars().count() > max_len {
        return Err(ServiceError::bad_request(&format!(
            "{field} must be at most {max_len} characters"
        )));
    }
    Ok(value)
}

fn optional(
    value: Option<String>,
    field: &str,
    max_len: usize,
) -> Result<Option<String>, ServiceError> {
    value
        .map(|value| required(value, field, max_len))
        .transpose()
}

fn normalized_sex(value: String) -> Result<String, ServiceError> {
    let sex = required(value, "sex", 7)?.to_uppercase();
    if matches!(sex.as_str(), "MALE" | "FEMALE" | "UNKNOWN") {
        Ok(sex)
    } else {
        Err(ServiceError::bad_request(
            "sex must be MALE, FEMALE, or UNKNOWN",
        ))
    }
}

pub async fn put_entry_entity_link(
    db: &Database,
    input: PutTanahpediaEntryEntityLinkInput,
) -> Result<TanahpediaEntryEntityLinkWriteResult, ServiceError> {
    let id = required(input.id, "id", 36)?;
    let entry_unique_name = required(input.entry_unique_name, "entryUniqueName", 255)?;
    let entity_id = required(input.entity_id, "entityId", 36)?;

    let transaction = db.get_connection().begin().await.map_err(db_error)?;
    let entry_id = entry::Entity::find()
        .filter(entry::Column::UniqueName.eq(entry_unique_name))
        .lock_exclusive()
        .one(&transaction)
        .await
        .map_err(db_error)?
        .map(|entry| entry.id)
        .ok_or_else(|| {
            ServiceError::bad_request("entryUniqueName does not reference an existing entry")
        })?;
    if entity::Entity::find_by_id(entity_id.clone())
        .one(&transaction)
        .await
        .map_err(db_error)?
        .is_none()
    {
        return Err(ServiceError::bad_request(
            "entityId does not reference an existing entity",
        ));
    }

    if let Some(existing) = entry_entity::Entity::find_by_id(id.clone())
        .lock_exclusive()
        .one(&transaction)
        .await
        .map_err(db_error)?
    {
        if existing.entry_id != entry_id || existing.entity_id != entity_id {
            return Err(ServiceError::bad_request(
                "id belongs to a different entry/entity link",
            ));
        }
        transaction.commit().await.map_err(db_error)?;
        return Ok(TanahpediaEntryEntityLinkWriteResult {
            id,
            entry_id,
            entity_id,
        });
    }

    if entry_entity::Entity::find()
        .filter(entry_entity::Column::EntryId.eq(entry_id.clone()))
        .filter(entry_entity::Column::EntityId.eq(entity_id.clone()))
        .lock_exclusive()
        .one(&transaction)
        .await
        .map_err(db_error)?
        .is_some()
    {
        return Err(ServiceError::bad_request(
            "entry/entity pair already belongs to a different id",
        ));
    }

    let insert_result = entry_entity::Entity::insert(
        entry_entity::Model {
            id: id.clone(),
            entry_id: entry_id.clone(),
            entity_id: entity_id.clone(),
        }
        .into_active_model(),
    )
    .exec(&transaction)
    .await;
    if let Err(insert_error) = insert_result {
        if let Some(existing) = entry_entity::Entity::find_by_id(id.clone())
            .lock_exclusive()
            .one(&transaction)
            .await
            .map_err(db_error)?
        {
            if existing.entry_id != entry_id || existing.entity_id != entity_id {
                return Err(ServiceError::bad_request(
                    "id belongs to a different entry/entity link",
                ));
            }
            transaction.commit().await.map_err(db_error)?;
            return Ok(TanahpediaEntryEntityLinkWriteResult {
                id,
                entry_id,
                entity_id,
            });
        }
        return Err(db_error(insert_error));
    }
    transaction.commit().await.map_err(db_error)?;

    Ok(TanahpediaEntryEntityLinkWriteResult {
        id,
        entry_id,
        entity_id,
    })
}

async fn require_person(
    conn: &sea_orm::DatabaseConnection,
    person_id: &str,
) -> Result<(), ServiceError> {
    if person::Entity::find_by_id(person_id.to_string())
        .one(conn)
        .await
        .map_err(db_error)?
        .is_none()
    {
        return Err(ServiceError::bad_request(&format!(
            "personId {person_id} does not reference an existing person"
        )));
    }
    Ok(())
}

async fn parent_child_type_id(
    conn: &sea_orm::DatabaseConnection,
    name: String,
) -> Result<String, ServiceError> {
    let name = required(name, "relationshipType", 50)?.to_uppercase();
    lookup_parent_child_type::Entity::find()
        .filter(lookup_parent_child_type::Column::Name.eq(name.clone()))
        .one(conn)
        .await
        .map_err(db_error)?
        .map(|row| row.id)
        .ok_or_else(|| ServiceError::bad_request(&format!("unknown relationshipType {name}")))
}

async fn parent_role_id(
    conn: &sea_orm::DatabaseConnection,
    name: String,
) -> Result<String, ServiceError> {
    let name = required(name, "parentRole", 50)?.to_uppercase();
    lookup_parent_role::Entity::find()
        .filter(lookup_parent_role::Column::Name.eq(name.clone()))
        .one(conn)
        .await
        .map_err(db_error)?
        .map(|row| row.id)
        .ok_or_else(|| ServiceError::bad_request(&format!("unknown parentRole {name}")))
}

async fn union_type_id(
    conn: &sea_orm::DatabaseConnection,
    name: String,
) -> Result<String, ServiceError> {
    let name = required(name, "unionType", 50)?.to_uppercase();
    lookup_union_type::Entity::find()
        .filter(lookup_union_type::Column::Name.eq(name.clone()))
        .one(conn)
        .await
        .map_err(db_error)?
        .map(|row| row.id)
        .ok_or_else(|| ServiceError::bad_request(&format!("unknown unionType {name}")))
}

async fn union_end_reason_id(
    conn: &sea_orm::DatabaseConnection,
    name: Option<String>,
) -> Result<Option<String>, ServiceError> {
    let Some(name) = optional(name, "endReason", 50)?.map(|name| name.to_uppercase()) else {
        return Ok(None);
    };
    lookup_union_end_reason::Entity::find()
        .filter(lookup_union_end_reason::Column::Name.eq(name.clone()))
        .one(conn)
        .await
        .map_err(db_error)?
        .map(|row| Some(row.id))
        .ok_or_else(|| ServiceError::bad_request(&format!("unknown endReason {name}")))
}

pub async fn put_person_node(
    db: &Database,
    input: PutTanahpediaPersonNodeInput,
) -> Result<TanahpediaPersonNodeWriteResult, ServiceError> {
    let entity_id = required(input.entity_id, "entityId", 36)?;
    let person_id = required(input.person_id, "personId", 36)?;
    let display_name = required(input.display_name, "displayName", 255)?;
    let sex_id = required(input.sex_id, "sexId", 36)?;
    let sex = normalized_sex(input.sex)?;
    let sex_alt_group_id = optional(input.sex_alt_group_id, "sexAltGroupId", 36)?;

    let transaction = db.get_connection().begin().await.map_err(db_error)?;
    let existing_entity = entity::Entity::find_by_id(entity_id.clone())
        .one(&transaction)
        .await
        .map_err(db_error)?;
    if existing_entity
        .as_ref()
        .is_some_and(|existing| existing.entity_type != "PERSON")
    {
        return Err(ServiceError::bad_request(
            "entityId references a non-PERSON entity",
        ));
    }
    if let Some(existing) = person::Entity::find_by_id(person_id.clone())
        .one(&transaction)
        .await
        .map_err(db_error)?
        && existing.entity_id != entity_id
    {
        return Err(ServiceError::bad_request(
            "personId belongs to a different entityId",
        ));
    }
    if let Some(existing) = person::Entity::find()
        .filter(person::Column::EntityId.eq(entity_id.clone()))
        .one(&transaction)
        .await
        .map_err(db_error)?
        && existing.id != person_id
    {
        return Err(ServiceError::bad_request(
            "entityId belongs to a different personId",
        ));
    }
    if let Some(existing) = person_sex::Entity::find_by_id(sex_id.clone())
        .one(&transaction)
        .await
        .map_err(db_error)?
        && existing.person_id != person_id
    {
        return Err(ServiceError::bad_request(
            "sexId belongs to a different personId",
        ));
    }
    let now = chrono::Utc::now().naive_utc();
    if existing_entity
        .as_ref()
        .is_none_or(|existing| existing.name != display_name)
    {
        entity::Entity::insert(
            entity::Model {
                id: entity_id.clone(),
                entity_type: "PERSON".to_string(),
                name: display_name,
                created_at: now,
                updated_at: now,
            }
            .into_active_model(),
        )
        .on_conflict(
            OnConflict::column(entity::Column::Id)
                .update_columns([entity::Column::EntityType, entity::Column::Name])
                .to_owned(),
        )
        .exec(&transaction)
        .await
        .map_err(db_error)?;
    }

    person::Entity::insert(
        person::Model {
            id: person_id.clone(),
            entity_id: entity_id.clone(),
        }
        .into_active_model(),
    )
    .on_conflict(
        OnConflict::column(person::Column::Id)
            .update_column(person::Column::EntityId)
            .to_owned(),
    )
    .exec(&transaction)
    .await
    .map_err(db_error)?;

    person_sex::Entity::insert(
        person_sex::Model {
            id: sex_id.clone(),
            person_id: person_id.clone(),
            sex,
            alt_group_id: sex_alt_group_id,
        }
        .into_active_model(),
    )
    .on_conflict(
        OnConflict::column(person_sex::Column::Id)
            .update_columns([
                person_sex::Column::PersonId,
                person_sex::Column::Sex,
                person_sex::Column::AltGroupId,
            ])
            .to_owned(),
    )
    .exec(&transaction)
    .await
    .map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;

    Ok(TanahpediaPersonNodeWriteResult {
        entity_id,
        person_id,
        sex_id,
    })
}

pub async fn put_parent_child_link(
    db: &Database,
    input: PutTanahpediaParentChildInput,
) -> Result<TanahpediaFamilyLinkWriteResult, ServiceError> {
    let conn = db.get_connection();
    let id = required(input.id, "id", 36)?;
    let parent_id = required(input.parent_person_id, "parentPersonId", 36)?;
    let child_id = required(input.child_person_id, "childPersonId", 36)?;
    let relationship_type = required(input.relationship_type, "relationshipType", 50)?;
    let parent_role = required(input.parent_role, "parentRole", 50)?;
    let alt_group_id = optional(input.alt_group_id, "altGroupId", 36)?;
    let source_citation = optional(input.source_citation, "sourceCitation", 400)?;
    if parent_id == child_id {
        return Err(ServiceError::bad_request(
            "a person cannot be their own parent",
        ));
    }
    require_person(conn, &parent_id).await?;
    require_person(conn, &child_id).await?;

    let model = person_parent_child::Model {
        id: id.clone(),
        parent_id,
        child_id,
        relationship_type_id: parent_child_type_id(conn, relationship_type).await?,
        parent_role_id: parent_role_id(conn, parent_role).await?,
        alt_group_id,
        source_citation,
    };

    person_parent_child::Entity::insert(model.into_active_model())
        .on_conflict(
            OnConflict::column(person_parent_child::Column::Id)
                .update_columns([
                    person_parent_child::Column::ParentId,
                    person_parent_child::Column::ChildId,
                    person_parent_child::Column::RelationshipTypeId,
                    person_parent_child::Column::ParentRoleId,
                    person_parent_child::Column::AltGroupId,
                    person_parent_child::Column::SourceCitation,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await
        .map_err(db_error)?;

    Ok(TanahpediaFamilyLinkWriteResult { id })
}

pub async fn delete_parent_child_link(
    db: &Database,
    id: String,
) -> Result<TanahpediaFamilyLinkWriteResult, ServiceError> {
    let id = required(id, "id", 36)?;
    let result = person_parent_child::Entity::delete_by_id(id.clone())
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    if result.rows_affected == 0 {
        return Err(ServiceError::not_found(
            "parent-child link not found",
            None::<&str>,
        ));
    }
    Ok(TanahpediaFamilyLinkWriteResult { id })
}

pub async fn put_person_union(
    db: &Database,
    input: PutTanahpediaPersonUnionInput,
) -> Result<TanahpediaFamilyLinkWriteResult, ServiceError> {
    let conn = db.get_connection();
    let id = required(input.id, "id", 36)?;
    let person1_id = required(input.person1_id, "person1Id", 36)?;
    let person2_id = required(input.person2_id, "person2Id", 36)?;
    let union_type = required(input.union_type, "unionType", 50)?;
    let end_reason = optional(input.end_reason, "endReason", 50)?;
    let alt_group_id = optional(input.alt_group_id, "altGroupId", 36)?;
    let source_citation = optional(input.source_citation, "sourceCitation", 400)?;
    let person_source_citation =
        optional(input.person_source_citation, "personSourceCitation", 400)?;
    if person1_id == person2_id {
        return Err(ServiceError::bad_request(
            "a person cannot be united with themselves",
        ));
    }
    require_person(conn, &person1_id).await?;
    require_person(conn, &person2_id).await?;

    let model = person_union::Model {
        id: id.clone(),
        person1_id,
        person2_id,
        union_type_id: union_type_id(conn, union_type).await?,
        union_order: input.union_order,
        start_date: input.start_date,
        end_date: input.end_date,
        end_reason_id: union_end_reason_id(conn, end_reason).await?,
        alt_group_id,
        source_citation,
        person_source_citation,
    };

    person_union::Entity::insert(model.into_active_model())
        .on_conflict(
            OnConflict::column(person_union::Column::Id)
                .update_columns([
                    person_union::Column::Person1Id,
                    person_union::Column::Person2Id,
                    person_union::Column::UnionTypeId,
                    person_union::Column::UnionOrder,
                    person_union::Column::StartDate,
                    person_union::Column::EndDate,
                    person_union::Column::EndReasonId,
                    person_union::Column::AltGroupId,
                    person_union::Column::SourceCitation,
                    person_union::Column::PersonSourceCitation,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await
        .map_err(db_error)?;

    Ok(TanahpediaFamilyLinkWriteResult { id })
}

pub async fn delete_person_union(
    db: &Database,
    id: String,
) -> Result<TanahpediaFamilyLinkWriteResult, ServiceError> {
    let id = required(id, "id", 36)?;
    let result = person_union::Entity::delete_by_id(id.clone())
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    if result.rows_affected == 0 {
        return Err(ServiceError::not_found(
            "person union not found",
            None::<&str>,
        ));
    }
    Ok(TanahpediaFamilyLinkWriteResult { id })
}

/// Formats a perek + pasuk pair as a human-readable Hebrew citation, e.g.
/// `"בראשית ל ד"`. Falls back to an empty string when the perek can't be
/// resolved (a dangling `perek_id` should never happen in practice, but this
/// keeps the read path total rather than failing the whole query).
fn format_citation(perek_row: &perek::Model, pasuk_number: i32) -> String {
    let sefer_name = perek_row.sefer_name.clone().unwrap_or_default();
    let perek_num = perek_row.perek.unwrap_or_default();
    format!(
        "{} {} {}",
        sefer_name,
        number_to_hebrew(perek_num),
        number_to_hebrew(pasuk_number)
    )
    .trim()
    .to_string()
}

/// Resolves a display name to the matching Tanahpedia `PERSON` entities.
/// Returns every match — Torah names are frequently shared (e.g. more than one
/// entity may bear the same display name) — so callers must disambiguate.
pub async fn find_persons_by_name(
    db: &Database,
    name: String,
) -> Result<Vec<TanahpediaPersonSummary>, ServiceError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(ServiceError::bad_request("name is required"));
    }

    let conn = db.get_connection();

    let entities = entity::Entity::find()
        .filter(entity::Column::EntityType.eq("PERSON"))
        .filter(entity::Column::Name.eq(name))
        .all(conn)
        .await
        .map_err(db_error)?;

    let mut summaries = Vec::with_capacity(entities.len());
    for e in entities {
        let person = person::Entity::find()
            .filter(person::Column::EntityId.eq(e.id.clone()))
            .one(conn)
            .await
            .map_err(db_error)?;
        if let Some(person) = person {
            summaries.push(TanahpediaPersonSummary {
                entity_id: e.id,
                person_id: person.id,
                display_name: e.name,
            });
        }
    }

    Ok(summaries)
}

/// Looks up the display name of the `PERSON` entity linked to `person_id`, or
/// `None` if the person row (or its linked entity) no longer exists.
async fn display_name_for_person(
    conn: &sea_orm::DatabaseConnection,
    person_id: &str,
) -> Result<Option<String>, ServiceError> {
    let Some(person) = person::Entity::find_by_id(person_id.to_string())
        .one(conn)
        .await
        .map_err(db_error)?
    else {
        return Ok(None);
    };

    let entity = entity::Entity::find_by_id(person.entity_id)
        .one(conn)
        .await
        .map_err(db_error)?;

    Ok(entity.map(|e| e.name))
}

/// Lists every union (marriage/pilegesh/betrothal/etc.) link involving
/// `person_id`, along with the other party's id/display name and the
/// `sourceCitation` needed to review or correct that link.
pub async fn get_person_unions(
    db: &Database,
    person_id: String,
) -> Result<Vec<TanahpediaPersonUnionSummary>, ServiceError> {
    let person_id = person_id.trim().to_string();
    if person_id.is_empty() {
        return Err(ServiceError::bad_request("personId is required"));
    }

    let conn = db.get_connection();

    let unions = person_union::Entity::find()
        .filter(
            Condition::any()
                .add(person_union::Column::Person1Id.eq(person_id.clone()))
                .add(person_union::Column::Person2Id.eq(person_id.clone())),
        )
        .all(conn)
        .await
        .map_err(db_error)?;

    let union_type_ids = unions
        .iter()
        .map(|union| union.union_type_id.clone())
        .collect::<HashSet<_>>();
    let union_types = lookup_union_type::Entity::find()
        .filter(lookup_union_type::Column::Id.is_in(union_type_ids))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| (row.id, row.name))
        .collect::<HashMap<_, _>>();

    let end_reason_ids = unions
        .iter()
        .filter_map(|union| union.end_reason_id.clone())
        .collect::<HashSet<_>>();
    let end_reasons = if end_reason_ids.is_empty() {
        HashMap::new()
    } else {
        lookup_union_end_reason::Entity::find()
            .filter(lookup_union_end_reason::Column::Id.is_in(end_reason_ids))
            .all(conn)
            .await
            .map_err(db_error)?
            .into_iter()
            .map(|row| (row.id, row.name))
            .collect()
    };

    let mut summaries = Vec::with_capacity(unions.len());
    for u in unions {
        let union_type = union_types
            .get(&u.union_type_id)
            .cloned()
            .unwrap_or_default();
        let end_reason = u
            .end_reason_id
            .as_ref()
            .and_then(|id| end_reasons.get(id).cloned());

        let other_person_id = if u.person1_id == person_id {
            u.person2_id.clone()
        } else {
            u.person1_id.clone()
        };

        let other_display_name = display_name_for_person(conn, &other_person_id)
            .await?
            .unwrap_or_default();

        summaries.push(TanahpediaPersonUnionSummary {
            id: u.id,
            union_type,
            union_order: u.union_order,
            start_date: u.start_date,
            end_date: u.end_date,
            end_reason,
            alt_group_id: u.alt_group_id,
            source_citation: u.source_citation,
            person_source_citation: u.person_source_citation,
            person1_id: u.person1_id,
            person2_id: u.person2_id,
            other_person_id,
            other_display_name,
        });
    }

    Ok(summaries)
}

/// Resolves a display name to matching Tanahpedia entities of any type
/// (`PERSON`, `PLACE`, `EVENT`, `WAR`, `ANIMAL`, `OBJECT`, `TEMPLE_TOOL`,
/// `PLANT`, `ASTRONOMICAL_OBJECT`, `SAYING`, `SEFER`, `PROPHECY`, `NATION`).
/// Pass `entity_type` to narrow the search to a single type.
pub async fn find_entities(
    db: &Database,
    name: String,
    entity_type: Option<String>,
) -> Result<Vec<TanahpediaEntitySummary>, ServiceError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(ServiceError::bad_request("name is required"));
    }

    let conn = db.get_connection();

    let mut query = entity::Entity::find().filter(entity::Column::Name.eq(name));
    if let Some(entity_type) = entity_type
        .map(|t| t.trim().to_uppercase())
        .filter(|t| !t.is_empty())
    {
        query = query.filter(entity::Column::EntityType.eq(entity_type));
    }

    let rows = query.all(conn).await.map_err(db_error)?;

    Ok(rows
        .into_iter()
        .map(|e| TanahpediaEntitySummary {
            entity_id: e.id,
            entity_type: e.entity_type,
            display_name: e.name,
        })
        .collect())
}

/// Lists the direct Tanah citations (perek + pasuk) attached to an entity —
/// the "source for the entity itself", as opposed to a specific
/// relationship's `sourceCitation` free-text field.
pub async fn get_entity_tanah_sources(
    db: &Database,
    entity_id: String,
) -> Result<Vec<TanahpediaEntityTanahSource>, ServiceError> {
    let entity_id = entity_id.trim().to_string();
    if entity_id.is_empty() {
        return Err(ServiceError::bad_request("entityId is required"));
    }

    let conn = db.get_connection();

    let rows = entity_tanah_source::Entity::find()
        .filter(entity_tanah_source::Column::EntityId.eq(entity_id))
        .all(conn)
        .await
        .map_err(db_error)?;

    let mut sources = Vec::with_capacity(rows.len());
    for row in rows {
        let perek_row = perek::Entity::find_by_id(row.perek_id)
            .one(conn)
            .await
            .map_err(db_error)?;
        let citation = perek_row
            .as_ref()
            .map(|p| format_citation(p, row.pasuk_number))
            .unwrap_or_default();

        sources.push(TanahpediaEntityTanahSource {
            perek_id: row.perek_id,
            pasuk_number: row.pasuk_number,
            segment_start: row.segment_start,
            segment_end: row.segment_end,
            citation,
        });
    }

    Ok(sources)
}

/// Every parent/child link involving `person_id` (as either the parent or the
/// child side), along with the other party's id/display name and the
/// `sourceCitation` needed to review or correct that link.
pub async fn get_person_parent_child(
    db: &Database,
    person_id: String,
) -> Result<Vec<TanahpediaPersonParentChildSummary>, ServiceError> {
    let person_id = person_id.trim().to_string();
    if person_id.is_empty() {
        return Err(ServiceError::bad_request("personId is required"));
    }

    let conn = db.get_connection();

    let rows = person_parent_child::Entity::find()
        .filter(
            Condition::any()
                .add(person_parent_child::Column::ParentId.eq(person_id.clone()))
                .add(person_parent_child::Column::ChildId.eq(person_id.clone())),
        )
        .all(conn)
        .await
        .map_err(db_error)?;

    let mut summaries = Vec::with_capacity(rows.len());
    for row in rows {
        let relationship_type =
            lookup_parent_child_type::Entity::find_by_id(row.relationship_type_id.clone())
                .one(conn)
                .await
                .map_err(db_error)?
                .map(|t| t.name)
                .unwrap_or_default();

        let parent_role = lookup_parent_role::Entity::find_by_id(row.parent_role_id.clone())
            .one(conn)
            .await
            .map_err(db_error)?
            .map(|t| t.name)
            .unwrap_or_default();

        let queried_is_parent = row.parent_id == person_id;
        let other_person_id = if queried_is_parent {
            row.child_id.clone()
        } else {
            row.parent_id.clone()
        };
        let other_display_name = display_name_for_person(conn, &other_person_id)
            .await?
            .unwrap_or_default();

        summaries.push(TanahpediaPersonParentChildSummary {
            id: row.id,
            relationship_type,
            parent_role,
            alt_group_id: row.alt_group_id,
            source_citation: row.source_citation,
            parent_id: row.parent_id,
            child_id: row.child_id,
            other_person_id,
            other_display_name,
            queried_is_parent,
        });
    }

    Ok(summaries)
}

/// The full reviewable detail of a person: every name, sex, birth/death fact,
/// and entity-level Tanah citation. Returns `NotFound` when the person (or
/// its linked entity) doesn't exist.
pub async fn get_person_details(
    db: &Database,
    person_id: String,
) -> Result<TanahpediaPersonDetail, ServiceError> {
    let person_id = person_id.trim().to_string();
    if person_id.is_empty() {
        return Err(ServiceError::bad_request("personId is required"));
    }

    let conn = db.get_connection();

    let person = person::Entity::find_by_id(person_id.clone())
        .one(conn)
        .await
        .map_err(db_error)?
        .ok_or_else(|| ServiceError::not_found("Person not found", Option::<String>::None))?;

    let entity_row = entity::Entity::find_by_id(person.entity_id)
        .one(conn)
        .await
        .map_err(db_error)?
        .ok_or_else(|| {
            ServiceError::not_found("Linked entity not found", Option::<String>::None)
        })?;

    let name_rows = person_name::Entity::find()
        .filter(person_name::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?;
    let mut names = Vec::with_capacity(name_rows.len());
    for row in name_rows {
        let name_type = lookup_name_type::Entity::find_by_id(row.name_type_id.clone())
            .one(conn)
            .await
            .map_err(db_error)?
            .map(|t| t.name)
            .unwrap_or_default();
        names.push(TanahpediaPersonName {
            id: row.id,
            name: row.name,
            name_type,
            alt_group_id: row.alt_group_id,
        });
    }

    let sex_models = person_sex::Entity::find()
        .filter(person_sex::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?;
    let sexes = sex_models.iter().map(|row| row.sex.clone()).collect();
    let sex_rows = sex_models
        .into_iter()
        .map(|row| TanahpediaPersonSex {
            id: row.id,
            sex: row.sex,
            alt_group_id: row.alt_group_id,
        })
        .collect();

    let birth_dates = person_birth_date::Entity::find()
        .filter(person_birth_date::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.birth_date)
        .collect();

    let death_dates = person_death_date::Entity::find()
        .filter(person_death_date::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.death_date)
        .collect();

    let death_causes = person_death_cause::Entity::find()
        .filter(person_death_cause::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.death_cause)
        .collect();

    let birth_place_ids = person_birth_place::Entity::find()
        .filter(person_birth_place::Column::PersonId.eq(person_id.clone()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.place_id)
        .collect();

    let tanah_sources = get_entity_tanah_sources(db, entity_row.id.clone()).await?;

    Ok(TanahpediaPersonDetail {
        entity_id: entity_row.id,
        person_id,
        display_name: entity_row.name,
        names,
        sexes,
        sex_rows,
        birth_dates,
        death_dates,
        death_causes,
        birth_place_ids,
        tanah_sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, QueryTrait};

    fn entity_model(id: &str, name: &str) -> entity::Model {
        entity::Model {
            id: id.to_string(),
            entity_type: "PERSON".to_string(),
            name: name.to_string(),
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        }
    }

    fn person_model(id: &str, entity_id: &str) -> person::Model {
        person::Model {
            id: id.to_string(),
            entity_id: entity_id.to_string(),
        }
    }

    fn entry_model(id: &str, unique_name: &str) -> entry::Model {
        entry::Model {
            id: id.to_string(),
            unique_name: unique_name.to_string(),
            title: unique_name.to_string(),
            content: None,
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        }
    }

    fn entry_entity_model(id: &str, entry_id: &str, entity_id: &str) -> entry_entity::Model {
        entry_entity::Model {
            id: id.to_string(),
            entry_id: entry_id.to_string(),
            entity_id: entity_id.to_string(),
        }
    }

    fn union_type_model(id: &str, name: &str) -> lookup_union_type::Model {
        lookup_union_type::Model {
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    fn union_model(
        id: &str,
        person1_id: &str,
        person2_id: &str,
        union_order: Option<i32>,
        source_citation: Option<&str>,
        person_source_citation: Option<&str>,
    ) -> person_union::Model {
        person_union::Model {
            id: id.to_string(),
            person1_id: person1_id.to_string(),
            person2_id: person2_id.to_string(),
            union_type_id: "ut-marriage".to_string(),
            union_order,
            start_date: Some(20000101),
            end_date: Some(20010101),
            end_reason_id: Some("uer-death".to_string()),
            alt_group_id: Some("alt-union".to_string()),
            source_citation: source_citation.map(str::to_string),
            person_source_citation: person_source_citation.map(str::to_string),
        }
    }

    fn parent_child_input() -> PutTanahpediaParentChildInput {
        PutTanahpediaParentChildInput {
            id: "pc-1".to_string(),
            parent_person_id: "parent-1".to_string(),
            child_person_id: "child-1".to_string(),
            relationship_type: "biological".to_string(),
            parent_role: "father".to_string(),
            alt_group_id: None,
            source_citation: Some("בראשית".to_string()),
        }
    }

    fn union_input() -> PutTanahpediaPersonUnionInput {
        PutTanahpediaPersonUnionInput {
            id: "union-1".to_string(),
            person1_id: "person-1".to_string(),
            person2_id: "person-2".to_string(),
            union_type: "marriage".to_string(),
            union_order: Some(1),
            start_date: None,
            end_date: None,
            end_reason: Some("death".to_string()),
            alt_group_id: None,
            source_citation: Some("בראשית".to_string()),
            person_source_citation: Some("בראשית כט".to_string()),
        }
    }

    fn person_node_input() -> PutTanahpediaPersonNodeInput {
        PutTanahpediaPersonNodeInput {
            entity_id: "entity-1".to_string(),
            person_id: "person-1".to_string(),
            display_name: "שמשון".to_string(),
            sex_id: "sex-1".to_string(),
            sex: "male".to_string(),
            sex_alt_group_id: None,
        }
    }

    fn entry_entity_link_input() -> PutTanahpediaEntryEntityLinkInput {
        PutTanahpediaEntryEntityLinkInput {
            id: "entry-entity-1".to_string(),
            entry_unique_name: "שמשון".to_string(),
            entity_id: "entity-1".to_string(),
        }
    }

    #[test]
    fn entry_entity_insert_uses_only_canonical_table_columns() {
        let statement = entry_entity::Entity::insert(
            entry_entity_model("entry-entity-1", "entry-1", "entity-1").into_active_model(),
        )
        .build(DatabaseBackend::MySql);

        assert!(statement.sql.contains("`id`, `entry_id`, `entity_id`"));
        assert!(!statement.sql.contains("entity_type"));
    }

    #[test]
    fn entry_entity_collision_lookups_lock_concurrent_writes() {
        let entry_statement = entry::Entity::find()
            .filter(entry::Column::UniqueName.eq("שמשון"))
            .lock_exclusive()
            .build(DatabaseBackend::MySql);
        let id_statement = entry_entity::Entity::find_by_id("entry-entity-1")
            .lock_exclusive()
            .build(DatabaseBackend::MySql);
        let pair_statement = entry_entity::Entity::find()
            .filter(entry_entity::Column::EntryId.eq("entry-1"))
            .filter(entry_entity::Column::EntityId.eq("entity-1"))
            .lock_exclusive()
            .build(DatabaseBackend::MySql);

        assert!(entry_statement.to_string().ends_with("FOR UPDATE"));
        assert!(id_statement.to_string().ends_with("FOR UPDATE"));
        assert!(pair_statement.to_string().ends_with("FOR UPDATE"));
    }

    #[tokio::test]
    async fn put_entry_entity_link_creates_and_replays_without_another_write() {
        let link = entry_entity_model("entry-entity-1", "entry-1", "entity-1");
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    link,
                ]])
                .into_connection(),
        );

        let first = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .expect("should create link");
        let second = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .expect("should replay link");

        assert_eq!(first.id, "entry-entity-1");
        assert_eq!(first.entry_id, "entry-1");
        assert_eq!(first.entity_id, "entity-1");
        assert_eq!(second.id, first.id);
        assert_eq!(second.entry_id, first.entry_id);
        assert_eq!(second.entity_id, first.entity_id);
    }

    #[tokio::test]
    async fn put_entry_entity_link_rejects_id_collision() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    entry_entity_model("entry-entity-1", "entry-other", "entity-1"),
                ]])
                .into_connection(),
        );

        let err = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_entry_entity_link_rejects_pair_collision() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    entry_entity_model("entry-entity-other", "entry-1", "entity-1"),
                ]])
                .into_connection(),
        );

        let err = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_entry_entity_link_reconciles_concurrent_exact_insert() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_exec_errors([sea_orm::DbErr::RecordNotInserted])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    entry_entity_model("entry-entity-1", "entry-1", "entity-1"),
                ]])
                .into_connection(),
        );

        let result = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .expect("should reconcile exact concurrent insert");

        assert_eq!(result.id, "entry-entity-1");
        assert_eq!(result.entry_id, "entry-1");
        assert_eq!(result.entity_id, "entity-1");
    }

    #[tokio::test]
    async fn put_entry_entity_link_rejects_concurrent_id_collision() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_exec_errors([sea_orm::DbErr::RecordNotInserted])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![
                    entry_entity_model("entry-entity-1", "entry-other", "entity-1"),
                ]])
                .into_connection(),
        );

        let err = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_entry_entity_link_preserves_unrelated_insert_error() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .append_exec_errors([sea_orm::DbErr::Custom("insert failed".to_string())])
                .append_query_results::<entry_entity::Model, Vec<entry_entity::Model>, _>([vec![]])
                .into_connection(),
        );

        let err = put_entry_entity_link(&db, entry_entity_link_input())
            .await
            .unwrap_err();

        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }

    #[tokio::test]
    async fn put_entry_entity_link_rejects_missing_entry_or_entity() {
        let missing_entry_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .into_connection(),
        );
        let missing_entity_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                )]])
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![]])
                .into_connection(),
        );

        let missing_entry = put_entry_entity_link(&missing_entry_db, entry_entity_link_input())
            .await
            .unwrap_err();
        let missing_entity = put_entry_entity_link(&missing_entity_db, entry_entity_link_input())
            .await
            .unwrap_err();

        assert!(matches!(missing_entry, ServiceError::BadRequest(_)));
        assert!(matches!(missing_entity, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_person_node_rejects_unknown_sex_before_querying() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let mut input = person_node_input();
        input.sex = "other".to_string();

        let err = put_person_node(&db, input).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[test]
    fn normalized_sex_accepts_case_insensitive_values() {
        assert_eq!(normalized_sex("male".to_string()).unwrap(), "MALE");
        assert_eq!(normalized_sex("FEMALE".to_string()).unwrap(), "FEMALE");
        assert_eq!(normalized_sex(" unknown ".to_string()).unwrap(), "UNKNOWN");
    }

    #[tokio::test]
    async fn put_person_node_upserts_the_complete_node() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
            .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![]])
            .append_exec_results([
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
            ])
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-1",
                "שמשון",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "person-1", "entity-1",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "person-1", "entity-1",
            )]])
            .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![
                person_sex::Model {
                    id: "sex-1".to_string(),
                    person_id: "person-1".to_string(),
                    sex: "MALE".to_string(),
                    alt_group_id: None,
                },
            ]])
            .append_exec_results([
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
            ])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let first = put_person_node(&db, person_node_input())
            .await
            .expect("should upsert");
        let second = put_person_node(&db, person_node_input())
            .await
            .expect("replay should upsert");

        assert_eq!(first.entity_id, "entity-1");
        assert_eq!(first.person_id, "person-1");
        assert_eq!(first.sex_id, "sex-1");
        assert_eq!(second.entity_id, first.entity_id);
        assert_eq!(second.person_id, first.person_id);
        assert_eq!(second.sex_id, first.sex_id);
    }

    #[tokio::test]
    async fn put_person_node_attaches_missing_person_without_updating_matching_entity() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
                .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![]])
                .append_exec_results([
                    MockExecResult {
                        last_insert_id: 0,
                        rows_affected: 1,
                    },
                    MockExecResult {
                        last_insert_id: 0,
                        rows_affected: 1,
                    },
                ])
                .into_connection(),
        );

        let result = put_person_node(&db, person_node_input())
            .await
            .expect("should attach missing person");

        assert_eq!(result.entity_id, "entity-1");
        assert_eq!(result.person_id, "person-1");
        assert_eq!(result.sex_id, "sex-1");
    }

    #[tokio::test]
    async fn put_person_node_rejects_non_person_entity_collision() {
        let mut existing = entity_model("entity-1", "מקום");
        existing.entity_type = "PLACE".to_string();
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![existing]])
                .into_connection(),
        );

        let err = put_person_node(&db, person_node_input()).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_person_node_rejects_person_id_collision() {
        let db =
            Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![
                        entity_model("entity-1", "שמשון"),
                    ]])
                    .append_query_results::<person::Model, Vec<person::Model>, _>([vec![
                        person_model("person-1", "entity-other"),
                    ]])
                    .into_connection(),
            );

        let err = put_person_node(&db, person_node_input()).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_person_node_rejects_entity_id_collision() {
        let db =
            Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![
                        entity_model("entity-1", "שמשון"),
                    ]])
                    .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
                    .append_query_results::<person::Model, Vec<person::Model>, _>([vec![
                        person_model("person-other", "entity-1"),
                    ]])
                    .into_connection(),
            );

        let err = put_person_node(&db, person_node_input()).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_person_node_rejects_sex_id_collision() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "entity-1",
                    "שמשון",
                )]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "person-1", "entity-1",
                )]])
                .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                    "person-1", "entity-1",
                )]])
                .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![
                    person_sex::Model {
                        id: "sex-1".to_string(),
                        person_id: "person-other".to_string(),
                        sex: "MALE".to_string(),
                        alt_group_id: None,
                    },
                ]])
                .into_connection(),
        );

        let err = put_person_node(&db, person_node_input()).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_parent_child_link_rejects_self_parent() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let mut input = parent_child_input();
        input.child_person_id = input.parent_person_id.clone();

        let err = put_parent_child_link(&db, input).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_parent_child_link_resolves_lookups_and_upserts() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "parent-1",
                "entity-parent",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "child-1",
                "entity-child",
            )]])
            .append_query_results::<lookup_parent_child_type::Model, Vec<lookup_parent_child_type::Model>, _>(
                [vec![lookup_parent_child_type::Model {
                    id: "pct-biological".to_string(),
                    name: "BIOLOGICAL".to_string(),
                }]],
            )
            .append_query_results::<lookup_parent_role::Model, Vec<lookup_parent_role::Model>, _>([vec![
                lookup_parent_role::Model {
                    id: "pr-father".to_string(),
                    name: "FATHER".to_string(),
                },
            ]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = put_parent_child_link(&db, parent_child_input())
            .await
            .expect("should upsert");

        assert_eq!(result.id, "pc-1");
    }

    #[tokio::test]
    async fn put_person_union_rejects_long_citation_before_querying() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let mut input = union_input();
        input.person_source_citation = Some("x".repeat(401));

        let err = put_person_union(&db, input).await.unwrap_err();

        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn put_person_union_resolves_lookups_and_upserts() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "person-1", "entity-1",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "person-2", "entity-2",
            )]])
            .append_query_results::<lookup_union_type::Model, Vec<lookup_union_type::Model>, _>([
                vec![union_type_model("ut-marriage", "MARRIAGE")],
            ])
            .append_query_results::<lookup_union_end_reason::Model, Vec<lookup_union_end_reason::Model>, _>([
                vec![lookup_union_end_reason::Model {
                    id: "uer-death".to_string(),
                    name: "DEATH".to_string(),
                }],
            ])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let result = put_person_union(&db, union_input())
            .await
            .expect("should upsert");

        assert_eq!(result.id, "union-1");
    }

    #[tokio::test]
    async fn delete_links_return_not_found_when_missing() {
        let parent_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                }])
                .into_connection(),
        );
        let union_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                }])
                .into_connection(),
        );

        assert!(matches!(
            delete_parent_child_link(&parent_db, "missing".to_string()).await,
            Err(ServiceError::NotFound(_))
        ));
        assert!(matches!(
            delete_person_union(&union_db, "missing".to_string()).await,
            Err(ServiceError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn find_persons_by_name_rejects_blank_name() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = find_persons_by_name(&db, "   ".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn find_persons_by_name_returns_matching_persons() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-1", "יעקב",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "person-1", "entity-1",
            )]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let results = find_persons_by_name(&db, "יעקב".to_string())
            .await
            .expect("should query");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entity_id, "entity-1");
        assert_eq!(results[0].person_id, "person-1");
        assert_eq!(results[0].display_name, "יעקב");
    }

    #[tokio::test]
    async fn find_persons_by_name_skips_entities_without_a_person_row() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-1", "יעקב",
            )]])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let results = find_persons_by_name(&db, "יעקב".to_string())
            .await
            .expect("should query");

        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn get_person_unions_rejects_blank_person_id() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = get_person_unions(&db, "  ".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn get_person_unions_resolves_other_party_display_name() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person_union::Model, Vec<person_union::Model>, _>([vec![
                union_model(
                    "union-1",
                    "yaakov",
                    "leah",
                    Some(1),
                    Some("בראשית כט"),
                    Some("בראשית כט טז"),
                ),
            ]])
            .append_query_results::<lookup_union_type::Model, Vec<lookup_union_type::Model>, _>([
                vec![union_type_model("ut-marriage", "MARRIAGE")],
            ])
            .append_query_results::<lookup_union_end_reason::Model, Vec<lookup_union_end_reason::Model>, _>([
                vec![lookup_union_end_reason::Model {
                    id: "uer-death".to_string(),
                    name: "DEATH".to_string(),
                }],
            ])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "leah",
                "entity-leah",
            )]])
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-leah",
                "לאה",
            )]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let unions = get_person_unions(&db, "yaakov".to_string())
            .await
            .expect("should query");

        assert_eq!(unions.len(), 1);
        assert_eq!(unions[0].id, "union-1");
        assert_eq!(unions[0].union_type, "MARRIAGE");
        assert_eq!(unions[0].start_date, Some(20000101));
        assert_eq!(unions[0].end_date, Some(20010101));
        assert_eq!(unions[0].end_reason.as_deref(), Some("DEATH"));
        assert_eq!(unions[0].alt_group_id.as_deref(), Some("alt-union"));
        assert_eq!(unions[0].other_person_id, "leah");
        assert_eq!(unions[0].other_display_name, "לאה");
        assert_eq!(unions[0].source_citation.as_deref(), Some("בראשית כט"));
        assert_eq!(
            unions[0].person_source_citation.as_deref(),
            Some("בראשית כט טז")
        );
    }

    #[tokio::test]
    async fn get_person_unions_surfaces_db_errors() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([sea_orm::DbErr::Custom("boom".to_string())])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = get_person_unions(&db, "yaakov".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }

    fn perek_model(id: i32, sefer_name: &str, perek: i32) -> perek::Model {
        perek::Model {
            id,
            perek_id: Some(id),
            sefer_id: Some(1),
            sefer_name: Some(sefer_name.to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(perek),
            perek_in_context: Some(perek),
            date: None,
            hebdate: None,
            tseit: None,
            header: None,
        }
    }

    fn entity_tanah_source_model(
        id: &str,
        entity_id: &str,
        perek_id: i32,
        pasuk_number: i32,
    ) -> entity_tanah_source::Model {
        entity_tanah_source::Model {
            id: id.to_string(),
            entity_id: entity_id.to_string(),
            perek_id,
            pasuk_number,
            segment_start: None,
            segment_end: None,
        }
    }

    fn parent_child_model(
        id: &str,
        parent_id: &str,
        child_id: &str,
        source_citation: Option<&str>,
    ) -> person_parent_child::Model {
        person_parent_child::Model {
            id: id.to_string(),
            parent_id: parent_id.to_string(),
            child_id: child_id.to_string(),
            relationship_type_id: "pct-biological".to_string(),
            parent_role_id: "pr-father".to_string(),
            alt_group_id: Some("alt-parent".to_string()),
            source_citation: source_citation.map(str::to_string),
        }
    }

    fn name_model(id: &str, person_id: &str, name: &str) -> person_name::Model {
        person_name::Model {
            id: id.to_string(),
            person_id: person_id.to_string(),
            name: name.to_string(),
            name_type_id: "nt-birth".to_string(),
            alt_group_id: None,
        }
    }

    #[tokio::test]
    async fn find_entities_rejects_blank_name() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = find_entities(&db, "  ".to_string(), None)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn find_entities_returns_matches_of_any_type() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity::Model {
                id: "entity-mizrayim".to_string(),
                entity_type: "PLACE".to_string(),
                name: "מצרים".to_string(),
                created_at: chrono::Utc::now().naive_utc(),
                updated_at: chrono::Utc::now().naive_utc(),
            }]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let results = find_entities(&db, "מצרים".to_string(), Some("place".to_string()))
            .await
            .expect("should query");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entity_id, "entity-mizrayim");
        assert_eq!(results[0].entity_type, "PLACE");
        assert_eq!(results[0].display_name, "מצרים");
    }

    #[tokio::test]
    async fn get_entity_tanah_sources_rejects_blank_entity_id() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = get_entity_tanah_sources(&db, "  ".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn get_entity_tanah_sources_formats_hebrew_citation() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entity_tanah_source::Model, Vec<entity_tanah_source::Model>, _>(
                [vec![entity_tanah_source_model(
                    "s-1",
                    "entity-bilhah",
                    30,
                    4,
                )]],
            )
            .append_query_results::<perek::Model, Vec<perek::Model>, _>([vec![perek_model(
                30,
                "בראשית",
                30,
            )]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let sources = get_entity_tanah_sources(&db, "entity-bilhah".to_string())
            .await
            .expect("should query");

        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].perek_id, 30);
        assert_eq!(sources[0].pasuk_number, 4);
        assert_eq!(sources[0].citation, "בראשית ל' ד'");
    }

    #[tokio::test]
    async fn get_person_parent_child_rejects_blank_person_id() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = get_person_parent_child(&db, "  ".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn get_person_parent_child_marks_queried_side_correctly() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person_parent_child::Model, Vec<person_parent_child::Model>, _>(
                [vec![parent_child_model(
                    "pc-1",
                    "yaakov",
                    "yosef",
                    Some("בראשית ל כד"),
                )]],
            )
            .append_query_results::<lookup_parent_child_type::Model, Vec<lookup_parent_child_type::Model>, _>(
                [vec![lookup_parent_child_type::Model {
                    id: "pct-biological".to_string(),
                    name: "BIOLOGICAL".to_string(),
                }]],
            )
            .append_query_results::<lookup_parent_role::Model, Vec<lookup_parent_role::Model>, _>([
                vec![lookup_parent_role::Model {
                    id: "pr-father".to_string(),
                    name: "FATHER".to_string(),
                }],
            ])
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "yosef",
                "entity-yosef",
            )]])
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-yosef",
                "יוסף",
            )]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let links = get_person_parent_child(&db, "yaakov".to_string())
            .await
            .expect("should query");

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].relationship_type, "BIOLOGICAL");
        assert_eq!(links[0].parent_role, "FATHER");
        assert_eq!(links[0].alt_group_id.as_deref(), Some("alt-parent"));
        assert!(links[0].queried_is_parent);
        assert_eq!(links[0].other_person_id, "yosef");
        assert_eq!(links[0].other_display_name, "יוסף");
    }

    #[tokio::test]
    async fn get_person_details_rejects_blank_person_id() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let err = get_person_details(&db, "  ".to_string()).await.unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn get_person_details_returns_not_found_for_missing_person() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let err = get_person_details(&db, "unknown".to_string())
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn get_person_details_aggregates_the_full_subgraph() {
        let mock_db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<person::Model, Vec<person::Model>, _>([vec![person_model(
                "bilhah",
                "entity-bilhah",
            )]])
            .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                "entity-bilhah",
                "בלהה",
            )]])
            .append_query_results::<person_name::Model, Vec<person_name::Model>, _>([vec![
                name_model("name-1", "bilhah", "בלהה"),
            ]])
            .append_query_results::<lookup_name_type::Model, Vec<lookup_name_type::Model>, _>([
                vec![lookup_name_type::Model {
                    id: "nt-birth".to_string(),
                    name: "BIRTH".to_string(),
                }],
            ])
            .append_query_results::<person_sex::Model, Vec<person_sex::Model>, _>([vec![
                person_sex::Model {
                    id: "sex-1".to_string(),
                    person_id: "bilhah".to_string(),
                    sex: "FEMALE".to_string(),
                    alt_group_id: None,
                },
            ]])
            .append_query_results::<person_birth_date::Model, Vec<person_birth_date::Model>, _>([
                vec![],
            ])
            .append_query_results::<person_death_date::Model, Vec<person_death_date::Model>, _>([
                vec![],
            ])
            .append_query_results::<person_death_cause::Model, Vec<person_death_cause::Model>, _>([
                vec![],
            ])
            .append_query_results::<person_birth_place::Model, Vec<person_birth_place::Model>, _>([
                vec![],
            ])
            .append_query_results::<entity_tanah_source::Model, Vec<entity_tanah_source::Model>, _>(
                [vec![entity_tanah_source_model(
                    "s-1",
                    "entity-bilhah",
                    30,
                    4,
                )]],
            )
            .append_query_results::<perek::Model, Vec<perek::Model>, _>([vec![perek_model(
                30,
                "בראשית",
                30,
            )]])
            .into_connection();
        let db = Database::from_connection(mock_db);

        let detail = get_person_details(&db, "bilhah".to_string())
            .await
            .expect("should query");

        assert_eq!(detail.entity_id, "entity-bilhah");
        assert_eq!(detail.person_id, "bilhah");
        assert_eq!(detail.display_name, "בלהה");
        assert_eq!(detail.names.len(), 1);
        assert_eq!(detail.names[0].name_type, "BIRTH");
        assert_eq!(detail.sexes, vec!["FEMALE".to_string()]);
        assert_eq!(detail.sex_rows.len(), 1);
        assert_eq!(detail.sex_rows[0].id, "sex-1");
        assert!(detail.birth_dates.is_empty());
        assert_eq!(detail.tanah_sources.len(), 1);
        assert_eq!(detail.tanah_sources[0].citation, "בראשית ל' ד'");
    }
}
