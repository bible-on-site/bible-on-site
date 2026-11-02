//! Authorized management of an entry's public address names — the aliases
//! stored in `tanahpedia_entry_synonym` (+ per-target distinguishing labels in
//! `tanahpedia_entry_synonym_disambiguation`). This is the API counterpart of
//! the admin server's `tanahpedia/aliases.ts` and preserves its write model:
//!
//! - a name with one distinct target is a plain alias (redirect); several make
//!   it a disambiguation page whose per-target text is the label row;
//! - each (name, entry) association is one synonym row, plus a label row under
//!   its own synonym row while the name is shared;
//! - a canonical `unique_name` always wins over alias rows of the same name;
//! - every write is one transaction (a name can never be left half-linked),
//!   and commits invalidate the website's cached pedia pages.

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::{
    common::{
        error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
        website_revalidate::WebsiteRevalidator,
    },
    dtos::{
        tanahpedia_aliases::{
            SaveTanahpediaAliasInput, TanahpediaAliasRemovalResult, TanahpediaAliasSaveResult,
            TanahpediaAliasTargetInput, TanahpediaEntryAlias, TanahpediaNameStatus,
        },
        tanahpedia_entries::{TanahpediaEntryStub, TanahpediaSynonymTarget},
    },
    providers::Database,
};
use entities::tanahpedia::{entry, entry_synonym, entry_synonym_disambiguation};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult,
    IntoActiveModel, QueryFilter, QuerySelect, Statement, TransactionTrait,
};
use unicode_normalization::UnicodeNormalization;

const PEDIA_NAME_MAX_LEN: usize = 255;

/// Category keys with the Hebrew route slug (`category-slug.ts` CATEGORY_SLUGS)
/// and the admin label (CATEGORY_LABELS) — both resolve to a category route.
const PEDIA_CATEGORIES: [(&str, &str, &str); 22] = [
    ("PERSON", "אישים", "אישים"),
    ("PLACE", "מקומות", "מקומות"),
    ("EVENT", "אירועים", "אירועים"),
    ("WAR", "מלחמות", "מלחמות"),
    ("ANIMAL", "בעלי-חיים", "בעלי חיים"),
    ("OBJECT", "חפצים", "חפצים"),
    ("TEMPLE_TOOL", "כלי-מקדש", "כלי מקדש"),
    ("PLANT", "צמחים", "צמחים"),
    ("ASTRONOMICAL_OBJECT", "גרמי-שמיים", "גרמי שמיים"),
    ("SAYING", "אמרות", "אמרות"),
    ("SEFER", "ספרים", "ספרים"),
    ("TANAH_SEFER", "ספרי-תנך", "ספרי תנ\"ך"),
    ("PROPHECY", "נבואות", "נבואות"),
    ("NATION", "עמים", "עמים"),
    ("PROPHET", "נביאים", "נביאים"),
    ("KING", "מלכים", "מלכים"),
    ("BEHEMA", "בהמות", "בהמות"),
    ("CHAYA", "חיות", "חיות"),
    ("OF", "עופות", "עופות"),
    ("SHERETZ", "שרצים", "שרצים"),
    ("TAHOR", "טהורים", "טהורים"),
    ("TAMEH", "טמאים", "טמאים"),
];

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

fn decode_uri_component(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .unwrap_or_else(|_| value.to_string())
}

/// Canonical stored form of an address name — what the public router looks
/// up. URL-decodes pasted input defensively, then NFC + trim, matching the
/// website's `normalizedUniqueNameFromParam` so existing names never
/// double-encode.
fn normalize_pedia_name(raw: &str) -> String {
    decode_uri_component(raw.trim())
        .nfc()
        .collect::<String>()
        .trim()
        .to_string()
}

/// Mirrors `normalizeSlug` in the website's category-slug.ts: category routes
/// win over entry names, so an entry/alias name colliding with a category slug
/// is unreachable and must be rejected.
fn normalize_slug_like_category(raw: &str) -> String {
    decode_uri_component(raw.trim())
        .nfc()
        .collect::<String>()
        .to_lowercase()
        .split(|c: char| c.is_whitespace() || c == '_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Reserved `/pedia/<slug>` values (normalized): the Hebrew category slugs
/// plus the legacy English category keys.
static RESERVED_SLUGS: LazyLock<HashMap<String, &'static str>> = LazyLock::new(|| {
    PEDIA_CATEGORIES
        .iter()
        .flat_map(|(key, slug, label)| {
            [
                (normalize_slug_like_category(slug), *label),
                (normalize_slug_like_category(key), *label),
            ]
        })
        .collect()
});

/// The category label when the name collides with a category route (which wins
/// over any entry/alias of the same name), else `None`.
fn reserved_category_label_for(name: &str) -> Option<&'static str> {
    RESERVED_SLUGS
        .get(&normalize_slug_like_category(name))
        .copied()
}

/// Public behavior of a name with the given number of targets.
fn alias_kind_for_target_count(count: usize) -> String {
    if count > 1 {
        "disambiguation".to_string()
    } else {
        "alias".to_string()
    }
}

/// Dedupe by entry: the first occurrence wins position, and a later non-empty
/// label fills an empty one so repeated picks never lose typed text. Labels
/// are trimmed; an empty label normalizes to `None`.
fn dedupe_alias_targets(
    targets: Vec<TanahpediaAliasTargetInput>,
) -> Vec<TanahpediaAliasTargetInput> {
    let mut deduped: Vec<TanahpediaAliasTargetInput> = Vec::new();
    for target in targets {
        let label = target
            .label
            .map(|label| label.trim().to_string())
            .filter(|label| !label.is_empty());
        match deduped.iter_mut().find(|t| t.entry_id == target.entry_id) {
            Some(existing) => {
                if existing.label.is_none() {
                    existing.label = label;
                }
            }
            None => deduped.push(TanahpediaAliasTargetInput {
                entry_id: target.entry_id,
                label,
            }),
        }
    }
    deduped
}

/// Order-insensitive multiset comparison of an alias name's target set — the
/// baseline a client opened with vs the set the server holds at save time.
/// Labels compare after the same normalization saves apply (null → "", trim).
fn same_alias_target_set(
    current: &[TanahpediaSynonymTarget],
    expected: &[TanahpediaAliasTargetInput],
) -> bool {
    let key = |entry_id: &str, label: Option<&str>| {
        format!("{} {}", entry_id, label.unwrap_or("").trim())
    };
    let mut a: Vec<String> = current
        .iter()
        .map(|t| key(&t.entry_id, t.label.as_deref()))
        .collect();
    let mut b: Vec<String> = expected
        .iter()
        .map(|t| key(&t.entry_id, t.label.as_deref()))
        .collect();
    a.sort();
    b.sort();
    a == b
}

/// Hebrew validation of an alias-name spec before save: non-empty legal name,
/// at least one distinct target, and a distinguishing label on every target
/// when the name is shared (that label is what the public disambiguation page
/// shows under each entry title).
fn validate_alias_spec(
    name: &str,
    targets: &[TanahpediaAliasTargetInput],
) -> Result<(), ServiceError> {
    if name.is_empty() {
        return Err(ServiceError::bad_request("שם הכתובת חייב להיות מלא"));
    }
    if name.contains('/') {
        return Err(ServiceError::bad_request("שם הכתובת אינו יכול להכיל '/'"));
    }
    if name.chars().count() > PEDIA_NAME_MAX_LEN {
        return Err(ServiceError::bad_request(
            "שם הכתובת ארוך מדי (עד 255 תווים)",
        ));
    }
    if targets.is_empty() {
        return Err(ServiceError::bad_request("יש לצרף לפחות ערך יעד אחד"));
    }
    if targets.len() > 1 {
        for target in targets {
            if target.label.is_none() {
                return Err(ServiceError::bad_request(
                    "כשהשם משותף בין כמה ערכים, לכל ערך נדרשת תווית מבדנת שתופיע בדף הפירושונים",
                ));
            }
        }
    }
    for target in targets {
        if target
            .label
            .as_deref()
            .is_some_and(|label| label.chars().count() > PEDIA_NAME_MAX_LEN)
        {
            return Err(ServiceError::bad_request(
                "תווית מבדנת ארוכה מדי (עד 255 תווים)",
            ));
        }
    }
    Ok(())
}

#[derive(FromQueryResult)]
struct AliasTargetRow {
    entry_id: String,
    unique_name: String,
    title: String,
    label: Option<String>,
}

/// The same target set the public resolver computes for a name. A labelled
/// row wins dedupe so a disambiguation label is never lost to a plain one.
async fn load_alias_targets<C: ConnectionTrait>(
    conn: &C,
    name: &str,
) -> Result<Vec<TanahpediaSynonymTarget>, ServiceError> {
    let rows = AliasTargetRow::find_by_statement(Statement::from_sql_and_values(
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
    .all(conn)
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
struct AliasNameRow {
    name: String,
}

#[derive(FromQueryResult)]
struct EntryNameRow {
    unique_name: String,
}

/// Locks the name's existing rows for update so concurrent writers serialize.
/// `name` has no index, so under MySQL's default REPEATABLE READ the locking
/// scan next-key-locks the whole table — first writes of the same name
/// serialize too, and the expectedTargets check that follows sees the
/// just-committed winner's rows (locking reads bypass the snapshot). Under
/// READ COMMITTED only existing rows lock; a racing first save then merges
/// rows, which the target-dedupe reads still resolve consistently, and the
/// stale-baseline check catches what the lock could not.
async fn lock_alias_name<C: ConnectionTrait>(conn: &C, name: &str) -> Result<(), ServiceError> {
    entry_synonym::Entity::find()
        .filter(entry_synonym::Column::Name.eq(name))
        .lock_exclusive()
        .all(conn)
        .await
        .map_err(db_error)?;
    Ok(())
}

async fn canonical_holder<C: ConnectionTrait>(
    conn: &C,
    name: &str,
) -> Result<Option<entry::Model>, ServiceError> {
    entry::Entity::find()
        .filter(entry::Column::UniqueName.eq(name))
        .one(conn)
        .await
        .map_err(db_error)
}

fn to_entry_stub(model: &entry::Model) -> TanahpediaEntryStub {
    TanahpediaEntryStub {
        id: model.id.clone(),
        unique_name: model.unique_name.clone(),
        title: model.title.clone(),
    }
}

/// Alias/disambiguation names this entry is a target of, with the same
/// management context the admin editor shows.
pub async fn get_entry_aliases(
    db: &Database,
    entry_id: &str,
) -> Result<Vec<TanahpediaEntryAlias>, ServiceError> {
    tracing::info_span!("tanahpedia_aliases_service::get_entry_aliases", %entry_id);
    let names = AliasNameRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        r#"SELECT DISTINCT name FROM (
             SELECT s.name AS name FROM tanahpedia_entry_synonym s WHERE s.entry_id = ?
             UNION
             SELECT s2.name AS name
               FROM tanahpedia_entry_synonym_disambiguation d
               JOIN tanahpedia_entry_synonym s2 ON s2.id = d.synonym_id
              WHERE d.entry_id = ?
           ) names
           ORDER BY name"#,
        [entry_id.into(), entry_id.into()],
    ))
    .all(db.get_connection())
    .await
    .map_err(db_error)?;

    let mut views = Vec::with_capacity(names.len());
    for row in names {
        let targets = load_alias_targets(db.get_connection(), &row.name).await?;
        let holder = canonical_holder(db.get_connection(), &row.name).await?;
        let is_self_main = holder.as_ref().is_some_and(|holder| holder.id == entry_id);
        let shadowed = holder.filter(|holder| holder.id != entry_id);
        views.push(TanahpediaEntryAlias {
            name: row.name.clone(),
            kind: alias_kind_for_target_count(targets.len()),
            targets,
            shadowed_by_canonical: shadowed.as_ref().map(to_entry_stub),
            is_self_main,
            reserved_category: reserved_category_label_for(&row.name).map(str::to_string),
        });
    }
    Ok(views)
}

/// Live status of a candidate address name — the API counterpart of the admin
/// editor's `checkPediaName`, so an authorized client can evaluate a name
/// before writing it.
pub async fn get_name_status(
    db: &Database,
    raw_name: &str,
    for_entry_id: Option<&str>,
) -> Result<TanahpediaNameStatus, ServiceError> {
    tracing::info_span!("tanahpedia_aliases_service::get_name_status", %raw_name);
    let name = normalize_pedia_name(raw_name);
    let invalid = |reason: &str| {
        Ok(TanahpediaNameStatus {
            kind: "invalid".to_string(),
            name: name.clone(),
            reason: Some(reason.to_string()),
            category_label: None,
            entry: None,
            alias_targets: vec![],
        })
    };
    if name.is_empty() {
        return invalid("שם הכתובת חייב להיות מלא");
    }
    if name.contains('/') {
        return invalid("שם הכתובת אינו יכול להכיל '/'");
    }
    if name.chars().count() > PEDIA_NAME_MAX_LEN {
        return invalid("שם הכתובת ארוך מדי (עד 255 תווים)");
    }
    if let Some(label) = reserved_category_label_for(&name) {
        return Ok(TanahpediaNameStatus {
            kind: "reserved".to_string(),
            name,
            reason: None,
            category_label: Some(label.to_string()),
            entry: None,
            alias_targets: vec![],
        });
    }

    if let Some(holder) = canonical_holder(db.get_connection(), &name).await? {
        let alias_targets = load_alias_targets(db.get_connection(), &name).await?;
        let self_main = for_entry_id == Some(holder.id.as_str());
        return Ok(TanahpediaNameStatus {
            kind: if self_main {
                "self-main".to_string()
            } else {
                "canonical".to_string()
            },
            name,
            reason: None,
            category_label: None,
            entry: (!self_main).then(|| to_entry_stub(&holder)),
            alias_targets,
        });
    }

    let targets = load_alias_targets(db.get_connection(), &name).await?;
    let kind = if targets.is_empty() { "free" } else { "alias" };
    Ok(TanahpediaNameStatus {
        kind: kind.to_string(),
        name,
        reason: None,
        category_label: None,
        entry: None,
        alias_targets: targets,
    })
}

/// Replaces the whole target set of a name atomically — one target makes it a
/// plain alias, several make it a disambiguation page (labels required).
/// `input.expected_targets` is the snapshot the client's edit was based on: a
/// name that drifted under it is rejected as a conflict instead of silently
/// overwriting another writer's edit.
pub async fn save_alias(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    input: SaveTanahpediaAliasInput,
) -> Result<TanahpediaAliasSaveResult, ServiceError> {
    tracing::info_span!("tanahpedia_aliases_service::save_alias", name = %input.name);
    let name = normalize_pedia_name(&input.name);
    let targets = dedupe_alias_targets(input.targets);
    validate_alias_spec(&name, &targets)?;
    if let Some(reserved) = reserved_category_label_for(&name) {
        return Err(ServiceError::bad_request(&format!(
            "השם «{name}» שמור לנתיב הקטגוריה «{reserved}» - בחר שם אחר"
        )));
    }

    let transaction = db.get_connection().begin().await.map_err(db_error)?;
    lock_alias_name(&transaction, &name).await?;
    if let Some(holder) = canonical_holder(&transaction, &name).await? {
        return Err(ServiceError::bad_request(&format!(
            "השם «{name}» הוא הכתובת הראשית של הערך «{}» - שנה תחילה את הכתובת הראשית של אותו ערך",
            holder.title
        )));
    }
    // Compare while holding the name lock: any concurrent writer who slipped
    // in first is visible here (locking reads see the latest committed rows),
    // so a stale client never replaces what it never saw.
    let current = load_alias_targets(&transaction, &name).await?;
    if !same_alias_target_set(&current, &input.expected_targets) {
        return Err(ServiceError::bad_request(&format!(
            "the name \"{name}\" was changed by another admin since this edit opened - close the editor and reopen it to see the current state"
        )));
    }
    let target_ids: Vec<String> = targets.iter().map(|t| t.entry_id.clone()).collect();
    let existing = entry::Entity::find()
        .select_only()
        .column(entry::Column::UniqueName)
        .filter(entry::Column::Id.is_in(target_ids))
        .into_model::<EntryNameRow>()
        .all(&transaction)
        .await
        .map_err(db_error)?;
    if existing.len() != targets.len() {
        return Err(ServiceError::bad_request(
            "אחד היעדים אינו ערך קיים - רענן ונסה שוב",
        ));
    }

    // Replace-in-transaction: old rows (and their label rows, via FK cascade)
    // go, the new symmetric model lands in the same commit.
    entry_synonym::Entity::delete_many()
        .filter(entry_synonym::Column::Name.eq(name.as_str()))
        .exec(&transaction)
        .await
        .map_err(db_error)?;
    let shared = targets.len() > 1;
    for target in &targets {
        let synonym_id = uuid::Uuid::new_v4().to_string();
        entry_synonym::Entity::insert(
            entry_synonym::Model {
                id: synonym_id.clone(),
                name: name.clone(),
                entry_id: target.entry_id.clone(),
            }
            .into_active_model(),
        )
        .exec(&transaction)
        .await
        .map_err(db_error)?;
        if shared {
            entry_synonym_disambiguation::Entity::insert(
                entry_synonym_disambiguation::Model {
                    id: uuid::Uuid::new_v4().to_string(),
                    synonym_id: synonym_id.clone(),
                    entry_id: target.entry_id.clone(),
                    disambiguation_label: target.label.clone().unwrap_or_default(),
                }
                .into_active_model(),
            )
            .exec(&transaction)
            .await
            .map_err(db_error)?;
        }
    }
    transaction.commit().await.map_err(db_error)?;

    // Entries whose alias membership changed include the ones that lost the
    // name, not only the new targets — their pages render the same alias lists.
    let mut names = vec![name.clone()];
    names.extend(current.iter().map(|t| t.unique_name.clone()));
    names.extend(existing.iter().map(|row| row.unique_name.clone()));
    names.sort_unstable();
    names.dedup();
    let revalidation = revalidator.invalidate_pedia_names(&names).await;

    Ok(TanahpediaAliasSaveResult {
        name: name.clone(),
        kind: alias_kind_for_target_count(targets.len()),
        target_count: targets.len() as i32,
        revalidation: revalidation.as_str().to_string(),
    })
}

/// Removes one entry's association from a name — other entries' associations
/// are never touched. When a single target remains the leftover label rows are
/// dropped (a plain alias shows no distinguishing text anyway).
pub async fn remove_entry_from_alias(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    raw_name: &str,
    entry_id: &str,
) -> Result<TanahpediaAliasRemovalResult, ServiceError> {
    tracing::info_span!("tanahpedia_aliases_service::remove_entry_from_alias", %raw_name, %entry_id);
    let name = normalize_pedia_name(raw_name);
    if name.is_empty() {
        return Err(ServiceError::bad_request("שם הכתובת חייב להיות מלא"));
    }

    let transaction = db.get_connection().begin().await.map_err(db_error)?;
    lock_alias_name(&transaction, &name).await?;
    entry_synonym::Entity::delete_many()
        .filter(
            Condition::all()
                .add(entry_synonym::Column::Name.eq(name.as_str()))
                .add(entry_synonym::Column::EntryId.eq(entry_id)),
        )
        .exec(&transaction)
        .await
        .map_err(db_error)?;
    // Defensive: stray label rows for this entry under other rows of the same
    // name (legacy arrangements) go with its association.
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            r#"DELETE d FROM tanahpedia_entry_synonym_disambiguation d
               JOIN tanahpedia_entry_synonym s ON s.id = d.synonym_id
               WHERE s.name = ? AND d.entry_id = ?"#,
            [name.clone().into(), entry_id.into()],
        ))
        .await
        .map_err(db_error)?;
    let remaining = load_alias_targets(&transaction, &name).await?;
    if remaining.len() <= 1 {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DatabaseBackend::MySql,
                r#"DELETE d FROM tanahpedia_entry_synonym_disambiguation d
                   JOIN tanahpedia_entry_synonym s ON s.id = d.synonym_id
                   WHERE s.name = ?"#,
                [name.clone().into()],
            ))
            .await
            .map_err(db_error)?;
    }
    transaction.commit().await.map_err(db_error)?;

    // The removed entry's own page renders the same alias lists as the
    // remaining targets' — invalidate it too.
    let removed_entry = entry::Entity::find_by_id(entry_id)
        .one(db.get_connection())
        .await
        .map_err(db_error)?;
    let mut names = vec![name.clone()];
    if let Some(row) = removed_entry {
        names.push(row.unique_name);
    }
    names.extend(remaining.iter().map(|t| t.unique_name.clone()));
    names.sort_unstable();
    names.dedup();
    let revalidation = revalidator.invalidate_pedia_names(&names).await;

    Ok(TanahpediaAliasRemovalResult {
        name,
        target_count: remaining.len() as i32,
        revalidation: revalidation.as_str().to_string(),
    })
}

/// Deletes the name entirely — every entry's association with it.
pub async fn delete_alias(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    raw_name: &str,
) -> Result<TanahpediaAliasRemovalResult, ServiceError> {
    tracing::info_span!("tanahpedia_aliases_service::delete_alias", %raw_name);
    let name = normalize_pedia_name(raw_name);
    if name.is_empty() {
        return Err(ServiceError::bad_request("שם הכתובת חייב להיות מלא"));
    }

    let transaction = db.get_connection().begin().await.map_err(db_error)?;
    lock_alias_name(&transaction, &name).await?;
    let targets = load_alias_targets(&transaction, &name).await?;
    entry_synonym::Entity::delete_many()
        .filter(entry_synonym::Column::Name.eq(name.as_str()))
        .exec(&transaction)
        .await
        .map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;

    let mut names = vec![name.clone()];
    names.extend(targets.iter().map(|t| t.unique_name.clone()));
    names.sort_unstable();
    names.dedup();
    let revalidation = revalidator.invalidate_pedia_names(&names).await;

    Ok(TanahpediaAliasRemovalResult {
        name,
        target_count: targets.len() as i32,
        revalidation: revalidation.as_str().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
    use std::collections::BTreeMap;

    fn mock_row(
        values: impl IntoIterator<Item = (&'static str, Value)>,
    ) -> BTreeMap<String, Value> {
        values
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect()
    }

    fn exec_result() -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected: 1,
        }
    }

    fn entry_model(id: &str, unique_name: &str, title: &str) -> entry::Model {
        let now = chrono::Utc::now().naive_utc();
        entry::Model {
            id: id.to_string(),
            unique_name: unique_name.to_string(),
            title: title.to_string(),
            content: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn target_input(entry_id: &str, label: Option<&str>) -> TanahpediaAliasTargetInput {
        TanahpediaAliasTargetInput {
            entry_id: entry_id.to_string(),
            label: label.map(str::to_string),
        }
    }

    fn target_row(
        entry_id: &str,
        unique_name: &str,
        title: &str,
        label: Value,
    ) -> BTreeMap<String, Value> {
        mock_row([
            ("entry_id", entry_id.into()),
            ("unique_name", unique_name.into()),
            ("title", title.into()),
            ("label", label),
        ])
    }

    fn skipped_revalidator() -> WebsiteRevalidator {
        WebsiteRevalidator::new(None, None)
    }

    /// Occurrences of a SQL substring across the whole transaction log — one
    /// log entry holds every statement of its transaction, so entry-level
    /// `contains` checks cannot count statements.
    fn sql_occurrences(log: &[impl std::fmt::Debug], needle: &str) -> usize {
        log.iter()
            .map(|tx| format!("{tx:?}").matches(needle).count())
            .sum()
    }

    #[test]
    fn normalize_pedia_name_trims_decodes_and_composes() {
        assert_eq!(normalize_pedia_name("  משה  "), "משה");
        assert_eq!(normalize_pedia_name("%D7%9E%D7%A9%D7%94"), "משה");
        // Decomposed NFC input lands in the same stored form the router uses.
        assert_eq!(normalize_pedia_name("e\u{301}"), "é");
        // Malformed escapes stay raw rather than erroring.
        assert_eq!(normalize_pedia_name("%ZZ"), "%ZZ");
    }

    #[test]
    fn normalize_slug_like_category_matches_website_slugs() {
        assert_eq!(normalize_slug_like_category("TEMPLE_TOOL"), "temple-tool");
        assert_eq!(normalize_slug_like_category("  בעלי  חיים "), "בעלי-חיים");
        // The quote is not a slug separator — same normalized form as the website's normalizeSlug.
        assert_eq!(normalize_slug_like_category("ספרי תנ\"ך"), "ספרי-תנ\"ך");
        assert_eq!(normalize_slug_like_category("a__b  c"), "a-b-c");
    }

    #[test]
    fn reserved_category_label_for_covers_slug_and_english_key() {
        assert_eq!(reserved_category_label_for("בעלי-חיים"), Some("בעלי חיים"));
        assert_eq!(reserved_category_label_for("BEHEMA"), Some("בהמות"));
        assert_eq!(reserved_category_label_for("behema"), Some("בהמות"));
        assert_eq!(reserved_category_label_for("ספרי-תנך"), Some("ספרי תנ\"ך"));
        assert_eq!(reserved_category_label_for("משה-רבנו"), None);
    }

    #[test]
    fn dedupe_alias_targets_keeps_first_position_and_fills_empty_label() {
        let targets = dedupe_alias_targets(vec![
            target_input("e1", None),
            target_input("e2", Some(" שני ")),
            target_input("e1", Some("ראשון")),
            target_input("e1", Some("מאוחר")),
        ]);
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].entry_id, "e1");
        assert_eq!(targets[0].label.as_deref(), Some("ראשון"));
        assert_eq!(targets[1].entry_id, "e2");
        assert_eq!(targets[1].label.as_deref(), Some("שני"));

        let filled = dedupe_alias_targets(vec![
            target_input("e1", Some("   ")),
            target_input("e1", Some(" תווית ")),
        ]);
        assert_eq!(filled[0].label.as_deref(), Some("תווית"));
    }

    #[test]
    fn same_alias_target_set_compares_multisets_with_normalized_labels() {
        let current = vec![
            TanahpediaSynonymTarget {
                entry_id: "e1".to_string(),
                unique_name: "א".to_string(),
                title: "א".to_string(),
                label: Some(" תווית ".to_string()),
            },
            TanahpediaSynonymTarget {
                entry_id: "e2".to_string(),
                unique_name: "ב".to_string(),
                title: "ב".to_string(),
                label: None,
            },
        ];
        let expected = vec![target_input("e2", None), target_input("e1", Some("תווית"))];
        assert!(same_alias_target_set(&current, &expected));
        assert!(!same_alias_target_set(
            &current,
            &[target_input("e1", Some("תווית"))]
        ));
        assert!(!same_alias_target_set(&current, &[]));
    }

    #[test]
    fn alias_kind_for_target_count_matches_public_contract() {
        assert_eq!(alias_kind_for_target_count(1), "alias");
        assert_eq!(alias_kind_for_target_count(2), "disambiguation");
    }

    #[test]
    fn validate_alias_spec_rejects_each_bad_shape() {
        let target = target_input("e1", None);
        assert_eq!(
            validate_alias_spec("", &[target.clone()])
                .unwrap_err()
                .to_string(),
            "שם הכתובת חייב להיות מלא"
        );
        assert_eq!(
            validate_alias_spec("a/b", &[target.clone()])
                .unwrap_err()
                .to_string(),
            "שם הכתובת אינו יכול להכיל '/'"
        );
        assert_eq!(
            validate_alias_spec(&"א".repeat(256), &[target.clone()])
                .unwrap_err()
                .to_string(),
            "שם הכתובת ארוך מדי (עד 255 תווים)"
        );
        assert_eq!(
            validate_alias_spec("שם", &[]).unwrap_err().to_string(),
            "יש לצרף לפחות ערך יעד אחד"
        );
        assert_eq!(
            validate_alias_spec("שם", &[target.clone(), target_input("e2", None)])
                .unwrap_err()
                .to_string(),
            "כשהשם משותף בין כמה ערכים, לכל ערך נדרשת תווית מבדנת שתופיע בדף הפירושונים"
        );
        assert_eq!(
            validate_alias_spec(
                "שם",
                &[
                    target_input("e1", Some("א")),
                    target_input("e2", Some(&"א".repeat(256)))
                ],
            )
            .unwrap_err()
            .to_string(),
            "תווית מבדנת ארוכה מדי (עד 255 תווים)"
        );
        assert!(
            validate_alias_spec(
                "שם",
                &[
                    target_input("e1", Some("אחת")),
                    target_input("e2", Some("תווית"))
                ]
            )
            .is_ok()
        );
    }

    #[tokio::test]
    async fn get_name_status_reports_invalid_and_reserved() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let status = get_name_status(&db, "  ", None).await.unwrap();
        assert_eq!(status.kind, "invalid");
        assert_eq!(status.reason.as_deref(), Some("שם הכתובת חייב להיות מלא"));

        let status = get_name_status(&db, "a/b", None).await.unwrap();
        assert_eq!(
            status.reason.as_deref(),
            Some("שם הכתובת אינו יכול להכיל '/'")
        );

        let status = get_name_status(&db, &"א".repeat(256), None).await.unwrap();
        assert_eq!(
            status.reason.as_deref(),
            Some("שם הכתובת ארוך מדי (עד 255 תווים)")
        );

        let status = get_name_status(&db, "אישים", None).await.unwrap();
        assert_eq!(status.kind, "reserved");
        assert_eq!(status.category_label.as_deref(), Some("אישים"));
    }

    #[tokio::test]
    async fn get_name_status_reports_canonical_self_main_alias_and_free() {
        // canonical: the name is another entry's main address.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                    "משה-רבנו",
                    "משה רבנו",
                )]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let status = get_name_status(&db, "משה-רבנו", None).await.unwrap();
        assert_eq!(status.kind, "canonical");
        assert_eq!(status.entry.unwrap().id, "e1");

        // self-main: the edited entry owns the name.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                    "משה-רבנו",
                    "משה רבנו",
                )]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let status = get_name_status(&db, "משה-רבנו", Some("e1")).await.unwrap();
        assert_eq!(status.kind, "self-main");
        assert!(status.entry.is_none());

        // alias: no canonical holder but alias targets exist.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![target_row(
                        "e1",
                        "משה-רבנו",
                        "משה רבנו",
                        Value::String(None),
                    )],
                ])
                .into_connection(),
        );
        let status = get_name_status(&db, "משה", None).await.unwrap();
        assert_eq!(status.kind, "alias");
        assert_eq!(status.alias_targets.len(), 1);

        // free: nothing holds the name.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let status = get_name_status(&db, "משה", None).await.unwrap();
        assert_eq!(status.kind, "free");
    }

    #[tokio::test]
    async fn get_entry_aliases_maps_each_name_with_its_context() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([("name", "אישים".into())]),
                        mock_row([("name", "משה".into())]),
                    ],
                ])
                // Per name: alias targets, then canonical holder.
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![target_row("e1", "משה-רבנו", "משה רבנו", "תווית".into())],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![target_row(
                        "e1",
                        "משה-רבנו",
                        "משה רבנו",
                        Value::String(None),
                    )],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "other",
                    "משה",
                    "משה אחר",
                )]])
                .into_connection(),
        );

        let aliases = get_entry_aliases(&db, "e1").await.unwrap();
        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases[0].name, "אישים");
        assert_eq!(aliases[0].kind, "alias");
        assert_eq!(aliases[0].reserved_category.as_deref(), Some("אישים"));
        assert!(!aliases[0].is_self_main);
        assert_eq!(aliases[1].name, "משה");
        assert_eq!(
            aliases[1].shadowed_by_canonical.as_ref().unwrap().id,
            "other"
        );
    }

    #[tokio::test]
    async fn save_alias_writes_a_single_alias_in_one_transaction() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![mock_row([
                        ("id", "e1".into()),
                        ("unique_name", "משה-רבנו".into()),
                    ])],
                ])
                .append_exec_results([exec_result(), exec_result()])
                .into_connection(),
        );

        let result = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: " משה ".to_string(),
                targets: vec![target_input("e1", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap();

        assert_eq!(result.name, "משה");
        assert_eq!(result.kind, "alias");
        assert_eq!(result.target_count, 1);
        assert_eq!(result.revalidation, "SKIPPED");
        let log = db.get_connection().clone().into_transaction_log();
        let statements: Vec<String> = log.iter().map(|t| format!("{t:?}")).collect();
        assert!(statements.iter().any(|s| s.contains("FOR UPDATE")));
        assert!(
            statements
                .iter()
                .any(|s| s.contains("DELETE FROM `tanahpedia_entry_synonym`"))
        );
        assert!(
            statements
                .iter()
                .any(|s| s.contains("INSERT INTO `tanahpedia_entry_synonym`"))
        );
        assert_eq!(
            sql_occurrences(
                &log,
                "INSERT INTO `tanahpedia_entry_synonym_disambiguation`"
            ),
            0
        );
    }

    #[tokio::test]
    async fn save_alias_writes_labelled_rows_for_a_shared_name() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        mock_row([("id", "e1".into()), ("unique_name", "דתן".into())]),
                        mock_row([("id", "e2".into()), ("unique_name", "אבירם".into())]),
                    ],
                ])
                .append_exec_results([
                    exec_result(),
                    exec_result(),
                    exec_result(),
                    exec_result(),
                    exec_result(),
                ])
                .into_connection(),
        );

        let result = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "דתן-ואבירם".to_string(),
                targets: vec![
                    target_input("e1", Some("דתן")),
                    target_input("e2", Some("אבירם")),
                ],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap();

        assert_eq!(result.kind, "disambiguation");
        assert_eq!(result.target_count, 2);
        let log = db.get_connection().clone().into_transaction_log();
        assert_eq!(
            sql_occurrences(
                &log,
                "INSERT INTO `tanahpedia_entry_synonym_disambiguation`"
            ),
            2
        );
    }

    #[tokio::test]
    async fn save_alias_rejects_a_canonical_name_and_a_stale_baseline() {
        // Canonical collision.
        let db =
            Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                        vec![],
                    ])
                    .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![
                        entry_model("e1", "משה-רבנו", "משה רבנו"),
                    ]])
                    .into_connection(),
            );
        let err = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "משה-רבנו".to_string(),
                targets: vec![target_input("e1", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
        assert!(err.to_string().contains("הוא הכתובת הראשית של הערך"));

        // Stale baseline: the name drifted since the client's snapshot.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![target_row("e9", "אחר", "אחר", Value::String(None))],
                ])
                .into_connection(),
        );
        let err = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "משה".to_string(),
                targets: vec![target_input("e1", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
        assert!(err.to_string().contains("was changed by another admin"));
    }

    #[tokio::test]
    async fn save_alias_rejects_bad_specs_reserved_names_and_missing_targets() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let err = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "  ".to_string(),
                targets: vec![target_input("e1", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));

        let err = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "אישים".to_string(),
                targets: vec![target_input("e1", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("שמור לנתיב הקטגוריה"));

        // A target id that does not exist.
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .into_connection(),
        );
        let err = save_alias(
            &db,
            &skipped_revalidator(),
            SaveTanahpediaAliasInput {
                name: "משה".to_string(),
                targets: vec![target_input("e-missing", None)],
                expected_targets: vec![],
            },
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("אחד היעדים אינו ערך קיים"));
    }

    #[tokio::test]
    async fn remove_entry_from_alias_keeps_labels_while_the_name_is_shared() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_exec_results([exec_result(), exec_result()])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        target_row("e2", "אבירם", "אבירם", "אבירם".into()),
                        target_row("e3", "קורח", "קורח", "קורח".into()),
                    ],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1", "דתן", "דתן",
                )]])
                .into_connection(),
        );

        let result = remove_entry_from_alias(&db, &skipped_revalidator(), "דתן-ואבירם-וקורח", "e1")
            .await
            .unwrap();

        assert_eq!(result.target_count, 2);
        let log = db.get_connection().clone().into_transaction_log();
        // No wholesale label cleanup while the name still has several targets.
        assert_eq!(
            sql_occurrences(
                &log,
                "DELETE d FROM tanahpedia_entry_synonym_disambiguation"
            ),
            1
        );
    }

    #[tokio::test]
    async fn remove_entry_from_alias_drops_the_last_label_when_one_target_remains() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_exec_results([exec_result(), exec_result(), exec_result()])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![target_row("e2", "אבירם", "אבירם", "אבירם".into())],
                ])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1", "דתן", "דתן",
                )]])
                .into_connection(),
        );

        let result = remove_entry_from_alias(&db, &skipped_revalidator(), "דתן-ואבירם", "e1")
            .await
            .unwrap();

        assert_eq!(result.target_count, 1);
        let log = db.get_connection().clone().into_transaction_log();
        // The leftover label row is dropped once a plain alias remains.
        assert_eq!(
            sql_occurrences(
                &log,
                "DELETE d FROM tanahpedia_entry_synonym_disambiguation"
            ),
            2
        );
    }

    #[tokio::test]
    async fn remove_entry_from_alias_rejects_an_empty_name() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let err = remove_entry_from_alias(&db, &skipped_revalidator(), "  ", "e1")
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn delete_alias_removes_every_association() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_synonym::Model, Vec<entry_synonym::Model>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        target_row("e1", "דתן", "דתן", "דתן".into()),
                        target_row("e2", "אבירם", "אבירם", "אבירם".into()),
                    ],
                ])
                .append_exec_results([MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 2,
                }])
                .into_connection(),
        );

        let result = delete_alias(&db, &skipped_revalidator(), " דתן-ואבירם ")
            .await
            .unwrap();

        assert_eq!(result.name, "דתן-ואבירם");
        assert_eq!(result.target_count, 2);
        assert_eq!(result.revalidation, "SKIPPED");
        let log = db.get_connection().clone().into_transaction_log();
        let statements: Vec<String> = log.iter().map(|t| format!("{t:?}")).collect();
        assert!(
            statements
                .iter()
                .any(|s| s.contains("DELETE FROM `tanahpedia_entry_synonym`"))
        );
    }

    #[tokio::test]
    async fn delete_alias_rejects_an_empty_name() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let err = delete_alias(&db, &skipped_revalidator(), " ")
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }
}
