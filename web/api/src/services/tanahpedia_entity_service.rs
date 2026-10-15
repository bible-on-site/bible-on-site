//! Public read queries over entity-level Tanahpedia content — the family
//! relationships and place identifications the website renders on `/pedia`
//! entry pages. Everything here reads the live tables only and requires no
//! authentication (mirroring `tanahpedia_entries_service`).

use std::collections::HashMap;

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_entity::{
        TanahpediaFamilyChildEdge, TanahpediaFamilyParentEdge, TanahpediaFamilyRelatedPerson,
        TanahpediaFamilySibling, TanahpediaFamilySpouseEdge, TanahpediaPersonFamily,
        TanahpediaPlaceMarker,
    },
    providers::Database,
};
use sea_orm::{DatabaseBackend, FromQueryResult, Statement, Value};

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

/// First linked entry's canonical slug for an entity (display name link).
const SQL_FIRST_ENTRY_UNIQUE_NAME: &str =
    "(SELECT ent.unique_name FROM tanahpedia_entry_entity ee2
      INNER JOIN tanahpedia_entry ent ON ent.id = ee2.entry_id
      WHERE ee2.entity_id = REL.ALIAS.id
      ORDER BY ent.title LIMIT 1)";

/// First linked entry's title for an entity.
const SQL_FIRST_ENTRY_TITLE: &str =
    "(SELECT ent.title FROM tanahpedia_entry_entity ee2
      INNER JOIN tanahpedia_entry ent ON ent.id = ee2.entry_id
      WHERE ee2.entity_id = REL.ALIAS.id
      ORDER BY ent.title LIMIT 1)";

fn entry_unique_name_sql(alias: &str) -> String {
    SQL_FIRST_ENTRY_UNIQUE_NAME.replace("REL.ALIAS", alias)
}

fn entry_title_sql(alias: &str) -> String {
    SQL_FIRST_ENTRY_TITLE.replace("REL.ALIAS", alias)
}

#[derive(FromQueryResult)]
struct FocalPersonRow {
    person_id: String,
    display_name: String,
}

#[derive(FromQueryResult)]
struct SexRow {
    sex: Option<String>,
}

#[derive(FromQueryResult)]
struct BirthRow {
    birth_date: Option<i32>,
}

/// Builds the related-person half of a relationship row — the shared column
/// block every edge row carries (identity, display name, linked entry, sex).
macro_rules! related_person {
    ($row:expr) => {
        TanahpediaFamilyRelatedPerson {
            person_id: $row.related_person_id,
            entity_id: $row.related_entity_id,
            display_name: $row.display_name,
            entry_unique_name: $row.entry_unique_name,
            entry_title: $row.entry_title,
            sex: $row.related_sex,
        }
    };
}

#[derive(FromQueryResult)]
struct ParentEdgeRow {
    related_person_id: String,
    related_entity_id: String,
    display_name: String,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
    related_sex: Option<String>,
    alt_group_id: Option<String>,
    parent_role: String,
    relationship_type: String,
    source_citation: Option<String>,
}

#[derive(FromQueryResult)]
struct ChildEdgeRow {
    related_person_id: String,
    related_entity_id: String,
    display_name: String,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
    related_sex: Option<String>,
    alt_group_id: Option<String>,
    parent_role: String,
    relationship_type: String,
    source_citation: Option<String>,
    birth_order: Option<i32>,
    co_parent_entity_id: Option<String>,
    co_parent_display_name: Option<String>,
    co_parent_union_order: Option<i32>,
}

#[derive(FromQueryResult)]
struct SpouseEdgeRow {
    related_person_id: String,
    related_entity_id: String,
    display_name: String,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
    related_sex: Option<String>,
    alt_group_id: Option<String>,
    union_type: String,
    union_order: Option<i32>,
    source_citation: Option<String>,
    person_source_citation: Option<String>,
    union_end_reason: Option<String>,
    union_start_date: Option<i32>,
    union_end_date: Option<i32>,
}

#[derive(FromQueryResult)]
struct SiblingRow {
    related_person_id: String,
    related_entity_id: String,
    display_name: String,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
    related_sex: Option<String>,
    related_birth_date: Option<i32>,
    sibling_source_citation: Option<String>,
}

/// The related-person select columns shared by all relationship queries —
/// same shape as the website's `RelatedRow` (entity name, first linked entry,
/// non-alt sex).
fn related_columns(alias: &str, person_alias: &str) -> String {
    format!(
        "{person_alias}.id AS related_person_id,
         {alias}.id AS related_entity_id,
         {alias}.name AS display_name,
         {uq} AS entry_unique_name,
         {tq} AS entry_title,
         (SELECT sx.sex FROM tanahpedia_person_sex sx
          WHERE sx.person_id = {person_alias}.id AND sx.alt_group_id IS NULL LIMIT 1)
          AS related_sex",
        uq = entry_unique_name_sql(alias),
        tq = entry_title_sql(alias),
    )
}

/// Parents, children, unions and siblings of a `PERSON` entity — the
/// source-backed relationship surface shown on person entry pages. `None`
/// when the entity is not a person or has no family data at all.
pub async fn get_person_family(
    db: &Database,
    entity_id: &str,
) -> Result<Option<TanahpediaPersonFamily>, ServiceError> {
    tracing::info_span!("tanahpedia_entity_service::get_person_family", %entity_id);

    let focal_rows = FocalPersonRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT p.id AS person_id, e.name AS display_name
           FROM tanahpedia_person p
           JOIN tanahpedia_entity e ON e.id = p.entity_id
           WHERE p.entity_id = ? LIMIT 1"#,
        [entity_id.into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    let Some(focal) = focal_rows.into_iter().next() else {
        return Ok(None);
    };
    let person_id = focal.person_id;

    let sex_rows = SexRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        "SELECT sex FROM tanahpedia_person_sex WHERE person_id = ? LIMIT 1",
        [person_id.clone().into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    let focal_sex = sex_rows.into_iter().next().and_then(|row| row.sex);

    let parent_sql = format!(
        r#"SELECT {related},
              ppc.alt_group_id AS alt_group_id,
              pr.name AS parent_role, pct.name AS relationship_type,
              ppc.source_citation AS source_citation
           FROM tanahpedia_person_parent_child ppc
           INNER JOIN tanahpedia_person parent_p ON parent_p.id = ppc.parent_id
           INNER JOIN tanahpedia_entity parent_e ON parent_e.id = parent_p.entity_id
           INNER JOIN tanahpedia_lookup_parent_role pr ON pr.id = ppc.parent_role_id
           INNER JOIN tanahpedia_lookup_parent_child_type pct ON pct.id = ppc.relationship_type_id
           WHERE ppc.child_id = ?"#,
        related = related_columns("parent_e", "parent_p"),
    );

    let child_sql = format!(
        r#"SELECT {related},
              ppc.alt_group_id AS alt_group_id,
              pr.name AS parent_role, pct.name AS relationship_type,
              ppc.source_citation AS source_citation,
              ppc.birth_order AS birth_order,
              co_e.id AS co_parent_entity_id,
              co_e.name AS co_parent_display_name,
              (SELECT MIN(u2.union_order) FROM tanahpedia_person_union u2
               WHERE (u2.person1_id = ? AND u2.person2_id = ppc_co.parent_id)
                  OR (u2.person2_id = ? AND u2.person1_id = ppc_co.parent_id))
               AS co_parent_union_order
           FROM tanahpedia_person_parent_child ppc
           INNER JOIN tanahpedia_person child_p ON child_p.id = ppc.child_id
           INNER JOIN tanahpedia_entity child_e ON child_e.id = child_p.entity_id
           INNER JOIN tanahpedia_lookup_parent_role pr ON pr.id = ppc.parent_role_id
           INNER JOIN tanahpedia_lookup_parent_child_type pct ON pct.id = ppc.relationship_type_id
           LEFT JOIN tanahpedia_person_parent_child ppc_co
             ON ppc_co.child_id = ppc.child_id AND ppc_co.parent_id <> ppc.parent_id
           LEFT JOIN tanahpedia_person co_p ON co_p.id = ppc_co.parent_id
           LEFT JOIN tanahpedia_entity co_e ON co_e.id = co_p.entity_id
           WHERE ppc.parent_id = ?"#,
        related = related_columns("child_e", "child_p"),
    );

    let spouse_sql = format!(
        r#"SELECT {related},
              u.alt_group_id AS alt_group_id,
              ut.name AS union_type,
              u.union_order AS union_order,
              u.source_citation AS source_citation,
              u.person_source_citation AS person_source_citation,
              uer.name AS union_end_reason,
              u.start_date AS union_start_date,
              u.end_date AS union_end_date
           FROM tanahpedia_person_union u
           INNER JOIN tanahpedia_lookup_union_type ut ON ut.id = u.union_type_id
           LEFT JOIN tanahpedia_lookup_union_end_reason uer ON uer.id = u.end_reason_id
           INNER JOIN tanahpedia_person other_p
             ON other_p.id = IF(u.person1_id = ?, u.person2_id, u.person1_id)
           INNER JOIN tanahpedia_entity other_e ON other_e.id = other_p.entity_id
           WHERE u.person1_id = ? OR u.person2_id = ?"#,
        related = related_columns("other_e", "other_p"),
    );

    let sibling_sql = format!(
        r#"SELECT DISTINCT
              {related},
              (SELECT MIN(bd.birth_date) FROM tanahpedia_person_birth_date bd
               WHERE bd.person_id = other_p.id AND bd.alt_group_id IS NULL)
               AS related_birth_date,
              other_edge.source_citation AS sibling_source_citation
           FROM tanahpedia_person_parent_child my_edge
           INNER JOIN tanahpedia_person_parent_child other_edge
             ON other_edge.parent_id = my_edge.parent_id
            AND other_edge.child_id <> my_edge.child_id
           INNER JOIN tanahpedia_person other_p ON other_p.id = other_edge.child_id
           INNER JOIN tanahpedia_entity other_e ON other_e.id = other_p.entity_id
           WHERE my_edge.child_id = ? AND other_p.id <> ?"#,
        related = related_columns("other_e", "other_p"),
    );

    let focal_birth_sql = r#"SELECT MIN(birth_date) AS birth_date
        FROM tanahpedia_person_birth_date
        WHERE person_id = ? AND alt_group_id IS NULL"#;

    let (parent_rows, child_rows, spouse_rows, sibling_rows, focal_birth_rows) = tokio::try_join!(
        ParentEdgeRow::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            &parent_sql,
            [person_id.clone().into()],
        ))
        .all(db.get_connection()),
        ChildEdgeRow::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            &child_sql,
            [
                person_id.clone().into(),
                person_id.clone().into(),
                person_id.clone().into(),
            ],
        ))
        .all(db.get_connection()),
        SpouseEdgeRow::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            &spouse_sql,
            [
                person_id.clone().into(),
                person_id.clone().into(),
                person_id.clone().into(),
            ],
        ))
        .all(db.get_connection()),
        SiblingRow::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            &sibling_sql,
            [person_id.clone().into(), person_id.clone().into()],
        ))
        .all(db.get_connection()),
        BirthRow::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            focal_birth_sql,
            [person_id.clone().into()],
        ))
        .all(db.get_connection()),
    )
    .map_err(db_error)?;

    let parents: Vec<TanahpediaFamilyParentEdge> = parent_rows
        .into_iter()
        .map(|row| TanahpediaFamilyParentEdge {
            related: related_person!(row),
            parent_role: row.parent_role,
            relationship_type: row.relationship_type,
            alt_group_id: row.alt_group_id,
            source_citation: row.source_citation,
        })
        .collect();

    let children = dedupe_children(child_rows);

    let spouses: Vec<TanahpediaFamilySpouseEdge> = spouse_rows
        .into_iter()
        .map(|row| TanahpediaFamilySpouseEdge {
            related: related_person!(row),
            union_type: row.union_type,
            union_order: row.union_order,
            alt_group_id: row.alt_group_id,
            source_citation: row.source_citation,
            person_source_citation: row.person_source_citation,
            union_end_reason: row.union_end_reason,
            union_start_date: row.union_start_date,
            union_end_date: row.union_end_date,
        })
        .collect();

    let siblings = dedupe_siblings(sibling_rows);

    let focal_birth_yyyymmdd = focal_birth_rows
        .into_iter()
        .next()
        .and_then(|row| row.birth_date);

    if parents.is_empty() && children.is_empty() && spouses.is_empty() && siblings.is_empty() {
        return Ok(None);
    }

    Ok(Some(TanahpediaPersonFamily {
        focal_person_id: person_id,
        focal_entity_id: entity_id.to_string(),
        focal_display_name: focal.display_name,
        focal_sex,
        focal_birth_yyyymmdd,
        parents,
        children,
        spouses,
        siblings,
    }))
}

/// The co-parent LEFT JOIN produces one child row per co-parent edge; collapse
/// duplicates (same child + relationship + role + opinion group), preferring
/// the row that names a co-parent — same rule as the website.
fn dedupe_children(rows: Vec<ChildEdgeRow>) -> Vec<TanahpediaFamilyChildEdge> {
    let mut order: Vec<String> = Vec::new();
    let mut by_key: HashMap<String, TanahpediaFamilyChildEdge> = HashMap::new();
    for row in rows {
        let key = format!(
            "{}|{}|{}|{}",
            row.related_entity_id,
            row.relationship_type,
            row.parent_role,
            row.alt_group_id.clone().unwrap_or_default(),
        );
        let edge = TanahpediaFamilyChildEdge {
            related: related_person!(row),
            parent_role: row.parent_role,
            relationship_type: row.relationship_type,
            alt_group_id: row.alt_group_id,
            source_citation: row.source_citation,
            birth_order: row.birth_order,
            co_parent_entity_id: row.co_parent_entity_id,
            co_parent_display_name: row.co_parent_display_name,
            co_parent_union_order: row.co_parent_union_order,
        };
        match by_key.get(&key) {
            None => {
                order.push(key.clone());
                by_key.insert(key, edge);
            }
            Some(prev) if prev.co_parent_entity_id.is_none() && edge.co_parent_entity_id.is_some() => {
                by_key.insert(key, edge);
            }
            _ => {}
        }
    }
    order.into_iter()
        .filter_map(|key| by_key.remove(&key))
        .collect()
}

/// Siblings are DISTINCT in SQL but can still repeat through multiple shared
/// parent edges; keep one row per entity, preferring a citation-bearing row,
/// ordered by display name like the website.
fn dedupe_siblings(rows: Vec<SiblingRow>) -> Vec<TanahpediaFamilySibling> {
    let mut by_entity: HashMap<String, TanahpediaFamilySibling> = HashMap::new();
    for row in rows {
        let sibling = TanahpediaFamilySibling {
            related: related_person!(row),
            birth_date_yyyymmdd: row.related_birth_date,
            source_citation: normalized_citation(row.sibling_source_citation),
        };
        match by_entity.get_mut(&sibling.related.entity_id) {
            None => {
                by_entity.insert(sibling.related.entity_id.clone(), sibling);
            }
            Some(prev) => {
                if prev.source_citation.is_none() && sibling.source_citation.is_some() {
                    prev.source_citation = sibling.source_citation;
                }
                if prev.birth_date_yyyymmdd.is_none() && sibling.birth_date_yyyymmdd.is_some() {
                    prev.birth_date_yyyymmdd = sibling.birth_date_yyyymmdd;
                }
            }
        }
    }
    let mut siblings: Vec<TanahpediaFamilySibling> = by_entity.into_values().collect();
    siblings.sort_by(|a, b| a.related.display_name.cmp(&b.related.display_name));
    siblings
}

/// Blank citations mean "no source", same as NULL.
fn normalized_citation(citation: Option<String>) -> Option<String> {
    citation.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[derive(FromQueryResult)]
struct PlaceMarkerRow {
    place_id: String,
    place_name: String,
    modern_name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    entry_unique_name: Option<String>,
}

/// Place identification pins for the places map. `entry_id = None` returns
/// every identified place (the category map); a value scopes the pins to the
/// `PLACE` entities linked to that entry (the entry map) — same pairing as
/// the website's `getPlaceMapMarkers`/`getPlaceMapMarkersForEntry`.
pub async fn get_place_markers(
    db: &Database,
    entry_id: Option<&str>,
) -> Result<Vec<TanahpediaPlaceMarker>, ServiceError> {
    tracing::info_span!("tanahpedia_entity_service::get_place_markers", ?entry_id);

    let (sql, values): (String, Vec<Value>) = match entry_id {
        Some(entry_id) => (
            r#"SELECT pi.id AS place_id, e.name AS place_name,
                      pi.modern_name AS modern_name,
                      CAST(pi.latitude AS DOUBLE) AS latitude,
                      CAST(pi.longitude AS DOUBLE) AS longitude,
                      ent.unique_name AS entry_unique_name
               FROM tanahpedia_entry_entity ee
               INNER JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
               INNER JOIN tanahpedia_entity e ON e.id = ee.entity_id
               INNER JOIN tanahpedia_place p ON p.entity_id = e.id
               INNER JOIN tanahpedia_place_identification pi ON pi.place_id = p.id
               WHERE ee.entry_id = ?
                 AND e.entity_type = 'PLACE'
                 AND pi.latitude IS NOT NULL AND pi.longitude IS NOT NULL"#
                .to_string(),
            vec![entry_id.into()],
        ),
        None => (
            format!(
                r#"SELECT pi.id AS place_id, e.name AS place_name,
                      pi.modern_name AS modern_name,
                      CAST(pi.latitude AS DOUBLE) AS latitude,
                      CAST(pi.longitude AS DOUBLE) AS longitude,
                      {uq} AS entry_unique_name
                   FROM tanahpedia_place_identification pi
                   INNER JOIN tanahpedia_place p ON p.id = pi.place_id
                   INNER JOIN tanahpedia_entity e ON e.id = p.entity_id
                   WHERE pi.latitude IS NOT NULL AND pi.longitude IS NOT NULL"#,
                uq = entry_unique_name_sql("e"),
            ),
            Vec::new(),
        ),
    };

    let rows = PlaceMarkerRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        sql,
        values,
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            // Identifications missing usable coordinates are skipped, same as
            // the website's finite-coordinate check.
            Some(TanahpediaPlaceMarker {
                place_id: row.place_id,
                place_name: row.place_name,
                modern_name: row.modern_name,
                lat: row.latitude?,
                lng: row.longitude?,
                entry_unique_name: row.entry_unique_name,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    fn related_row(entity_id: &str, person_id: &str, name: &str) -> BTreeMap<String, Value> {
        mock_row([
            ("related_person_id", person_id.into()),
            ("related_entity_id", entity_id.into()),
            ("display_name", name.into()),
            ("entry_unique_name", Value::String(None)),
            ("entry_title", Value::String(None)),
            ("related_sex", Value::String(None)),
        ])
    }

    fn mock_db_with_error(message: &str) -> Database {
        Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom(message.to_string())])
                .into_connection(),
        )
    }

    #[tokio::test]
    async fn get_person_family_returns_none_for_unknown_entity() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );

        let family = get_person_family(&db, "entity-missing").await.unwrap();

        assert!(family.is_none());
    }

    #[tokio::test]
    async fn get_person_family_returns_none_without_any_edge() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("person_id", "p1".into()),
                        ("display_name", "שמשון".into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );

        let family = get_person_family(&db, "entity-1").await.unwrap();

        assert!(family.is_none());
    }

    #[tokio::test]
    async fn get_person_family_maps_parents_children_spouses_siblings() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // focal person
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("person_id", "p1".into()),
                        ("display_name", "יעקב".into()),
                    ])],
                ])
                // focal sex
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("sex", "MALE".into())])],
                ])
                // parents
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![{
                        let mut row = related_row("entity-father", "p-father", "יצחק");
                        row.insert("alt_group_id".into(), Value::String(None));
                        row.insert("parent_role".into(), "FATHER".into());
                        row.insert("relationship_type".into(), "BIOLOGICAL".into());
                        row.insert("source_citation".into(), "בראשית כה יט".into());
                        row
                    }],
                ])
                // children
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![{
                        let mut row = related_row("entity-son", "p-son", "יוסף");
                        row.insert("alt_group_id".into(), Value::String(None));
                        row.insert("parent_role".into(), "FATHER".into());
                        row.insert("relationship_type".into(), "BIOLOGICAL".into());
                        row.insert("source_citation".into(), Value::String(None));
                        row.insert("birth_order".into(), 11_i32.into());
                        row.insert("co_parent_entity_id".into(), "entity-rachel".into());
                        row.insert("co_parent_display_name".into(), "רחל".into());
                        row.insert("co_parent_union_order".into(), 2_i32.into());
                        row
                    }],
                ])
                // spouses
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![{
                        let mut row = related_row("entity-rachel", "p-rachel", "רחל");
                        row.insert("alt_group_id".into(), Value::String(None));
                        row.insert("union_type".into(), "MARRIAGE".into());
                        row.insert("union_order".into(), 2_i32.into());
                        row.insert("source_citation".into(), "בראשית כט לא".into());
                        row.insert("person_source_citation".into(), Value::String(None));
                        row.insert("union_end_reason".into(), "DEATH".into());
                        row.insert("union_start_date".into(), Value::Int(None));
                        row.insert("union_end_date".into(), Value::Int(None));
                        row
                    }],
                ])
                // siblings
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![{
                        let mut row = related_row("entity-esav", "p-esav", "עשו");
                        row.insert("related_birth_date".into(), Value::Int(None));
                        row.insert("sibling_source_citation".into(), "בראשית כה כה".into());
                        row
                    }],
                ])
                // focal birth date
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("birth_date", 21081215_i32.into())])],
                ])
                .into_connection(),
        );

        let family = get_person_family(&db, "entity-yaakov")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(family.focal_person_id, "p1");
        assert_eq!(family.focal_display_name, "יעקב");
        assert_eq!(family.focal_sex.as_deref(), Some("MALE"));
        assert_eq!(family.focal_birth_yyyymmdd, Some(21081215));
        assert_eq!(family.parents.len(), 1);
        assert_eq!(family.parents[0].related.display_name, "יצחק");
        assert_eq!(family.parents[0].parent_role, "FATHER");
        assert_eq!(
            family.parents[0].source_citation.as_deref(),
            Some("בראשית כה יט")
        );
        assert_eq!(family.children.len(), 1);
        assert_eq!(family.children[0].birth_order, Some(11));
        assert_eq!(
            family.children[0].co_parent_display_name.as_deref(),
            Some("רחל")
        );
        assert_eq!(family.spouses.len(), 1);
        assert_eq!(family.spouses[0].union_type, "MARRIAGE");
        assert_eq!(
            family.spouses[0].union_end_reason.as_deref(),
            Some("DEATH")
        );
        assert_eq!(family.siblings.len(), 1);
        assert_eq!(family.siblings[0].related.display_name, "עשו");
        assert_eq!(
            family.siblings[0].source_citation.as_deref(),
            Some("בראשית כה כה")
        );
    }

    #[tokio::test]
    async fn get_person_family_dedupes_children_preferring_co_parent() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("person_id", "p1".into()),
                        ("display_name", "יעקב".into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                // two rows for the same child edge — only the second names a
                // co-parent, so it wins
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        {
                            let mut row = related_row("entity-son", "p-son", "יוסף");
                            row.insert("alt_group_id".into(), Value::String(None));
                            row.insert("parent_role".into(), "FATHER".into());
                            row.insert("relationship_type".into(), "BIOLOGICAL".into());
                            row.insert("source_citation".into(), Value::String(None));
                            row.insert("birth_order".into(), Value::Int(None));
                            row.insert("co_parent_entity_id".into(), Value::String(None));
                            row.insert("co_parent_display_name".into(), Value::String(None));
                            row.insert("co_parent_union_order".into(), Value::Int(None));
                            row
                        },
                        {
                            let mut row = related_row("entity-son", "p-son", "יוסף");
                            row.insert("alt_group_id".into(), Value::String(None));
                            row.insert("parent_role".into(), "FATHER".into());
                            row.insert("relationship_type".into(), "BIOLOGICAL".into());
                            row.insert("source_citation".into(), Value::String(None));
                            row.insert("birth_order".into(), Value::Int(None));
                            row.insert("co_parent_entity_id".into(), "entity-rachel".into());
                            row.insert("co_parent_display_name".into(), "רחל".into());
                            row.insert("co_parent_union_order".into(), 2_i32.into());
                            row
                        },
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );

        let family = get_person_family(&db, "entity-yaakov")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(family.children.len(), 1);
        assert_eq!(
            family.children[0].co_parent_entity_id.as_deref(),
            Some("entity-rachel")
        );
    }

    #[tokio::test]
    async fn get_person_family_dedupes_siblings_preferring_citation() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("person_id", "p1".into()),
                        ("display_name", "יעקב".into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![{
                        let mut row = related_row("entity-rachel", "p-rachel", "רחל");
                        row.insert("alt_group_id".into(), Value::String(None));
                        row.insert("union_type".into(), "MARRIAGE".into());
                        row.insert("union_order".into(), 1_i32.into());
                        row.insert("source_citation".into(), Value::String(None));
                        row.insert("person_source_citation".into(), Value::String(None));
                        row.insert("union_end_reason".into(), Value::String(None));
                        row.insert("union_start_date".into(), Value::Int(None));
                        row.insert("union_end_date".into(), Value::Int(None));
                        row
                    }],
                ])
                // same sibling twice through two shared parents; the cited row wins
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        {
                            let mut row = related_row("entity-esav", "p-esav", "עשו");
                            row.insert("related_birth_date".into(), Value::Int(None));
                            row.insert("sibling_source_citation".into(), Value::String(None));
                            row
                        },
                        {
                            let mut row = related_row("entity-esav", "p-esav", "עשו");
                            row.insert("related_birth_date".into(), Value::Int(None));
                            row.insert("sibling_source_citation".into(), "בראשית כה כה".into());
                            row
                        },
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );

        let family = get_person_family(&db, "entity-yaakov")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(family.siblings.len(), 1);
        assert_eq!(
            family.siblings[0].source_citation.as_deref(),
            Some("בראשית כה כה")
        );
    }

    #[tokio::test]
    async fn get_person_family_propagates_db_errors() {
        let db = mock_db_with_error("Connection lost");

        let result = get_person_family(&db, "entity-1").await;

        assert!(matches!(result, Err(ServiceError::InternalServerError(_))));
    }

    #[tokio::test]
    async fn get_place_markers_returns_coordinate_rows() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("place_id", "pi-1".into()),
                            ("place_name", "ירושלים".into()),
                            ("modern_name", "Jerusalem".into()),
                            ("latitude", 31.778_f64.into()),
                            ("longitude", 35.235_f64.into()),
                            ("entry_unique_name", "ירושלים".into()),
                        ]),
                        // Missing coordinates are filtered out.
                        mock_row([
                            ("place_id", "pi-2".into()),
                            ("place_name", "שילה".into()),
                            ("modern_name", Value::String(None)),
                            ("latitude", Value::Double(None)),
                            ("longitude", 35.0_f64.into()),
                            ("entry_unique_name", Value::String(None)),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let markers = get_place_markers(&db, None).await.unwrap();

        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].place_name, "ירושלים");
        assert_eq!(markers[0].modern_name.as_deref(), Some("Jerusalem"));
        assert_eq!(markers[0].lat, 31.778);
        assert_eq!(
            markers[0].entry_unique_name.as_deref(),
            Some("ירושלים")
        );
    }

    #[tokio::test]
    async fn get_place_markers_propagates_db_errors() {
        let db = mock_db_with_error("Connection lost");

        let result = get_place_markers(&db, Some("entry-1")).await;

        assert!(matches!(result, Err(ServiceError::InternalServerError(_))));
    }
}
