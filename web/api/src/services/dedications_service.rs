use std::collections::HashMap;

use chrono::{NaiveDateTime, Utc};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, TransactionTrait};

use crate::common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError};
use crate::dtos::dedication::{DedicationTargetInput, UpdateDedicationInput};
use crate::providers::Database;
use entities::{
    article, article_dedication, dedication, dedication_dedication_type, dedication_type, helek,
    helek_dedication, masora_dedication, parasha_dedication, perek_dedication, sefer,
    sefer_dedication, tanahpedia::entry, tanahpedia_entry_dedication,
};

/// The concrete target one assignment row points at.
#[derive(Debug, Clone, PartialEq)]
pub enum ScopeTarget {
    /// Inclusive canonical perek-id range.
    Perek {
        low: i32,
        high: i32,
    },
    Sefer {
        sefer_id: i32,
    },
    Helek {
        helek_id: i32,
    },
    Parasha {
        parasha_id: i32,
    },
    Article {
        article_id: i32,
    },
    TanahpediaEntry {
        entry_id: String,
    },
    /// The whole מסורה על הפרק feature — no target id by design.
    Masora,
}

/// One assignment of a dedication that matched a reading context.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeMatch {
    pub target: ScopeTarget,
    /// Assignment-level expiry (UTC wall-clock); `None` = ongoing.
    pub expires_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone)]
pub struct DedicationAggregate {
    pub dedication: dedication::Model,
    pub purposes: Vec<String>,
    /// The assignments that matched the requested context — every assignment
    /// for the admin listing.
    pub scopes: Vec<ScopeMatch>,
}

/// Reading context supplied by a caller: every identity the context carries.
/// The service expands perek → sefer → helek ancestors itself.
#[derive(Debug, Clone, Default)]
pub struct DedicationContext {
    pub perek_ids: Vec<i32>,
    pub sefer_ids: Vec<i32>,
    pub helek_ids: Vec<i32>,
    pub parasha_ids: Vec<i32>,
    pub entry_ids: Vec<String>,
    pub article_ids: Vec<i32>,
    pub masora: bool,
}

/// Active rule (docs/data/dedications.md): every applicable expiry is NULL or
/// strictly in the future — the expiry instant itself is the first hidden
/// moment. `now` is the caller's UTC instant so the boundary is testable.
fn is_active(expires_at: Option<NaiveDateTime>, now: NaiveDateTime) -> bool {
    expires_at.is_none_or(|t| t > now)
}

fn internal<T: std::fmt::Display + std::fmt::Debug>(cause: T) -> ServiceError {
    #[cfg(test)]
    eprintln!("dedication internal error: {cause}");
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(cause))
}

/// Parses a write-path expiry: RFC-3339 with an offset, or a bare
/// `YYYY-MM-DD[ T]HH:MM:SS` read as UTC. A bare date is rejected — "through
/// the day" would be ambiguous.
fn parse_expiry(value: &str) -> Result<NaiveDateTime, ServiceError> {
    let trimmed = value.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.naive_utc());
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Ok(dt);
        }
    }
    Err(ServiceError::bad_request(&format!(
        "Invalid expiry '{value}': use ISO-8601 with a time component (UTC)"
    )))
}

/// Expands perek/sefer context ids into their ancestor sefer/helek ids using
/// the canonical range tables (docs/data/dedications.md). `sefers`/`heleks`
/// are the whole (tiny) canonical tables, loaded once by the caller.
fn expand_ancestors(
    ctx: &DedicationContext,
    sefers: &[sefer::Model],
    heleks: &[helek::Model],
) -> (Vec<i32>, Vec<i32>) {
    let mut sefer_ids: Vec<i32> = ctx.sefer_ids.clone();
    for perek_id in &ctx.perek_ids {
        if let Some(s) = sefers
            .iter()
            .find(|s| s.perek_id_from <= *perek_id && *perek_id <= s.perek_id_to)
            && !sefer_ids.contains(&s.id)
        {
            sefer_ids.push(s.id);
        }
    }
    let mut helek_ids: Vec<i32> = ctx.helek_ids.clone();
    for sefer_id in &sefer_ids {
        if let Some(h) = heleks
            .iter()
            .find(|h| h.sefer_id_from <= *sefer_id && *sefer_id <= h.sefer_id_to)
            && !helek_ids.contains(&h.id)
        {
            helek_ids.push(h.id);
        }
    }
    (sefer_ids, helek_ids)
}

/// Shared applicability resolver (#2731): returns every active dedication
/// whose direct or ancestor scope matches `ctx`, deduplicated by dedication
/// id, each carrying the assignments that matched. Public path — expired
/// rows are excluded at `now`.
pub async fn resolve(
    db: &Database,
    ctx: DedicationContext,
    now: NaiveDateTime,
) -> Result<Vec<DedicationAggregate>, ServiceError> {
    let needs_ancestors = !ctx.perek_ids.is_empty() || !ctx.sefer_ids.is_empty();
    let (sefers, heleks) = if needs_ancestors {
        (
            sefer::Entity::find()
                .all(db.get_connection())
                .await
                .map_err(internal)?,
            helek::Entity::find()
                .all(db.get_connection())
                .await
                .map_err(internal)?,
        )
    } else {
        (Vec::new(), Vec::new())
    };
    let (sefer_ids, helek_ids) = expand_ancestors(&ctx, &sefers, &heleks);

    // Link tables are small by design; matching in code keeps the shared
    // resolver legible and lets MockDatabase tests exercise the real filter.
    let mut matched: Vec<(i32, ScopeMatch)> = Vec::new();

    if !ctx.perek_ids.is_empty() {
        for row in perek_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now)
                && ctx
                    .perek_ids
                    .iter()
                    .any(|p| row.perek_id_low <= *p && *p <= row.perek_id_high)
            {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Perek {
                            low: row.perek_id_low,
                            high: row.perek_id_high,
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if !sefer_ids.is_empty() {
        for row in sefer_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) && sefer_ids.contains(&row.sefer_id) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Sefer {
                            sefer_id: row.sefer_id,
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if !helek_ids.is_empty() {
        for row in helek_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) && helek_ids.contains(&row.helek_id) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Helek {
                            helek_id: row.helek_id,
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if !ctx.parasha_ids.is_empty() {
        for row in parasha_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) && ctx.parasha_ids.contains(&row.parasha_id) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Parasha {
                            parasha_id: row.parasha_id,
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if !ctx.article_ids.is_empty() {
        for row in article_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) && ctx.article_ids.contains(&row.article_id) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Article {
                            article_id: row.article_id,
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if !ctx.entry_ids.is_empty() {
        for row in tanahpedia_entry_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) && ctx.entry_ids.contains(&row.entry_id) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::TanahpediaEntry {
                            entry_id: row.entry_id.clone(),
                        },
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }
    if ctx.masora {
        for row in masora_dedication::Entity::find()
            .all(db.get_connection())
            .await
            .map_err(internal)?
        {
            if is_active(row.expires_at, now) {
                matched.push((
                    row.dedication_id,
                    ScopeMatch {
                        target: ScopeTarget::Masora,
                        expires_at: row.expires_at,
                    },
                ));
            }
        }
    }

    if matched.is_empty() {
        return Ok(Vec::new());
    }
    let mut ids: Vec<i32> = matched.iter().map(|(id, _)| *id).collect();
    ids.sort_unstable();
    ids.dedup();
    let dedications = dedication::Entity::find()
        .filter(dedication::Column::Id.is_in(ids))
        .all(db.get_connection())
        .await
        .map_err(internal)?;
    hydrate(db, dedications, matched, true, now).await
}

/// Admin listing: every dedication with every assignment, including expired —
/// management must still inspect and edit lapsed rows.
pub async fn list_all(db: &Database) -> Result<Vec<DedicationAggregate>, ServiceError> {
    let mut matched: Vec<(i32, ScopeMatch)> = Vec::new();
    for row in perek_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Perek {
                    low: row.perek_id_low,
                    high: row.perek_id_high,
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in sefer_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Sefer {
                    sefer_id: row.sefer_id,
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in helek_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Helek {
                    helek_id: row.helek_id,
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in parasha_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Parasha {
                    parasha_id: row.parasha_id,
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in article_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Article {
                    article_id: row.article_id,
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in tanahpedia_entry_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::TanahpediaEntry {
                    entry_id: row.entry_id.clone(),
                },
                expires_at: row.expires_at,
            },
        ));
    }
    for row in masora_dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?
    {
        matched.push((
            row.dedication_id,
            ScopeMatch {
                target: ScopeTarget::Masora,
                expires_at: row.expires_at,
            },
        ));
    }
    // The dedication table drives the listing — a row with no assignments
    // still appears (empty scope list) so an unassigned creation neither
    // errors the mutation's post-commit read nor hides from the admin list.
    let dedications = dedication::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?;
    hydrate(db, dedications, matched, false, Utc::now().naive_utc()).await
}

/// Loads the purpose links for `dedications` and folds `matched` into
/// per-dedication aggregates. `active_only` drops expired dedications
/// (public path); the admin path keeps them.
async fn hydrate(
    db: &Database,
    dedications: Vec<dedication::Model>,
    matched: Vec<(i32, ScopeMatch)>,
    active_only: bool,
    now: NaiveDateTime,
) -> Result<Vec<DedicationAggregate>, ServiceError> {
    let ids: Vec<i32> = dedications.iter().map(|d| d.id).collect();
    let purpose_links = if ids.is_empty() {
        Vec::new()
    } else {
        dedication_dedication_type::Entity::find()
            .filter(dedication_dedication_type::Column::DedicationId.is_in(ids))
            .all(db.get_connection())
            .await
            .map_err(internal)?
    };
    let types = dedication_type::Entity::find()
        .all(db.get_connection())
        .await
        .map_err(internal)?;
    let type_names: HashMap<i32, String> =
        types.into_iter().map(|t| (t.id, t.description)).collect();
    let mut purposes_by_dedication: HashMap<i32, Vec<String>> = HashMap::new();
    for link in purpose_links {
        if let Some(name) = type_names.get(&link.dedication_type_id) {
            purposes_by_dedication
                .entry(link.dedication_id)
                .or_default()
                .push(name.clone());
        }
    }

    let mut scopes_by_dedication: HashMap<i32, Vec<ScopeMatch>> = HashMap::new();
    for (dedication_id, scope) in matched {
        scopes_by_dedication
            .entry(dedication_id)
            .or_default()
            .push(scope);
    }

    let mut out = Vec::new();
    for dedication in dedications {
        if active_only && !is_active(dedication.expires_at, now) {
            continue;
        }
        let mut purposes = purposes_by_dedication
            .remove(&dedication.id)
            .unwrap_or_default();
        purposes.sort();
        out.push(DedicationAggregate {
            scopes: scopes_by_dedication
                .remove(&dedication.id)
                .unwrap_or_default(),
            dedication,
            purposes,
        });
    }
    out.sort_by_key(|a| a.dedication.id);
    Ok(out)
}

/// Parsed + referentially validated assignment ready to insert.
struct ValidatedTarget {
    target: ScopeTarget,
    expires_at: Option<NaiveDateTime>,
}

/// Validates one target input against the canonical identity tables —
/// sefer/helek/perek-range/parasha ids are not FK-protected (deploys recreate
/// the canonical tables), so the write path is where real-target checks live.
async fn validate_target(
    txn: &impl ConnectionTrait,
    input: &DedicationTargetInput,
) -> Result<ValidatedTarget, ServiceError> {
    use crate::dtos::dedication::DedicationScopeKind as Kind;
    let expires_at = input.expires_at.as_deref().map(parse_expiry).transpose()?;
    let target = match input.kind {
        Kind::Perek => {
            let (low, high) = match (input.perek_id_low, input.perek_id_high) {
                (Some(l), Some(h)) => (l, h),
                _ => {
                    return Err(ServiceError::bad_request(
                        "PEREK target requires perekIdLow and perekIdHigh",
                    ));
                }
            };
            if low > high {
                return Err(ServiceError::bad_request(
                    "perekIdLow must not exceed perekIdHigh",
                ));
            }
            // Canonical perek ids are contiguous; both bounds existing proves
            // the whole range exists.
            let bounds = perek_bounds_exist(txn, low, high).await?;
            if !bounds {
                return Err(ServiceError::bad_request(&format!(
                    "Perek range {low}-{high} is not canonical (1-929)"
                )));
            }
            ScopeTarget::Perek { low, high }
        }
        Kind::Sefer => {
            let id = input
                .sefer_id
                .ok_or_else(|| ServiceError::bad_request("SEFER target requires seferId"))?;
            if sefer::Entity::find_by_id(id)
                .one(txn)
                .await
                .map_err(internal)?
                .is_none()
            {
                return Err(ServiceError::bad_request(&format!(
                    "Sefer {id} does not exist"
                )));
            }
            ScopeTarget::Sefer { sefer_id: id }
        }
        Kind::Helek => {
            let id = input
                .helek_id
                .ok_or_else(|| ServiceError::bad_request("HELEK target requires helekId"))?;
            if helek::Entity::find_by_id(id)
                .one(txn)
                .await
                .map_err(internal)?
                .is_none()
            {
                return Err(ServiceError::bad_request(&format!(
                    "Helek {id} does not exist"
                )));
            }
            ScopeTarget::Helek { helek_id: id }
        }
        Kind::Parasha => {
            let id = input
                .parasha_id
                .ok_or_else(|| ServiceError::bad_request("PARASHA target requires parashaId"))?;
            // The parasha division lives in shared content code, not a table;
            // ids are the positive unit ids it publishes.
            if id < 1 {
                return Err(ServiceError::bad_request(&format!(
                    "Parasha id {id} is not a valid weekly unit"
                )));
            }
            ScopeTarget::Parasha { parasha_id: id }
        }
        Kind::Article => {
            let id = input
                .article_id
                .ok_or_else(|| ServiceError::bad_request("ARTICLE target requires articleId"))?;
            if article::Entity::find_by_id(id)
                .one(txn)
                .await
                .map_err(internal)?
                .is_none()
            {
                return Err(ServiceError::bad_request(&format!(
                    "Article {id} does not exist"
                )));
            }
            ScopeTarget::Article { article_id: id }
        }
        Kind::TanahpediaEntry => {
            let id = input
                .entry_id
                .clone()
                .filter(|e| !e.trim().is_empty())
                .ok_or_else(|| {
                    ServiceError::bad_request("TANAHPEDIA_ENTRY target requires entryId")
                })?;
            if entry::Entity::find_by_id(id.clone())
                .one(txn)
                .await
                .map_err(internal)?
                .is_none()
            {
                return Err(ServiceError::bad_request(&format!(
                    "Tanahpedia entry {id} does not exist"
                )));
            }
            ScopeTarget::TanahpediaEntry { entry_id: id }
        }
        Kind::Masora => ScopeTarget::Masora,
    };
    Ok(ValidatedTarget { target, expires_at })
}

async fn perek_bounds_exist(
    txn: &impl ConnectionTrait,
    low: i32,
    high: i32,
) -> Result<bool, ServiceError> {
    let low_found = entities::perek::Entity::find_by_id(low)
        .one(txn)
        .await
        .map_err(internal)?
        .is_some();
    if !low_found {
        return Ok(false);
    }
    Ok(entities::perek::Entity::find_by_id(high)
        .one(txn)
        .await
        .map_err(internal)?
        .is_some())
}

/// A target's dedup key: rejects "same target twice" inside one request, which
/// would otherwise violate the link tables' primary keys.
fn target_key(target: &ScopeTarget) -> String {
    match target {
        ScopeTarget::Perek { low, high } => format!("PEREK:{low}:{high}"),
        ScopeTarget::Sefer { sefer_id } => format!("SEFER:{sefer_id}"),
        ScopeTarget::Helek { helek_id } => format!("HELEK:{helek_id}"),
        ScopeTarget::Parasha { parasha_id } => format!("PARASHA:{parasha_id}"),
        ScopeTarget::Article { article_id } => format!("ARTICLE:{article_id}"),
        ScopeTarget::TanahpediaEntry { entry_id } => format!("ENTRY:{entry_id}"),
        ScopeTarget::Masora => "MASORA".to_string(),
    }
}

async fn validate_targets(
    txn: &impl ConnectionTrait,
    inputs: &[DedicationTargetInput],
) -> Result<Vec<ValidatedTarget>, ServiceError> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(inputs.len());
    for input in inputs {
        let validated = validate_target(txn, input).await?;
        if !seen.insert(target_key(&validated.target)) {
            return Err(ServiceError::bad_request("Duplicate target in one request"));
        }
        out.push(validated);
    }
    Ok(out)
}

async fn validate_purposes(
    txn: &impl ConnectionTrait,
    purpose_type_ids: &[i32],
) -> Result<(), ServiceError> {
    for id in purpose_type_ids {
        if dedication_type::Entity::find_by_id(*id)
            .one(txn)
            .await
            .map_err(internal)?
            .is_none()
        {
            return Err(ServiceError::bad_request(&format!(
                "Dedication type {id} does not exist"
            )));
        }
    }
    Ok(())
}

async fn insert_targets(
    txn: &impl ConnectionTrait,
    dedication_id: i32,
    targets: &[ValidatedTarget],
) -> Result<(), ServiceError> {
    for validated in targets {
        let expires_at = validated.expires_at;
        match &validated.target {
            ScopeTarget::Perek { low, high } => {
                perek_dedication::Entity::insert(perek_dedication::ActiveModel {
                    perek_id_low: Set(*low),
                    perek_id_high: Set(*high),
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::Sefer { sefer_id } => {
                sefer_dedication::Entity::insert(sefer_dedication::ActiveModel {
                    sefer_id: Set(*sefer_id),
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                    created_at: sea_orm::NotSet,
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::Helek { helek_id } => {
                helek_dedication::Entity::insert(helek_dedication::ActiveModel {
                    helek_id: Set(*helek_id),
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                    created_at: sea_orm::NotSet,
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::Parasha { parasha_id } => {
                parasha_dedication::Entity::insert(parasha_dedication::ActiveModel {
                    parasha_id: Set(*parasha_id),
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                    created_at: sea_orm::NotSet,
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::Article { article_id } => {
                article_dedication::Entity::insert(article_dedication::ActiveModel {
                    article_id: Set(*article_id),
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::TanahpediaEntry { entry_id } => {
                tanahpedia_entry_dedication::Entity::insert(
                    tanahpedia_entry_dedication::ActiveModel {
                        entry_id: Set(entry_id.clone()),
                        dedication_id: Set(dedication_id),
                        expires_at: Set(expires_at),
                        created_at: sea_orm::NotSet,
                    },
                )
                .exec(txn)
                .await
                .map_err(internal)?;
            }
            ScopeTarget::Masora => {
                masora_dedication::Entity::insert(masora_dedication::ActiveModel {
                    dedication_id: Set(dedication_id),
                    expires_at: Set(expires_at),
                    created_at: sea_orm::NotSet,
                })
                .exec(txn)
                .await
                .map_err(internal)?;
            }
        }
    }
    Ok(())
}

async fn insert_purposes(
    txn: &impl ConnectionTrait,
    dedication_id: i32,
    purpose_type_ids: &[i32],
) -> Result<(), ServiceError> {
    let mut seen = std::collections::HashSet::new();
    for type_id in purpose_type_ids {
        // Duplicate purposes in one input dedupe instead of erroring.
        if !seen.insert(*type_id) {
            continue;
        }
        dedication_dedication_type::Entity::insert(dedication_dedication_type::ActiveModel {
            dedication_id: Set(dedication_id),
            dedication_type_id: Set(*type_id),
        })
        .exec(txn)
        .await
        .map_err(internal)?;
    }
    Ok(())
}

/// Deletes every assignment row of a dedication across all link tables — the
/// FK cascades normally do this, but doing it explicitly keeps the delete
/// correct even on a legacy schema where the guarded FK could not be added.
async fn delete_all_links(
    txn: &impl ConnectionTrait,
    dedication_id: i32,
) -> Result<(), ServiceError> {
    perek_dedication::Entity::delete_many()
        .filter(perek_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    sefer_dedication::Entity::delete_many()
        .filter(sefer_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    helek_dedication::Entity::delete_many()
        .filter(helek_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    parasha_dedication::Entity::delete_many()
        .filter(parasha_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    article_dedication::Entity::delete_many()
        .filter(article_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    tanahpedia_entry_dedication::Entity::delete_many()
        .filter(tanahpedia_entry_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    masora_dedication::Entity::delete_many()
        .filter(masora_dedication::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    dedication_dedication_type::Entity::delete_many()
        .filter(dedication_dedication_type::Column::DedicationId.eq(dedication_id))
        .exec(txn)
        .await
        .map_err(internal)?;
    Ok(())
}

fn normalize_subject(subject: &str) -> Result<String, ServiceError> {
    let trimmed = subject.trim();
    if trimmed.is_empty() {
        return Err(ServiceError::bad_request("Subject must not be empty"));
    }
    Ok(trimmed.to_string())
}

/// Creates a dedication with its purposes and validated targets in one
/// transaction. Returns the stored aggregate (every assignment attached).
pub async fn create(
    db: &Database,
    subject: String,
    expires_at: Option<String>,
    purpose_type_ids: Vec<i32>,
    targets: Vec<DedicationTargetInput>,
) -> Result<DedicationAggregate, ServiceError> {
    let subject = normalize_subject(&subject)?;
    let expires_at = expires_at.as_deref().map(parse_expiry).transpose()?;

    let txn = db.get_connection().begin().await.map_err(internal)?;
    validate_purposes(&txn, &purpose_type_ids).await?;
    let validated = validate_targets(&txn, &targets).await?;

    let inserted = dedication::Entity::insert(dedication::ActiveModel {
        subject: Set(subject),
        expires_at: Set(expires_at),
        ..Default::default()
    })
    .exec(&txn)
    .await
    .map_err(internal)?;

    let id = inserted.last_insert_id;
    insert_purposes(&txn, id, &purpose_type_ids).await?;
    insert_targets(&txn, id, &validated).await?;
    txn.commit().await.map_err(internal)?;

    find_aggregate(db, id).await
}

/// Reloads one dedication with all its assignments and purposes — the
/// post-write read mutations return.
async fn find_aggregate(db: &Database, id: i32) -> Result<DedicationAggregate, ServiceError> {
    let all = list_all(db).await?;
    all.into_iter()
        .find(|a| a.dedication.id == id)
        .ok_or_else(|| ServiceError::not_found("Dedication Not Found", None::<ServiceError>))
}

/// Applies field/subject/expiry changes plus optional full purpose/target
/// replacement sets, atomically.
pub async fn update(
    db: &Database,
    id: i32,
    input: UpdateDedicationInput,
) -> Result<DedicationAggregate, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(internal)?;

    let existing = dedication::Entity::find_by_id(id)
        .one(&txn)
        .await
        .map_err(internal)?
        .ok_or_else(|| ServiceError::not_found("Dedication Not Found", None::<ServiceError>))?;

    let mut model: dedication::ActiveModel = existing.into();
    if let Some(subject) = &input.subject {
        model.subject = Set(normalize_subject(subject)?);
    }
    if input.clear_expires_at.unwrap_or(false) {
        model.expires_at = Set(None);
    } else if let Some(raw) = &input.expires_at {
        model.expires_at = Set(Some(parse_expiry(raw)?));
    }
    dedication::Entity::update(model)
        .exec_without_returning(&txn)
        .await
        .map_err(internal)?;

    if let Some(purpose_type_ids) = &input.purpose_type_ids {
        validate_purposes(&txn, purpose_type_ids).await?;
        dedication_dedication_type::Entity::delete_many()
            .filter(dedication_dedication_type::Column::DedicationId.eq(id))
            .exec(&txn)
            .await
            .map_err(internal)?;
        insert_purposes(&txn, id, purpose_type_ids).await?;
    }

    if let Some(targets) = &input.targets {
        let validated = validate_targets(&txn, targets).await?;
        delete_all_links(&txn, id).await?;
        insert_targets(&txn, id, &validated).await?;
    }

    txn.commit().await.map_err(internal)?;
    find_aggregate(db, id).await
}

/// Deletes a dedication and all its assignments/purpose links atomically.
/// Returns false when nothing was removed.
pub async fn remove(db: &Database, id: i32) -> Result<bool, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(internal)?;
    delete_all_links(&txn, id).await?;
    let result = dedication::Entity::delete_by_id(id)
        .exec(&txn)
        .await
        .map_err(internal)?;
    txn.commit().await.map_err(internal)?;
    Ok(result.rows_affected > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dtos::dedication::DedicationScopeKind;
    use chrono::NaiveDateTime;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult};

    fn ts(value: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    const NOW: &str = "2030-06-15 12:00:00";

    fn dedication_model(
        id: i32,
        subject: &str,
        expires_at: Option<NaiveDateTime>,
    ) -> dedication::Model {
        dedication::Model {
            id,
            subject: subject.to_string(),
            expires_at,
        }
    }

    fn sefer_model(id: i32, from: i32, to: i32) -> sefer::Model {
        sefer::Model {
            id,
            name: format!("sefer-{id}"),
            tanach_us_name: None,
            perek_id_from: from,
            perek_id_to: to,
        }
    }

    fn helek_model(id: i32, from: i32, to: i32) -> helek::Model {
        helek::Model {
            id,
            name: format!("helek-{id}"),
            sefer_id_from: from,
            sefer_id_to: to,
        }
    }

    fn db_err(msg: &str) -> DbErr {
        DbErr::Custom(msg.to_string())
    }

    fn exec_results(n: usize, last_insert_id: u64, rows_affected: u64) -> Vec<MockExecResult> {
        (0..n)
            .map(|_| MockExecResult {
                last_insert_id,
                rows_affected,
            })
            .collect()
    }

    #[test]
    fn is_active_boundary_semantics() {
        let now = ts(NOW);
        assert!(is_active(None, now));
        assert!(is_active(Some(ts("2030-06-15 12:00:01")), now));
        // The expiry instant itself is the first hidden moment.
        assert!(!is_active(Some(ts(NOW)), now));
        assert!(!is_active(Some(ts("2030-06-15 11:59:59")), now));
    }

    #[test]
    fn parse_expiry_accepts_rfc3339_and_naive_utc() {
        assert_eq!(
            parse_expiry("2030-01-02T03:04:05Z").unwrap(),
            ts("2030-01-02 03:04:05")
        );
        // An offset input normalizes to UTC.
        assert_eq!(
            parse_expiry("2030-01-02T05:04:05+02:00").unwrap(),
            ts("2030-01-02 03:04:05")
        );
        assert_eq!(
            parse_expiry("2030-01-02 03:04:05").unwrap(),
            ts("2030-01-02 03:04:05")
        );
        assert_eq!(
            parse_expiry("2030-01-02T03:04:05").unwrap(),
            ts("2030-01-02 03:04:05")
        );
    }

    #[test]
    fn parse_expiry_rejects_bare_dates_and_garbage() {
        assert!(parse_expiry("2030-01-02").is_err());
        assert!(parse_expiry("not a date").is_err());
        assert!(parse_expiry("").is_err());
    }

    #[test]
    fn expand_ancestors_maps_perek_to_sefer_to_helek() {
        let sefers = vec![sefer_model(1, 1, 50), sefer_model(7, 212, 232)];
        let heleks = vec![helek_model(1, 1, 5), helek_model(2, 6, 24)];
        let ctx = DedicationContext {
            perek_ids: vec![220],
            ..Default::default()
        };
        let (sefer_ids, helek_ids) = expand_ancestors(&ctx, &sefers, &heleks);
        assert_eq!(sefer_ids, vec![7]);
        assert_eq!(helek_ids, vec![2]);
    }

    #[test]
    fn expand_ancestors_preserves_supplied_ids_and_dedupes() {
        let sefers = vec![sefer_model(1, 1, 50)];
        let heleks = vec![helek_model(1, 1, 5)];
        let ctx = DedicationContext {
            perek_ids: vec![10, 20],
            sefer_ids: vec![1],
            helek_ids: vec![1],
            ..Default::default()
        };
        let (sefer_ids, helek_ids) = expand_ancestors(&ctx, &sefers, &heleks);
        assert_eq!(sefer_ids, vec![1]);
        assert_eq!(helek_ids, vec![1]);
    }

    #[test]
    fn normalize_subject_trims_and_rejects_empty() {
        assert_eq!(normalize_subject("  מרדכי  ").unwrap(), "מרדכי");
        assert!(normalize_subject("   ").is_err());
        assert!(normalize_subject("").is_err());
    }

    #[test]
    fn target_key_distinguishes_every_kind() {
        let keys = [
            target_key(&ScopeTarget::Perek { low: 1, high: 2 }),
            target_key(&ScopeTarget::Sefer { sefer_id: 2 }),
            target_key(&ScopeTarget::Helek { helek_id: 2 }),
            target_key(&ScopeTarget::Parasha { parasha_id: 2 }),
            target_key(&ScopeTarget::Article { article_id: 2 }),
            target_key(&ScopeTarget::TanahpediaEntry {
                entry_id: "e".into(),
            }),
            target_key(&ScopeTarget::Masora),
        ];
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len());
    }

    #[tokio::test]
    async fn resolve_combines_perek_range_and_sefer_and_helek_ancestors() {
        // Context: perek 220 — inside sefer 7 (212-232) and helek 2 (6-24).
        let now = ts(NOW);
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            // sefer::all
            .append_query_results::<sefer::Model, Vec<sefer::Model>, _>([vec![
                sefer_model(7, 212, 232),
            ]])
            // helek::all
            .append_query_results::<helek::Model, Vec<helek::Model>, _>([vec![
                helek_model(2, 6, 24),
            ]])
            // perek_dedication::all — one in range, one out of range, one expired
            .append_query_results::<
                perek_dedication::Model,
                Vec<perek_dedication::Model>,
                _,
            >([vec![
                perek_dedication::Model {
                    perek_id_low: 218,
                    perek_id_high: 221,
                    dedication_id: 9,
                    expires_at: None,
                },
                perek_dedication::Model {
                    perek_id_low: 1,
                    perek_id_high: 5,
                    dedication_id: 99,
                    expires_at: None,
                },
                perek_dedication::Model {
                    perek_id_low: 219,
                    perek_id_high: 220,
                    dedication_id: 88,
                    expires_at: Some(ts(NOW)),
                },
            ]])
            // sefer_dedication::all — sefer 7 match (same dedication → dedup)
            .append_query_results::<
                sefer_dedication::Model,
                Vec<sefer_dedication::Model>,
                _,
            >([vec![sefer_dedication::Model {
                sefer_id: 7,
                dedication_id: 9,
                expires_at: None,
                created_at: ts("2020-01-01 00:00:00"),
            }]])
            // helek_dedication::all — helek 2 match, dedication 10
            .append_query_results::<
                helek_dedication::Model,
                Vec<helek_dedication::Model>,
                _,
            >([vec![helek_dedication::Model {
                helek_id: 2,
                dedication_id: 10,
                expires_at: None,
                created_at: ts("2020-01-01 00:00:00"),
            }]])
            // dedication::find in {9,10}
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "יעל בת רחל", None),
                dedication_model(10, "whole-helek dedication", None),
            ]])
            // dedication_dedication_type links
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![dedication_dedication_type::Model {
                dedication_id: 9,
                dedication_type_id: 1,
            }]])
            // dedication_type::all
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![dedication_type::Model {
                id: 1,
                description: "לע\"נ".into(),
            }]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = resolve(
            &db,
            DedicationContext {
                perek_ids: vec![220],
                ..Default::default()
            },
            now,
        )
        .await
        .unwrap();

        assert_eq!(out.len(), 2);
        let ded9 = &out[0];
        assert_eq!(ded9.dedication.id, 9);
        assert_eq!(ded9.dedication.subject, "יעל בת רחל");
        assert_eq!(ded9.purposes, vec!["לע\"נ".to_string()]);
        assert_eq!(ded9.scopes.len(), 2);
        assert_eq!(out[1].scopes[0].target, ScopeTarget::Helek { helek_id: 2 });
        assert!(out.iter().all(|a| a.dedication.id != 88));
        assert!(out.iter().all(|a| a.dedication.id != 99));
    }

    #[tokio::test]
    async fn resolve_drops_fully_expired_dedication() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<
                article_dedication::Model,
                Vec<article_dedication::Model>,
                _,
            >([vec![article_dedication::Model {
                article_id: 5,
                dedication_id: 9,
                expires_at: None,
            }]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "expired", Some(ts(NOW))),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = resolve(
            &db,
            DedicationContext {
                article_ids: vec![5],
                ..Default::default()
            },
            ts(NOW),
        )
        .await
        .unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn resolve_masora_context_returns_feature_scope_once() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<
                masora_dedication::Model,
                Vec<masora_dedication::Model>,
                _,
            >([vec![masora_dedication::Model {
                dedication_id: 7,
                expires_at: None,
                created_at: ts("2020-01-01 00:00:00"),
            }]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(7, "masora dedication", None),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = resolve(
            &db,
            DedicationContext {
                masora: true,
                ..Default::default()
            },
            ts(NOW),
        )
        .await
        .unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0].scopes,
            vec![ScopeMatch {
                target: ScopeTarget::Masora,
                expires_at: None,
            }]
        );
    }

    #[tokio::test]
    async fn resolve_entry_and_parasha_contexts() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<
                parasha_dedication::Model,
                Vec<parasha_dedication::Model>,
                _,
            >([vec![parasha_dedication::Model {
                parasha_id: 12,
                dedication_id: 3,
                expires_at: None,
                created_at: ts("2020-01-01 00:00:00"),
            }]])
            .append_query_results::<
                tanahpedia_entry_dedication::Model,
                Vec<tanahpedia_entry_dedication::Model>,
                _,
            >([vec![tanahpedia_entry_dedication::Model {
                entry_id: "entry-1".into(),
                dedication_id: 4,
                expires_at: None,
                created_at: ts("2020-01-01 00:00:00"),
            }]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(3, "parasha ded", None),
                dedication_model(4, "entry ded", None),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = resolve(
            &db,
            DedicationContext {
                parasha_ids: vec![12],
                entry_ids: vec!["entry-1".into()],
                ..Default::default()
            },
            ts(NOW),
        )
        .await
        .unwrap();
        assert_eq!(out.len(), 2);
    }

    #[tokio::test]
    async fn resolve_empty_context_returns_empty() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let out = resolve(&db, DedicationContext::default(), ts(NOW))
            .await
            .unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn resolve_propagates_db_errors() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_errors([db_err("down")])
            .into_connection();
        let db = Database::from_connection(mock);
        let err = resolve(
            &db,
            DedicationContext {
                perek_ids: vec![1],
                ..Default::default()
            },
            ts(NOW),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::InternalServerError(_)));
    }

    #[tokio::test]
    async fn list_all_includes_expired_assignments() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<
                perek_dedication::Model,
                Vec<perek_dedication::Model>,
                _,
            >([vec![perek_dedication::Model {
                perek_id_low: 1,
                perek_id_high: 2,
                dedication_id: 9,
                expires_at: Some(ts("2000-01-01 00:00:00")),
            }]])
            .append_query_results::<
                sefer_dedication::Model,
                Vec<sefer_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                helek_dedication::Model,
                Vec<helek_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                parasha_dedication::Model,
                Vec<parasha_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                article_dedication::Model,
                Vec<article_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                tanahpedia_entry_dedication::Model,
                Vec<tanahpedia_entry_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                masora_dedication::Model,
                Vec<masora_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "expired dedication", Some(ts("2000-01-01 00:00:00"))),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = list_all(&db).await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dedication.id, 9);
        assert_eq!(out[0].scopes[0].expires_at, Some(ts("2000-01-01 00:00:00")));
    }

    fn empty_link_tables(mock: MockDatabase) -> MockDatabase {
        mock.append_query_results::<
            perek_dedication::Model,
            Vec<perek_dedication::Model>,
            _,
        >([vec![]])
        .append_query_results::<sefer_dedication::Model, Vec<sefer_dedication::Model>, _>([vec![]])
        .append_query_results::<helek_dedication::Model, Vec<helek_dedication::Model>, _>([vec![]])
        .append_query_results::<
            parasha_dedication::Model,
            Vec<parasha_dedication::Model>,
            _,
        >([vec![]])
        .append_query_results::<
            article_dedication::Model,
            Vec<article_dedication::Model>,
            _,
        >([vec![]])
        .append_query_results::<
            tanahpedia_entry_dedication::Model,
            Vec<tanahpedia_entry_dedication::Model>,
            _,
        >([vec![]])
        .append_query_results::<
            masora_dedication::Model,
            Vec<masora_dedication::Model>,
            _,
        >([vec![]])
    }

    #[tokio::test]
    async fn list_all_includes_targetless_dedication() {
        // A dedication with no assignments still lists — keying the admin
        // view off link rows alone hid it (#2731).
        let mock = empty_link_tables(MockDatabase::new(DatabaseBackend::MySql))
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "לרפואה שלמה", None),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = list_all(&db).await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dedication.id, 9);
        assert!(out[0].scopes.is_empty());
    }

    #[tokio::test]
    async fn create_with_no_targets_returns_the_stored_aggregate() {
        // Regression (#2731): an unassigned creation committed fine, then
        // the post-commit reload reported Not Found because the listing
        // keyed off assignment rows alone.
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            // insert dedication
            .append_exec_results(exec_results(1, 42, 1));
        // find_aggregate → list_all: empty link tables + the new row.
        let mock = empty_link_tables(mock)
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([
                vec![dedication_model(42, "x", None)],
            ])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = create(&db, "x".into(), None, vec![], vec![]).await.unwrap();
        assert_eq!(out.dedication.id, 42);
        assert!(out.scopes.is_empty());
    }

    fn target_input(
        kind: DedicationScopeKind,
        f: impl Fn(&mut crate::dtos::dedication::DedicationTargetInput),
    ) -> crate::dtos::dedication::DedicationTargetInput {
        let mut input = crate::dtos::dedication::DedicationTargetInput {
            kind,
            perek_id_low: None,
            perek_id_high: None,
            sefer_id: None,
            helek_id: None,
            parasha_id: None,
            article_id: None,
            entry_id: None,
            expires_at: None,
        };
        f(&mut input);
        input
    }

    #[tokio::test]
    async fn create_rejects_inverted_perek_range_before_writing() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let err = create(
            &db,
            "x".into(),
            None,
            vec![],
            vec![target_input(DedicationScopeKind::Perek, |i| {
                i.perek_id_low = Some(50);
                i.perek_id_high = Some(40);
            })],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_rejects_missing_target_fields() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        for input in [
            target_input(DedicationScopeKind::Perek, |i| {
                i.perek_id_low = Some(1);
            }),
            target_input(DedicationScopeKind::Sefer, |_| {}),
            target_input(DedicationScopeKind::Helek, |_| {}),
            target_input(DedicationScopeKind::Parasha, |_| {}),
            target_input(DedicationScopeKind::Article, |_| {}),
            target_input(DedicationScopeKind::TanahpediaEntry, |_| {}),
        ] {
            let err = create(&db, "x".into(), None, vec![], vec![input])
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)), "{err}");
        }
    }

    #[tokio::test]
    async fn create_rejects_unknown_sefer_helek_article_and_entry() {
        // Each iteration consumes exactly one empty lookup result.
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<sefer::Model, Vec<sefer::Model>, _>([vec![]])
            .append_query_results::<helek::Model, Vec<helek::Model>, _>([vec![]])
            .append_query_results::<article::Model, Vec<article::Model>, _>([vec![]])
            .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);
        for input in [
            target_input(DedicationScopeKind::Sefer, |i| i.sefer_id = Some(999)),
            target_input(DedicationScopeKind::Helek, |i| i.helek_id = Some(9)),
            target_input(DedicationScopeKind::Article, |i| {
                i.article_id = Some(424242)
            }),
            target_input(DedicationScopeKind::TanahpediaEntry, |i| {
                i.entry_id = Some("missing".into())
            }),
        ] {
            let err = create(&db, "x".into(), None, vec![], vec![input])
                .await
                .unwrap_err();
            assert!(matches!(err, ServiceError::BadRequest(_)), "{err}");
        }
    }

    #[tokio::test]
    async fn create_rejects_noncanonical_perek_bounds() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<entities::perek::Model, Vec<entities::perek::Model>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(mock);
        let err = create(
            &db,
            "x".into(),
            None,
            vec![],
            vec![target_input(DedicationScopeKind::Perek, |i| {
                i.perek_id_low = Some(930);
                i.perek_id_high = Some(940);
            })],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_rejects_nonpositive_parasha_id() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let err = create(
            &db,
            "x".into(),
            None,
            vec![],
            vec![target_input(DedicationScopeKind::Parasha, |i| {
                i.parasha_id = Some(0);
            })],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_rejects_unknown_purpose() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<dedication_type::Model, Vec<dedication_type::Model>, _>([
                vec![],
            ])
            .into_connection();
        let db = Database::from_connection(mock);
        let err = create(&db, "x".into(), None, vec![77], vec![])
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_rejects_duplicate_targets_in_one_request() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<sefer::Model, Vec<sefer::Model>, _>([vec![sefer_model(
                7, 212, 232,
            )]])
            .append_query_results::<sefer::Model, Vec<sefer::Model>, _>([vec![sefer_model(
                7, 212, 232,
            )]])
            .into_connection();
        let db = Database::from_connection(mock);
        let err = create(
            &db,
            "x".into(),
            None,
            vec![],
            vec![
                target_input(DedicationScopeKind::Sefer, |i| i.sefer_id = Some(7)),
                target_input(DedicationScopeKind::Sefer, |i| i.sefer_id = Some(7)),
            ],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn create_rejects_empty_subject_and_bad_expiry() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        assert!(matches!(
            create(&db, "  ".into(), None, vec![], vec![])
                .await
                .unwrap_err(),
            ServiceError::BadRequest(_)
        ));
        assert!(matches!(
            create(&db, "x".into(), Some("soon".into()), vec![], vec![])
                .await
                .unwrap_err(),
            ServiceError::BadRequest(_)
        ));
    }

    #[tokio::test]
    async fn create_persists_sefer_dedication_end_to_end() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            // validate purpose id 1
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![dedication_type::Model {
                id: 1,
                description: "לע\"נ".into(),
            }]])
            // validate sefer 24
            .append_query_results::<sefer::Model, Vec<sefer::Model>, _>([vec![
                sefer_model(24, 565, 567),
            ]])
            // insert dedication + purpose link + sefer link
            .append_exec_results(exec_results(3, 42, 1))
            // find_aggregate → list_all: sefer link row + 6 empty tables
            .append_query_results::<
                perek_dedication::Model,
                Vec<perek_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                sefer_dedication::Model,
                Vec<sefer_dedication::Model>,
                _,
            >([vec![sefer_dedication::Model {
                sefer_id: 24,
                dedication_id: 42,
                expires_at: None,
                created_at: ts("2030-01-01 00:00:00"),
            }]])
            .append_query_results::<
                helek_dedication::Model,
                Vec<helek_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                parasha_dedication::Model,
                Vec<parasha_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                article_dedication::Model,
                Vec<article_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                tanahpedia_entry_dedication::Model,
                Vec<tanahpedia_entry_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                masora_dedication::Model,
                Vec<masora_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(42, "מרדכי בן זאב", None),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![dedication_dedication_type::Model {
                dedication_id: 42,
                dedication_type_id: 1,
            }]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![dedication_type::Model {
                id: 1,
                description: "לע\"נ".into(),
            }]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = create(
            &db,
            "מרדכי בן זאב".into(),
            None,
            vec![1],
            vec![target_input(DedicationScopeKind::Sefer, |i| {
                i.sefer_id = Some(24);
            })],
        )
        .await
        .unwrap();

        assert_eq!(out.dedication.id, 42);
        assert_eq!(out.purposes, vec!["לע\"נ".to_string()]);
        assert_eq!(
            out.scopes,
            vec![ScopeMatch {
                target: ScopeTarget::Sefer { sefer_id: 24 },
                expires_at: None,
            }]
        );
    }

    #[tokio::test]
    async fn update_missing_dedication_is_not_found() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);
        let err = update(
            &db,
            9,
            UpdateDedicationInput {
                subject: Some("new".into()),
                expires_at: None,
                clear_expires_at: None,
                purpose_type_ids: None,
                targets: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn update_applies_subject_and_clear_expiry() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "old", Some(ts("2031-01-01 00:00:00"))),
            ]])
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            // find_aggregate → list_all: perek link row + 6 empty tables
            .append_query_results::<
                perek_dedication::Model,
                Vec<perek_dedication::Model>,
                _,
            >([vec![perek_dedication::Model {
                perek_id_low: 565,
                perek_id_high: 565,
                dedication_id: 9,
                expires_at: None,
            }]])
            .append_query_results::<
                sefer_dedication::Model,
                Vec<sefer_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                helek_dedication::Model,
                Vec<helek_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                parasha_dedication::Model,
                Vec<parasha_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                article_dedication::Model,
                Vec<article_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                tanahpedia_entry_dedication::Model,
                Vec<tanahpedia_entry_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                masora_dedication::Model,
                Vec<masora_dedication::Model>,
                _,
            >([vec![]])
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "new", None),
            ]])
            .append_query_results::<
                dedication_dedication_type::Model,
                Vec<dedication_dedication_type::Model>,
                _,
            >([vec![]])
            .append_query_results::<
                dedication_type::Model,
                Vec<dedication_type::Model>,
                _,
            >([vec![]])
            .into_connection();
        let db = Database::from_connection(mock);

        let out = update(
            &db,
            9,
            UpdateDedicationInput {
                subject: Some("new".into()),
                expires_at: None,
                clear_expires_at: Some(true),
                purpose_type_ids: None,
                targets: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(out.dedication.id, 9);
        assert_eq!(out.dedication.expires_at, None);
    }

    #[tokio::test]
    async fn remove_returns_false_for_unknown_id() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(exec_results(9, 0, 0))
            .into_connection();
        let db = Database::from_connection(mock);
        assert!(!remove(&db, 1234).await.unwrap());
    }

    #[tokio::test]
    async fn remove_returns_true_when_row_deleted() {
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(exec_results(8, 0, 0))
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock);
        assert!(remove(&db, 1).await.unwrap());
    }
}
