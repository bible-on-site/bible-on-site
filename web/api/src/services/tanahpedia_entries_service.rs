//! Public read queries over the published Tanahpedia content — the same data
//! the website serves under `/pedia`. Drafts and review states live in
//! `tanahpedia_entry_revision`, a separate admin workflow; everything here
//! reads the live tables only and requires no authentication.

use std::collections::HashMap;

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_entries::{
        TanahpediaCategoryCount, TanahpediaCategoryHomepage, TanahpediaEntityWithEntries,
        TanahpediaEntry, TanahpediaEntryDetail, TanahpediaEntryOccurrence, TanahpediaEntryStub,
        TanahpediaLinkedEntity, TanahpediaSynonymTarget,
    },
    providers::Database,
};
use entities::tanahpedia::{category_homepage, entry};
use sea_orm::{
    ColumnTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter, QueryOrder,
    QuerySelect, Statement,
};

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

fn to_entry(model: entry::Model) -> TanahpediaEntry {
    TanahpediaEntry {
        id: model.id,
        unique_name: model.unique_name,
        title: model.title,
        content: model.content,
        updated_at: model.updated_at.to_string(),
    }
}

/// Published entries ordered by title — the browse list.
pub async fn get_entries(
    db: &Database,
    limit: u64,
    offset: u64,
) -> Result<Vec<TanahpediaEntry>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_entries");
    entry::Entity::find()
        .order_by_asc(entry::Column::Title)
        .limit(limit)
        .offset(offset)
        .all(db.get_connection())
        .await
        .map(|rows| rows.into_iter().map(to_entry).collect())
        .map_err(db_error)
}

/// Entries most recently updated — the landing "עודכנו לאחרונה" section.
pub async fn get_recent_entries(
    db: &Database,
    limit: u64,
) -> Result<Vec<TanahpediaEntry>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_recent_entries");
    entry::Entity::find()
        .order_by_desc(entry::Column::UpdatedAt)
        .limit(limit)
        .all(db.get_connection())
        .await
        .map(|rows| rows.into_iter().map(to_entry).collect())
        .map_err(db_error)
}

#[derive(FromQueryResult)]
struct LinkedEntityRow {
    id: String,
    entity_id: String,
    entity_type: String,
    entity_name: String,
}

#[derive(FromQueryResult)]
struct OccurrenceRow {
    perek_id: i32,
    pasuk_number: i32,
    segment_start: Option<i32>,
    segment_end: Option<i32>,
}

/// Entry by its canonical `unique_name`, with linked entities and the Tanah
/// occurrences of those entities — a single round trip for the reader page.
pub async fn get_entry_detail(
    db: &Database,
    unique_name: &str,
) -> Result<Option<TanahpediaEntryDetail>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_entry_detail", %unique_name);
    let model = entry::Entity::find()
        .filter(entry::Column::UniqueName.eq(unique_name))
        .one(db.get_connection())
        .await
        .map_err(db_error)?;
    let Some(model) = model else {
        return Ok(None);
    };

    let entities = LinkedEntityRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT ee.id, ee.entity_id, e.entity_type, e.name AS entity_name
           FROM tanahpedia_entry_entity ee
           JOIN tanahpedia_entity e ON e.id = ee.entity_id
           WHERE ee.entry_id = ?"#,
        [model.id.clone().into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    let occurrences = OccurrenceRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT DISTINCT
              ets.perek_id, ets.pasuk_number, ets.segment_start, ets.segment_end
           FROM tanahpedia_entity_tanah_source ets
           JOIN tanahpedia_entry_entity ee ON ee.entity_id = ets.entity_id
           WHERE ee.entry_id = ?
           ORDER BY ets.perek_id, ets.pasuk_number, ets.segment_start, ets.segment_end"#,
        [model.id.clone().into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    Ok(Some(TanahpediaEntryDetail {
        id: model.id.clone(),
        unique_name: model.unique_name.clone(),
        title: model.title.clone(),
        content: model.content.clone(),
        updated_at: model.updated_at.to_string(),
        entities: entities
            .into_iter()
            .map(|row| TanahpediaLinkedEntity {
                id: row.id,
                entity_id: row.entity_id,
                entity_type: row.entity_type,
                entity_name: row.entity_name,
            })
            .collect(),
        occurrences: occurrences
            .into_iter()
            .map(|row| TanahpediaEntryOccurrence {
                perek_id: row.perek_id,
                pasuk_number: row.pasuk_number,
                segment_start: row.segment_start,
                segment_end: row.segment_end,
            })
            .collect(),
    }))
}

#[derive(FromQueryResult)]
struct SynonymTargetRow {
    entry_id: String,
    unique_name: String,
    title: String,
    label: Option<String>,
}

/// Entries a synonym can lead to. One result means a plain alias; several mean
/// the name is ambiguous and the reader has to choose. A labelled row wins so
/// a disambiguation label is never lost to the plain one (same rule as the
/// website).
pub async fn get_synonym_targets(
    db: &Database,
    name: &str,
) -> Result<Vec<TanahpediaSynonymTarget>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_synonym_targets", %name);
    let rows = SynonymTargetRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT e.id AS entry_id, e.unique_name, e.title, NULL AS label
           FROM tanahpedia_entry_synonym s
           JOIN tanahpedia_entry e ON e.id = s.entry_id
           WHERE s.name = ?
           UNION
           SELECT e.id AS entry_id, e.unique_name, e.title,
                  d.disambiguation_label AS label
           FROM tanahpedia_entry_synonym s
           JOIN tanahpedia_entry_synonym_disambiguation d ON d.synonym_id = s.id
           JOIN tanahpedia_entry e ON e.id = d.entry_id
           WHERE s.name = ?
           ORDER BY title"#,
        [name.into(), name.into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    let mut by_entry: HashMap<String, TanahpediaSynonymTarget> = HashMap::new();
    for row in rows {
        let labelled = row.label.is_some();
        match by_entry.get(&row.entry_id) {
            Some(current) if current.label.is_some() || !labelled => {}
            _ => {
                by_entry.insert(
                    row.entry_id.clone(),
                    TanahpediaSynonymTarget {
                        entry_id: row.entry_id,
                        unique_name: row.unique_name,
                        title: row.title,
                        label: row.label,
                    },
                );
            }
        }
    }
    let mut targets: Vec<TanahpediaSynonymTarget> = by_entry.into_values().collect();
    targets.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(targets)
}

#[derive(FromQueryResult)]
struct CategoryCountRow {
    category: String,
    cnt: i64,
}

#[derive(FromQueryResult)]
struct PlaceCountRow {
    c: i64,
}

/// Base entity types mirrored from the website taxonomy (`TANAH_SEFER` is a
/// website-level grouping that shares `SEFER` rows in the database today).
pub(crate) const ENTITY_TYPES: &[&str] = &[
    "PERSON",
    "PLACE",
    "EVENT",
    "WAR",
    "ANIMAL",
    "OBJECT",
    "TEMPLE_TOOL",
    "PLANT",
    "ASTRONOMICAL_OBJECT",
    "SAYING",
    "SEFER",
    "TANAH_SEFER",
    "PROPHECY",
    "NATION",
];
pub(crate) const PERSON_ROLE_CATEGORIES: &[&str] = &["PROPHET", "KING"];
pub(crate) const ANIMAL_KIND_CATEGORIES: &[&str] = &["BEHEMA", "CHAYA", "OF", "SHERETZ"];
pub(crate) const ANIMAL_PURITY_CATEGORIES: &[&str] = &["TAHOR", "TAMEH"];

/// Every taxonomy category key a client may scope by — base entity types,
/// person roles and animal classifications.
pub(crate) fn is_category_key(key: &str) -> bool {
    ENTITY_TYPES.contains(&key)
        || PERSON_ROLE_CATEGORIES.contains(&key)
        || is_animal_kind_category(key)
        || is_animal_purity_category(key)
}

pub(crate) fn is_animal_kind_category(key: &str) -> bool {
    ANIMAL_KIND_CATEGORIES.contains(&key)
}

pub(crate) fn is_animal_purity_category(key: &str) -> bool {
    ANIMAL_PURITY_CATEGORIES.contains(&key)
}

/// Number of published entries linked to every category key, zero-filled so
/// clients can render the full taxonomy (same counts as the website landing).
pub async fn get_category_counts(
    db: &Database,
) -> Result<Vec<TanahpediaCategoryCount>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_category_counts");

    let mut counts: HashMap<String, i64> = ENTITY_TYPES
        .iter()
        .chain(PERSON_ROLE_CATEGORIES.iter())
        .chain(ANIMAL_KIND_CATEGORIES.iter())
        .chain(ANIMAL_PURITY_CATEGORIES.iter())
        .map(|key| ((*key).to_string(), 0))
        .collect();

    let entity_rows = CategoryCountRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT e.entity_type AS category, COUNT(DISTINCT ee.entry_id) AS cnt
           FROM tanahpedia_entry_entity ee
           JOIN tanahpedia_entity e ON e.id = ee.entity_id
           GROUP BY e.entity_type"#,
        [],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    let role_rows = CategoryCountRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT 'PROPHET' AS category, COUNT(DISTINCT ee.entry_id) AS cnt
           FROM tanahpedia_person_role_prophet pr
           JOIN tanahpedia_person p ON p.id = pr.person_id
           JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id
           UNION ALL
           SELECT 'KING' AS category, COUNT(DISTINCT ee.entry_id) AS cnt
           FROM tanahpedia_person_role_king pk
           JOIN tanahpedia_person p ON p.id = pk.person_id
           JOIN tanahpedia_entry_entity ee ON ee.entity_id = p.entity_id"#,
        [],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    let animal_rows = CategoryCountRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT ak.kind AS category, COUNT(DISTINCT ee.entry_id) AS cnt
           FROM tanahpedia_animal_kind ak
           JOIN tanahpedia_animal a ON a.id = ak.animal_id
           JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
           GROUP BY ak.kind
           UNION ALL
           SELECT ap.purity AS category, COUNT(DISTINCT ee.entry_id) AS cnt
           FROM tanahpedia_animal_purity ap
           JOIN tanahpedia_animal a ON a.id = ap.animal_id
           JOIN tanahpedia_entry_entity ee ON ee.entity_id = a.entity_id
           GROUP BY ap.purity"#,
        [],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    for row in entity_rows.into_iter().chain(role_rows).chain(animal_rows) {
        counts.insert(row.category, row.cnt);
    }

    // Places without a linked entry still count as content on the website
    // (demo / partially populated state).
    let place_rows = PlaceCountRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        "SELECT COUNT(*) AS c FROM tanahpedia_place",
        [],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    let place_total = place_rows.first().map(|row| row.c).unwrap_or(0);
    if counts.get("PLACE").copied().unwrap_or(0) == 0 && place_total > 0 {
        counts.insert("PLACE".to_string(), place_total);
    }

    Ok(ENTITY_TYPES
        .iter()
        .chain(PERSON_ROLE_CATEGORIES.iter())
        .chain(ANIMAL_KIND_CATEGORIES.iter())
        .chain(ANIMAL_PURITY_CATEGORIES.iter())
        .map(|key| TanahpediaCategoryCount {
            category: (*key).to_string(),
            count: counts.get(*key).copied().unwrap_or(0) as i32,
        })
        .collect())
}

#[derive(FromQueryResult)]
struct EntityWithEntriesRow {
    entity_id: String,
    entity_name: String,
    entry_id: Option<String>,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
}

const SELECT_ENTITY_ENTRIES: &str = r#"SELECT e.id AS entity_id, e.name AS entity_name,
        ent.id AS entry_id, ent.unique_name AS entry_unique_name, ent.title AS entry_title
    FROM tanahpedia_entity e
    LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
    LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id"#;

fn group_entities(
    rows: Vec<EntityWithEntriesRow>,
    entity_type: &str,
) -> Vec<TanahpediaEntityWithEntries> {
    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, (String, Vec<TanahpediaEntryStub>)> = HashMap::new();
    for row in rows {
        let group = grouped.entry(row.entity_id.clone()).or_insert_with(|| {
            order.push(row.entity_id.clone());
            (row.entity_name.clone(), Vec::new())
        });
        if let (Some(id), Some(unique_name), Some(title)) =
            (row.entry_id, row.entry_unique_name, row.entry_title)
        {
            group.1.push(TanahpediaEntryStub {
                id,
                unique_name,
                title,
            });
        }
    }
    order
        .into_iter()
        .map(|entity_id| {
            let (entity_name, linked_entries) = grouped.remove(&entity_id).unwrap_or_default();
            TanahpediaEntityWithEntries {
                entity_id,
                entity_type: entity_type.to_string(),
                entity_name,
                linked_entries,
            }
        })
        .collect()
}

/// All entities of a base entity type with their linked entries.
async fn entities_with_entries(
    db: &Database,
    entity_type: &str,
) -> Result<Vec<TanahpediaEntityWithEntries>, ServiceError> {
    let rows = EntityWithEntriesRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        format!("{SELECT_ENTITY_ENTRIES} WHERE e.entity_type = ? ORDER BY e.name"),
        [entity_type.into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    Ok(group_entities(rows, entity_type))
}

/// Person entities carrying the `PROPHET`/`KING` role table row.
async fn entities_with_entries_by_role(
    db: &Database,
    role: &str,
) -> Result<Vec<TanahpediaEntityWithEntries>, ServiceError> {
    // The caller validates `sub` is a person role before dispatching here.
    let role_table = if role == "PROPHET" {
        "tanahpedia_person_role_prophet"
    } else {
        debug_assert_eq!(role, "KING", "role filter is validated by the caller");
        "tanahpedia_person_role_king"
    };
    let sql = format!(
        r#"SELECT e.id AS entity_id, e.name AS entity_name,
               ent.id AS entry_id, ent.unique_name AS entry_unique_name, ent.title AS entry_title
        FROM {role_table} r
        JOIN tanahpedia_person p ON p.id = r.person_id
        JOIN tanahpedia_entity e ON e.id = p.entity_id
        LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
        LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
        ORDER BY e.name"#
    );
    let rows = EntityWithEntriesRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        &sql,
        [],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    Ok(group_entities(rows, "PERSON"))
}

/// Animal entities filtered by kind (`BEHEMA`/`CHAYA`/`OF`/`SHERETZ`) or
/// purity (`TAHOR`/`TAMEH`).
async fn entities_with_entries_by_animal_classification(
    db: &Database,
    dimension: &str,
    value: &str,
) -> Result<Vec<TanahpediaEntityWithEntries>, ServiceError> {
    // The caller validates the subcategory dimension before dispatching here.
    let (table, column) = if dimension == "kind" {
        ("tanahpedia_animal_kind", "kind")
    } else {
        debug_assert_eq!(
            dimension, "purity",
            "classification dimension is validated by the caller"
        );
        ("tanahpedia_animal_purity", "purity")
    };
    let sql = format!(
        r#"SELECT e.id AS entity_id, e.name AS entity_name,
               ent.id AS entry_id, ent.unique_name AS entry_unique_name, ent.title AS entry_title
        FROM {table} ac
        JOIN tanahpedia_animal a ON a.id = ac.animal_id
        JOIN tanahpedia_entity e ON e.id = a.entity_id
        LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
        LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
        WHERE ac.{column} = ?
        ORDER BY e.name"#
    );
    let rows = EntityWithEntriesRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        &sql,
        [value.into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    Ok(group_entities(rows, "ANIMAL"))
}

/// Entities with linked entries for a category listing: either a base entity
/// type (`entity_type`, `sub = None`) or a subcategory (`PROPHET`, `KING`,
/// animal kinds and purities — `entity_type` then carries the parent type,
/// same as the website's resolution).
pub async fn get_entities_with_entries(
    db: &Database,
    entity_type: &str,
    sub: Option<&str>,
) -> Result<Vec<TanahpediaEntityWithEntries>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_entities_with_entries", %entity_type, ?sub);
    match sub {
        Some("PROPHET") | Some("KING") if entity_type == "PERSON" => {
            entities_with_entries_by_role(db, sub.unwrap_or_default()).await
        }
        Some(key) if entity_type == "ANIMAL" && is_animal_kind_category(key) => {
            entities_with_entries_by_animal_classification(db, "kind", key).await
        }
        Some(key) if entity_type == "ANIMAL" && is_animal_purity_category(key) => {
            entities_with_entries_by_animal_classification(db, "purity", key).await
        }
        Some(_) => Ok(Vec::new()),
        None => entities_with_entries(db, entity_type).await,
    }
}

/// Entities whose Hebrew-date anniversary falls today — the landing
/// "היום בתנ"ך" section. `month_day` is `legacy_month * 100 + day`
/// (legacy month: 1=Tishrei..5=Shevat, 6/13/14=Adar variants, 7=Nisan..12=Elul)
/// matching the `% 10000` suffix of the stored Hebrew date numbers — the same
/// anniversary rule as the website.
pub async fn get_today_entities(
    db: &Database,
    month_day: i32,
) -> Result<Vec<TanahpediaEntityWithEntries>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_today_entities", %month_day);
    let rows = TodayEntityRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT DISTINCT
             e.id AS entity_id, e.name AS entity_name, e.entity_type AS entity_type,
             ent.id AS entry_id, ent.unique_name AS entry_unique_name, ent.title AS entry_title
           FROM tanahpedia_entity e
           LEFT JOIN tanahpedia_entry_entity ee ON ee.entity_id = e.id
           LEFT JOIN tanahpedia_entry ent ON ent.id = ee.entry_id
           WHERE EXISTS (
             SELECT 1 FROM tanahpedia_event ev
             JOIN tanahpedia_event_date_range d ON d.event_id = ev.id
             WHERE ev.entity_id = e.id AND (
               (d.start_date > 0 AND d.start_date <> 99991229 AND d.start_date % 10000 = ?)
               OR (d.end_date > 0 AND d.end_date <> 99991229 AND d.end_date % 10000 = ?)
             )
           ) OR EXISTS (
             SELECT 1 FROM tanahpedia_saying s
             WHERE s.entity_id = e.id
               AND s.saying_date > 0 AND s.saying_date <> 99991229 AND s.saying_date % 10000 = ?
           ) OR EXISTS (
             SELECT 1 FROM tanahpedia_person p
             WHERE p.entity_id = e.id AND (
               EXISTS (
                 SELECT 1 FROM tanahpedia_person_birth_date d WHERE d.person_id = p.id
                 AND d.birth_date > 0 AND d.birth_date <> 99991229 AND d.birth_date % 10000 = ?
               ) OR EXISTS (
                 SELECT 1 FROM tanahpedia_person_death_date d WHERE d.person_id = p.id
                 AND d.death_date > 0 AND d.death_date <> 99991229 AND d.death_date % 10000 = ?
               ) OR EXISTS (
                 SELECT 1 FROM tanahpedia_person_union u
                 WHERE (u.person1_id = p.id OR u.person2_id = p.id) AND (
                   (u.start_date > 0 AND u.start_date <> 99991229 AND u.start_date % 10000 = ?)
                   OR (u.end_date > 0 AND u.end_date <> 99991229 AND u.end_date % 10000 = ?)
                 )
               )
             )
           )
           ORDER BY e.name, e.id, ent.title, ent.id"#,
        [
            month_day.into(),
            month_day.into(),
            month_day.into(),
            month_day.into(),
            month_day.into(),
            month_day.into(),
            month_day.into(),
        ],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;
    Ok(group_today_entities(rows))
}

#[derive(FromQueryResult)]
struct TodayEntityRow {
    entity_id: String,
    entity_name: String,
    entity_type: String,
    entry_id: Option<String>,
    entry_unique_name: Option<String>,
    entry_title: Option<String>,
}

fn group_today_entities(rows: Vec<TodayEntityRow>) -> Vec<TanahpediaEntityWithEntries> {
    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, (String, String, Vec<TanahpediaEntryStub>)> = HashMap::new();
    for row in rows {
        let group = grouped.entry(row.entity_id.clone()).or_insert_with(|| {
            order.push(row.entity_id.clone());
            (row.entity_name.clone(), row.entity_type.clone(), Vec::new())
        });
        if let (Some(id), Some(unique_name), Some(title)) =
            (row.entry_id, row.entry_unique_name, row.entry_title)
        {
            group.2.push(TanahpediaEntryStub {
                id,
                unique_name,
                title,
            });
        }
    }
    order
        .into_iter()
        .map(|entity_id| {
            let (entity_name, entity_type, linked_entries) =
                grouped.remove(&entity_id).unwrap_or_default();
            TanahpediaEntityWithEntries {
                entity_id,
                entity_type,
                entity_name,
                linked_entries,
            }
        })
        .collect()
}

/// Homepage configuration for a category, when one is configured.
pub async fn get_category_homepage(
    db: &Database,
    entity_type: &str,
) -> Result<Option<TanahpediaCategoryHomepage>, ServiceError> {
    tracing::info_span!("tanahpedia_entries_service::get_category_homepage", %entity_type);
    category_homepage::Entity::find()
        .filter(category_homepage::Column::EntityType.eq(entity_type))
        .one(db.get_connection())
        .await
        .map(|model| {
            model.map(|model| TanahpediaCategoryHomepage {
                entity_type: model.entity_type,
                layout_type: model.layout_type,
                content: model.content,
            })
        })
        .map_err(db_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, Value};
    use std::collections::BTreeMap;

    fn now() -> chrono::NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
    }

    fn entry_model(id: &str, unique_name: &str, title: &str) -> entry::Model {
        entry::Model {
            id: id.to_string(),
            unique_name: unique_name.to_string(),
            title: title.to_string(),
            content: Some(format!("<p>{title}</p>")),
            created_at: now(),
            updated_at: now(),
        }
    }

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    fn mock_db_with_error(message: &str) -> Database {
        Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom(message.to_string())])
                .into_connection(),
        )
    }

    #[tokio::test]
    async fn get_entries_returns_mapped_entries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![
                    entry_model("e1", "משה-רבנו", "משה רבנו"),
                    entry_model("e2", "אברהם-אבינו", "אברהם אבינו"),
                ]])
                .into_connection(),
        );

        let entries = get_entries(&db, 50, 0).await.unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].unique_name, "משה-רבנו");
        assert_eq!(entries[0].content.as_deref(), Some("<p>משה רבנו</p>"));
        assert_eq!(entries[1].title, "אברהם אבינו");
    }

    #[tokio::test]
    async fn get_entries_propagates_db_errors() {
        let db = mock_db_with_error("Connection lost");

        let result = get_entries(&db, 50, 0).await;

        assert!(matches!(result, Err(ServiceError::InternalServerError(_))));
    }

    #[tokio::test]
    async fn get_recent_entries_returns_entries() {
        let db =
            Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![
                        entry_model("e1", "שמשון", "שמשון"),
                    ]])
                    .into_connection(),
            );

        let entries = get_recent_entries(&db, 10).await.unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "שמשון");
    }

    #[tokio::test]
    async fn get_entry_detail_returns_none_for_unknown_name() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .into_connection(),
        );

        let detail = get_entry_detail(&db, "no-such-entry").await.unwrap();

        assert!(detail.is_none());
    }

    #[tokio::test]
    async fn get_entry_detail_joins_entities_and_occurrences() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "entry-1",
                    "שמשון",
                    "שמשון",
                )]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("id", "ee-1".into()),
                        ("entity_id", "entity-1".into()),
                        ("entity_type", "PERSON".into()),
                        ("entity_name", "שמשון".into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("perek_id", 250_i32.into()),
                        ("pasuk_number", 3_i32.into()),
                        ("segment_start", Value::Int(None)),
                        ("segment_end", Value::Int(None)),
                    ])],
                ])
                .into_connection(),
        );

        let detail = get_entry_detail(&db, "שמשון").await.unwrap().unwrap();

        assert_eq!(detail.id, "entry-1");
        assert_eq!(detail.entities.len(), 1);
        assert_eq!(detail.entities[0].entity_type, "PERSON");
        assert_eq!(detail.entities[0].entity_name, "שמשון");
        assert_eq!(detail.occurrences.len(), 1);
        assert_eq!(detail.occurrences[0].perek_id, 250);
        assert_eq!(detail.occurrences[0].pasuk_number, 3);
        assert_eq!(detail.occurrences[0].segment_start, None);
    }

    #[tokio::test]
    async fn get_synonym_targets_prefers_labelled_rows() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("entry_id", "entry-plain".into()),
                            ("unique_name", "דתן".into()),
                            ("title", "דתן".into()),
                            ("label", Value::String(None)),
                        ]),
                        mock_row([
                            ("entry_id", "entry-plain".into()),
                            ("unique_name", "דתן".into()),
                            ("title", "דתן".into()),
                            ("label", "דתן ואבירם".into()),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let targets = get_synonym_targets(&db, "דתן").await.unwrap();

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].label.as_deref(), Some("דתן ואבירם"));
    }

    #[tokio::test]
    async fn get_synonym_targets_returns_all_ambiguous_targets() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("entry_id", "e1".into()),
                            ("unique_name", "דתן".into()),
                            ("title", "דתן".into()),
                            ("label", Value::String(None)),
                        ]),
                        mock_row([
                            ("entry_id", "e2".into()),
                            ("unique_name", "דתן-ואבירם".into()),
                            ("title", "דתן ואבירם".into()),
                            ("label", Value::String(None)),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let targets = get_synonym_targets(&db, "דתן").await.unwrap();

        assert_eq!(targets.len(), 2);
    }

    #[tokio::test]
    async fn get_category_counts_merges_sources_and_zero_fills() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("category", "PERSON".into()),
                        ("cnt", 7_i64.into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("category", "KING".into()),
                        ("cnt", 3_i64.into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("c", 0_i64.into())])],
                ])
                .into_connection(),
        );

        let counts = get_category_counts(&db).await.unwrap();

        let get = |key: &str| {
            counts
                .iter()
                .find(|row| row.category == key)
                .map(|row| row.count)
        };
        assert_eq!(get("PERSON"), Some(7));
        assert_eq!(get("KING"), Some(3));
        assert_eq!(get("PLACE"), Some(0));
        assert_eq!(get("TAMEH"), Some(0));
        assert_eq!(counts.len(), ENTITY_TYPES.len() + 2 + 4 + 2);
    }

    #[tokio::test]
    async fn get_category_counts_falls_back_to_place_rows() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
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
                    vec![mock_row([("c", 4_i64.into())])],
                ])
                .into_connection(),
        );

        let counts = get_category_counts(&db).await.unwrap();

        let place = counts
            .iter()
            .find(|row| row.category == "PLACE")
            .map(|row| row.count);
        assert_eq!(place, Some(4));
    }

    #[tokio::test]
    async fn get_category_counts_ignores_place_fallback_when_entries_exist() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("category", "PLACE".into()),
                        ("cnt", 2_i64.into()),
                    ])],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([("c", 4_i64.into())])],
                ])
                .into_connection(),
        );

        let counts = get_category_counts(&db).await.unwrap();

        let place = counts
            .iter()
            .find(|row| row.category == "PLACE")
            .map(|row| row.count);
        assert_eq!(place, Some(2));
    }

    #[tokio::test]
    async fn get_entities_with_entries_groups_linked_entries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("entity_id", "entity-1".into()),
                            ("entity_name", "דתן".into()),
                            ("entry_id", "e1".into()),
                            ("entry_unique_name", "דתן".into()),
                            ("entry_title", "דתן".into()),
                        ]),
                        mock_row([
                            ("entity_id", "entity-1".into()),
                            ("entity_name", "דתן".into()),
                            ("entry_id", "e2".into()),
                            ("entry_unique_name", "דתן-ואבירם".into()),
                            ("entry_title", "דתן ואבירם".into()),
                        ]),
                        mock_row([
                            ("entity_id", "entity-2".into()),
                            ("entity_name", "אבירם".into()),
                            ("entry_id", Value::String(None)),
                            ("entry_unique_name", Value::String(None)),
                            ("entry_title", Value::String(None)),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let entities = get_entities_with_entries(&db, "PERSON", None)
            .await
            .unwrap();

        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].entity_name, "דתן");
        assert_eq!(entities[0].linked_entries.len(), 2);
        assert_eq!(entities[0].linked_entries[1].unique_name, "דתן-ואבירם");
        assert_eq!(entities[1].entity_name, "אבירם");
        assert!(entities[1].linked_entries.is_empty());
    }

    #[tokio::test]
    async fn get_entities_with_entries_routes_role_sub_to_person_table() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("entity_id", "entity-1".into()),
                        ("entity_name", "יְהוֹשֻׁעַ".into()),
                        ("entry_id", "e1".into()),
                        ("entry_unique_name", "יהושע-בן-נון".into()),
                        ("entry_title", "יהושע בן נון".into()),
                    ])],
                ])
                .into_connection(),
        );

        let entities = get_entities_with_entries(&db, "PERSON", Some("PROPHET"))
            .await
            .unwrap();

        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].entity_type, "PERSON");
        assert_eq!(entities[0].linked_entries.len(), 1);
    }

    #[tokio::test]
    async fn get_entities_with_entries_routes_animal_sub_to_classification() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("entity_id", "entity-1".into()),
                        ("entity_name", "ארי".into()),
                        ("entry_id", Value::String(None)),
                        ("entry_unique_name", Value::String(None)),
                        ("entry_title", Value::String(None)),
                    ])],
                ])
                .into_connection(),
        );

        let entities = get_entities_with_entries(&db, "ANIMAL", Some("CHAYA"))
            .await
            .unwrap();

        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].entity_type, "ANIMAL");
        assert!(entities[0].linked_entries.is_empty());
    }

    #[tokio::test]
    async fn get_entities_with_entries_routes_king_sub_to_role_table() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("entity_id", "entity-1".into()),
                        ("entity_name", "דָּוִד".into()),
                        ("entry_id", "e1".into()),
                        ("entry_unique_name", "דוד".into()),
                        ("entry_title", "דוד המלך".into()),
                    ])],
                ])
                .into_connection(),
        );

        let entities = get_entities_with_entries(&db, "PERSON", Some("KING"))
            .await
            .unwrap();

        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].entity_type, "PERSON");
        assert_eq!(entities[0].entity_name, "דָּוִד");
        assert_eq!(entities[0].linked_entries.len(), 1);
    }

    #[tokio::test]
    async fn get_entities_with_entries_routes_purity_sub_to_classification() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("entity_id", "entity-1".into()),
                        ("entity_name", "שׁוֹר".into()),
                        ("entry_id", Value::String(None)),
                        ("entry_unique_name", Value::String(None)),
                        ("entry_title", Value::String(None)),
                    ])],
                ])
                .into_connection(),
        );

        let entities = get_entities_with_entries(&db, "ANIMAL", Some("TAHOR"))
            .await
            .unwrap();

        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].entity_type, "ANIMAL");
        assert_eq!(entities[0].entity_name, "שׁוֹר");
        assert!(entities[0].linked_entries.is_empty());
    }

    #[tokio::test]
    async fn get_entities_with_entries_returns_empty_for_unknown_sub() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let entities = get_entities_with_entries(&db, "PERSON", Some("BOGUS"))
            .await
            .unwrap();

        assert!(entities.is_empty());
    }

    #[tokio::test]
    async fn get_today_entities_groups_entries_per_entity() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([
                            ("entity_id", "entity-1".into()),
                            ("entity_name", "מתתיהו".into()),
                            ("entity_type", "PERSON".into()),
                            ("entry_id", "e1".into()),
                            ("entry_unique_name", "מתתיהו-החשמונאי".into()),
                            ("entry_title", "מתתיהו החשמונאי".into()),
                        ]),
                        mock_row([
                            ("entity_id", "entity-2".into()),
                            ("entity_name", "חנוכה".into()),
                            ("entity_type", "EVENT".into()),
                            ("entry_id", Value::String(None)),
                            ("entry_unique_name", Value::String(None)),
                            ("entry_title", Value::String(None)),
                        ]),
                    ],
                ])
                .into_connection(),
        );

        let entities = get_today_entities(&db, 925).await.unwrap();

        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].entity_type, "PERSON");
        assert_eq!(entities[0].linked_entries.len(), 1);
        assert_eq!(entities[0].linked_entries[0].unique_name, "מתתיהו-החשמונאי");
        assert_eq!(entities[1].entity_type, "EVENT");
        assert!(entities[1].linked_entries.is_empty());
    }

    #[tokio::test]
    async fn get_category_homepage_returns_none_when_unconfigured() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<category_homepage::Model, Vec<category_homepage::Model>, _>(
                    [vec![]],
                )
                .into_connection(),
        );

        let homepage = get_category_homepage(&db, "PLACE").await.unwrap();

        assert!(homepage.is_none());
    }

    #[tokio::test]
    async fn get_category_homepage_returns_configured_page() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<category_homepage::Model, Vec<category_homepage::Model>, _>(
                    [vec![category_homepage::Model {
                        id: "hp-1".to_string(),
                        entity_type: "PLACE".to_string(),
                        layout_type: "MAP".to_string(),
                        config: None,
                        content: Some("<p>מפת המקומות</p>".to_string()),
                        updated_at: now(),
                    }]],
                )
                .into_connection(),
        );

        let homepage = get_category_homepage(&db, "PLACE").await.unwrap().unwrap();

        assert_eq!(homepage.layout_type, "MAP");
        assert_eq!(homepage.content.as_deref(), Some("<p>מפת המקומות</p>"));
    }
}
