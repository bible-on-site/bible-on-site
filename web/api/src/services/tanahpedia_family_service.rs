use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_family::{TanahpediaPersonSummary, TanahpediaPersonUnionSummary},
    providers::Database,
};
use entities::tanahpedia::{entity, lookup_union_type, person, person_union};
use sea_orm::{ColumnTrait, QueryFilter};
use sea_orm::{Condition, EntityTrait};

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
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

    let mut summaries = Vec::with_capacity(unions.len());
    for u in unions {
        let union_type = lookup_union_type::Entity::find_by_id(u.union_type_id.clone())
            .one(conn)
            .await
            .map_err(db_error)?
            .map(|row| row.name)
            .unwrap_or_default();

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
            source_citation: u.source_citation,
            person1_id: u.person1_id,
            person2_id: u.person2_id,
            other_person_id,
            other_display_name,
        });
    }

    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};

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
    ) -> person_union::Model {
        person_union::Model {
            id: id.to_string(),
            person1_id: person1_id.to_string(),
            person2_id: person2_id.to_string(),
            union_type_id: "ut-marriage".to_string(),
            union_order,
            start_date: None,
            end_date: None,
            end_reason_id: None,
            alt_group_id: None,
            source_citation: source_citation.map(str::to_string),
        }
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
                union_model("union-1", "yaakov", "leah", Some(1), Some("בראשית כט")),
            ]])
            .append_query_results::<lookup_union_type::Model, Vec<lookup_union_type::Model>, _>([
                vec![union_type_model("ut-marriage", "MARRIAGE")],
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
        assert_eq!(unions[0].other_person_id, "leah");
        assert_eq!(unions[0].other_display_name, "לאה");
        assert_eq!(unions[0].source_citation.as_deref(), Some("בראשית כט"));
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
}
