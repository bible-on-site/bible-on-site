use std::collections::HashMap;

use chrono::{NaiveDateTime, Utc};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter, Set,
    Statement, TransactionTrait, Value,
};

use crate::common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError};
use crate::common::website_revalidate::{DedicationAssignments, PerekRange, WebsiteRevalidator};
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

/// Union branch kinds for the single-query scans below.
pub(crate) const KIND_SEFER: i32 = 0;
pub(crate) const KIND_HELEK: i32 = 1;
pub(crate) const KIND_PEREK: i32 = 2;
pub(crate) const KIND_SEFER_DED: i32 = 3;
pub(crate) const KIND_HELEK_DED: i32 = 4;
pub(crate) const KIND_PARASHA: i32 = 5;
pub(crate) const KIND_ARTICLE: i32 = 6;
pub(crate) const KIND_ENTRY: i32 = 7;
pub(crate) const KIND_MASORA: i32 = 8;

/// One row of the UNION ALL read, shaped like `UnionRow` — shared by the
/// service, resolver, and schema test fixtures.
#[cfg(test)]
pub(crate) fn urow(
    kind: i32,
    c1: Option<i32>,
    c2: Option<i32>,
    c3: Option<i32>,
    c4: Option<&str>,
    expires_at: Option<NaiveDateTime>,
) -> std::collections::BTreeMap<String, Value> {
    [
        ("kind".to_string(), kind.into()),
        ("c1".to_string(), c1.into()),
        ("c2".to_string(), c2.into()),
        ("c3".to_string(), c3.into()),
        ("c4".to_string(), c4.map(str::to_string).into()),
        ("expires_at".to_string(), expires_at.into()),
    ]
    .into_iter()
    .collect()
}

/// One normalized row of the dedications UNION read. Resolving a context
/// needs rows from up to a dozen small tables (canonical sefer/helek ranges
/// plus one assignment table per scope kind); fetching them as `UNION ALL`
/// branches keeps each lookup to one round trip on one connection instead of
/// ~10 sequential scans (which was also ~10 connection acquisitions).
#[derive(Debug, Clone, PartialEq, FromQueryResult)]
struct UnionRow {
    /// Which branch of the union produced the row.
    kind: i32,
    /// sefer/helek/scope id fields — meaning depends on `kind`.
    c1: Option<i32>,
    c2: Option<i32>,
    c3: Option<i32>,
    /// entry_id.
    c4: Option<String>,
    /// Assignment-level expiry (UTC wall-clock); `None` = ongoing.
    expires_at: Option<NaiveDateTime>,
}

/// The SELECT of one assignment-table branch (no WHERE — callers append the
/// predicate their query needs). Branch order matches `kind` ascending, the
/// same order the sequential queries used to run in.
fn scope_branch(kind: i32) -> &'static str {
    match kind {
        KIND_PEREK => {
            "SELECT 2 AS kind, dedication_id AS c1, perek_id_low AS c2, perek_id_high AS c3, NULL AS c4, expires_at FROM tanah_perek_dedication"
        }
        KIND_SEFER_DED => {
            "SELECT 3 AS kind, dedication_id AS c1, sefer_id AS c2, NULL AS c3, NULL AS c4, expires_at FROM tanah_sefer_dedication"
        }
        KIND_HELEK_DED => {
            "SELECT 4 AS kind, dedication_id AS c1, helek_id AS c2, NULL AS c3, NULL AS c4, expires_at FROM tanah_helek_dedication"
        }
        KIND_PARASHA => {
            "SELECT 5 AS kind, dedication_id AS c1, parasha_id AS c2, NULL AS c3, NULL AS c4, expires_at FROM tanah_parasha_dedication"
        }
        KIND_ARTICLE => {
            "SELECT 6 AS kind, dedication_id AS c1, article_id AS c2, NULL AS c3, NULL AS c4, expires_at FROM tanah_article_dedication"
        }
        KIND_ENTRY => {
            "SELECT 7 AS kind, dedication_id AS c1, NULL AS c2, NULL AS c3, entry_id AS c4, expires_at FROM tanahpedia_entry_dedication"
        }
        KIND_MASORA => {
            "SELECT 8 AS kind, dedication_id AS c1, NULL AS c2, NULL AS c3, NULL AS c4, expires_at FROM tanah_masora_dedication"
        }
        other => unreachable!("unknown union kind {other}"),
    }
}

const CANONICAL_UNION: &str = "SELECT 0 AS kind, id AS c1, perek_id_from AS c2, perek_id_to AS c3, NULL AS c4, NULL AS expires_at FROM tanah_sefer\nUNION ALL\nSELECT 1 AS kind, id AS c1, sefer_id_from AS c2, sefer_id_to AS c3, NULL AS c4, NULL AS expires_at FROM tanah_helek";

/// The SQL form of `is_active`: NULL or strictly-in-future expiry.
const ACTIVE_SQL: &str = "(expires_at IS NULL OR expires_at > ?)";

/// Runs `sql` (a UNION ALL over `scope_branch`/canonical selects) and returns
/// normalized rows. `ORDER BY kind` keeps bucket order deterministic —
/// UNION ALL branch order is not guaranteed by the engine.
async fn union_scan(
    conn: &impl ConnectionTrait,
    sql: String,
    values: Vec<Value>,
) -> Result<Vec<UnionRow>, ServiceError> {
    UnionRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        format!("{sql}\nORDER BY kind"),
        values,
    ))
    .all(conn)
    .await
    .map_err(internal)
}

/// Expands perek/sefer context ids into their ancestor sefer/helek ids using
/// the canonical range tables (docs/data/dedications.md). `sefers`/`heleks`
/// are `(id, range_low, range_high)` tuples from the canonical union scan.
fn expand_ancestors(
    ctx: &DedicationContext,
    sefers: &[(i32, i32, i32)],
    heleks: &[(i32, i32, i32)],
) -> (Vec<i32>, Vec<i32>) {
    let mut sefer_ids: Vec<i32> = ctx.sefer_ids.clone();
    for perek_id in &ctx.perek_ids {
        if let Some((id, _, _)) = sefers
            .iter()
            .find(|(_, lo, hi)| lo <= perek_id && perek_id <= hi)
            && !sefer_ids.contains(id)
        {
            sefer_ids.push(*id);
        }
    }
    let mut helek_ids: Vec<i32> = ctx.helek_ids.clone();
    for sefer_id in &sefer_ids {
        if let Some((id, _, _)) = heleks
            .iter()
            .find(|(_, lo, hi)| lo <= sefer_id && sefer_id <= hi)
            && !helek_ids.contains(id)
        {
            helek_ids.push(*id);
        }
    }
    (sefer_ids, helek_ids)
}

/// Decodes one assignment row of the union into a `ScopeMatch`.
fn scope_of(row: &UnionRow) -> Option<(i32, ScopeMatch)> {
    let dedication_id = row.c1?;
    let target = match row.kind {
        KIND_PEREK => ScopeTarget::Perek {
            low: row.c2?,
            high: row.c3?,
        },
        KIND_SEFER_DED => ScopeTarget::Sefer { sefer_id: row.c2? },
        KIND_HELEK_DED => ScopeTarget::Helek { helek_id: row.c2? },
        KIND_PARASHA => ScopeTarget::Parasha {
            parasha_id: row.c2?,
        },
        KIND_ARTICLE => ScopeTarget::Article {
            article_id: row.c2?,
        },
        KIND_ENTRY => ScopeTarget::TanahpediaEntry {
            entry_id: row.c4.clone()?,
        },
        KIND_MASORA => ScopeTarget::Masora,
        _ => return None,
    };
    Some((
        dedication_id,
        ScopeMatch {
            target,
            expires_at: row.expires_at,
        },
    ))
}

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
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
    let conn = db.get_connection();
    let needs_ancestors = !ctx.perek_ids.is_empty() || !ctx.sefer_ids.is_empty();
    // The canonical tables are tiny; one UNION read fetches both.
    let (sefers, heleks) = if needs_ancestors {
        let rows = union_scan(conn, CANONICAL_UNION.to_string(), Vec::new()).await?;
        let mut sefers = Vec::new();
        let mut heleks = Vec::new();
        for row in rows {
            match (row.kind, row.c1, row.c2, row.c3) {
                (KIND_SEFER, Some(id), Some(lo), Some(hi)) => sefers.push((id, lo, hi)),
                (KIND_HELEK, Some(id), Some(lo), Some(hi)) => heleks.push((id, lo, hi)),
                _ => {}
            }
        }
        (sefers, heleks)
    } else {
        (Vec::new(), Vec::new())
    };
    let (sefer_ids, helek_ids) = expand_ancestors(&ctx, &sefers, &heleks);

    // Link tables grow with every dedication purchased: one UNION ALL read
    // over the needed scope tables, each branch carrying the same target +
    // activity filter the sequential queries used to apply.
    let mut branches: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    fn filtered(
        branches: &mut Vec<String>,
        values: &mut Vec<Value>,
        kind: i32,
        cond: String,
        now: NaiveDateTime,
    ) {
        values.push(now.into());
        branches.push(format!(
            "{} WHERE {cond} AND {ACTIVE_SQL}",
            scope_branch(kind)
        ));
    }
    if !ctx.perek_ids.is_empty() {
        let cond =
            vec!["(perek_id_low <= ? AND perek_id_high >= ?)"; ctx.perek_ids.len()].join(" OR ");
        for p in &ctx.perek_ids {
            values.push((*p).into());
            values.push((*p).into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_PEREK,
            format!("({cond})"),
            now,
        );
    }
    if !sefer_ids.is_empty() {
        for id in &sefer_ids {
            values.push((*id).into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_SEFER_DED,
            format!("sefer_id IN ({})", placeholders(sefer_ids.len())),
            now,
        );
    }
    if !helek_ids.is_empty() {
        for id in &helek_ids {
            values.push((*id).into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_HELEK_DED,
            format!("helek_id IN ({})", placeholders(helek_ids.len())),
            now,
        );
    }
    if !ctx.parasha_ids.is_empty() {
        for id in &ctx.parasha_ids {
            values.push((*id).into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_PARASHA,
            format!("parasha_id IN ({})", placeholders(ctx.parasha_ids.len())),
            now,
        );
    }
    if !ctx.article_ids.is_empty() {
        for id in &ctx.article_ids {
            values.push((*id).into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_ARTICLE,
            format!("article_id IN ({})", placeholders(ctx.article_ids.len())),
            now,
        );
    }
    if !ctx.entry_ids.is_empty() {
        for id in &ctx.entry_ids {
            values.push(id.clone().into());
        }
        filtered(
            &mut branches,
            &mut values,
            KIND_ENTRY,
            format!("entry_id IN ({})", placeholders(ctx.entry_ids.len())),
            now,
        );
    }
    if ctx.masora {
        branches.push(format!("{} WHERE {ACTIVE_SQL}", scope_branch(KIND_MASORA)));
        values.push(now.into());
    }

    let matched: Vec<(i32, ScopeMatch)> = if branches.is_empty() {
        Vec::new()
    } else {
        union_scan(conn, branches.join("\nUNION ALL\n"), values)
            .await?
            .iter()
            .filter_map(scope_of)
            .collect()
    };

    if matched.is_empty() {
        return Ok(Vec::new());
    }
    let mut ids: Vec<i32> = matched.iter().map(|(id, _)| *id).collect();
    ids.sort_unstable();
    ids.dedup();
    let dedications = dedication::Entity::find()
        .filter(dedication::Column::Id.is_in(ids))
        .all(conn)
        .await
        .map_err(internal)?;
    hydrate(db, dedications, matched, true, now).await
}

/// Loads every assignment row across the seven link tables — one UNION ALL
/// read instead of seven sequential scans — or only one dedication's rows
/// when `dedication_id` is given.
async fn link_scopes(
    conn: &impl ConnectionTrait,
    dedication_id: Option<i32>,
) -> Result<Vec<(i32, ScopeMatch)>, ServiceError> {
    let kinds = [
        KIND_PEREK,
        KIND_SEFER_DED,
        KIND_HELEK_DED,
        KIND_PARASHA,
        KIND_ARTICLE,
        KIND_ENTRY,
        KIND_MASORA,
    ];
    let mut values: Vec<Value> = Vec::new();
    let sql = kinds
        .iter()
        .map(|kind| {
            if let Some(id) = dedication_id {
                values.push(id.into());
                format!("{} WHERE dedication_id = ?", scope_branch(*kind))
            } else {
                scope_branch(*kind).to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\nUNION ALL\n");
    let rows = union_scan(conn, sql, values).await?;
    Ok(rows.iter().filter_map(scope_of).collect())
}

/// Admin listing: every dedication with every assignment, including expired —
/// management must still inspect and edit lapsed rows.
pub async fn list_all(db: &Database) -> Result<Vec<DedicationAggregate>, ServiceError> {
    let matched = link_scopes(db.get_connection(), None).await?;
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

/// Deletes every assignment row of a dedication across all target tables — the
/// FK cascades normally do this, but doing it explicitly keeps the delete
/// correct even on a legacy schema where the guarded FK could not be added.
/// Purpose links are independent and must survive target replacement.
async fn delete_targets(
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
    Ok(())
}

fn normalize_subject(subject: &str) -> Result<String, ServiceError> {
    let trimmed = subject.trim();
    if trimmed.is_empty() {
        return Err(ServiceError::bad_request("Subject must not be empty"));
    }
    Ok(trimmed.to_string())
}

/// A mutation outcome: the stored aggregate plus the post-commit website
/// invalidation status — `FAILED` means the write committed but public
/// pages have not expired yet, so callers can surface that explicitly.
#[derive(Debug)]
pub struct WriteOutcome {
    pub aggregate: DedicationAggregate,
    pub revalidation: &'static str,
}

/// Folds one dedication's scope matches into the invalidation shape —
/// sorted + deduplicated so union-of-old-and-new is idempotent.
fn assignments_of(matches: &[(i32, ScopeMatch)]) -> DedicationAssignments {
    let mut out = DedicationAssignments::default();
    for (_, scope) in matches {
        match &scope.target {
            ScopeTarget::Perek { low, high } => out.perek_ranges.push(PerekRange {
                low: *low,
                high: *high,
            }),
            ScopeTarget::Sefer { sefer_id } => out.sefer_ids.push(*sefer_id),
            ScopeTarget::Helek { helek_id } => out.helek_ids.push(*helek_id),
            ScopeTarget::Parasha { parasha_id } => out.parasha_ids.push(*parasha_id),
            ScopeTarget::Article { article_id } => out.article_ids.push(*article_id),
            ScopeTarget::TanahpediaEntry { entry_id } => out.entry_ids.push(entry_id.clone()),
            ScopeTarget::Masora => out.masora = true,
        }
    }
    out
}

/// Merges the old and new assignment snapshots — every surface either set
/// rendered on must expire.
fn union_assignments(
    old: &[(i32, ScopeMatch)],
    new: &[(i32, ScopeMatch)],
) -> DedicationAssignments {
    let mut out = assignments_of(old);
    let new_side = assignments_of(new);
    out.perek_ranges.extend(new_side.perek_ranges);
    out.sefer_ids.extend(new_side.sefer_ids);
    out.helek_ids.extend(new_side.helek_ids);
    out.parasha_ids.extend(new_side.parasha_ids);
    out.article_ids.extend(new_side.article_ids);
    out.entry_ids.extend(new_side.entry_ids);
    out.masora = out.masora || new_side.masora;
    out.perek_ranges.sort_by_key(|r| (r.low, r.high));
    out.perek_ranges.dedup_by_key(|r| (r.low, r.high));
    out.sefer_ids.sort_unstable();
    out.sefer_ids.dedup();
    out.helek_ids.sort_unstable();
    out.helek_ids.dedup();
    out.parasha_ids.sort_unstable();
    out.parasha_ids.dedup();
    out.article_ids.sort_unstable();
    out.article_ids.dedup();
    out.entry_ids.sort();
    out.entry_ids.dedup();
    out
}

/// Post-commit invalidation for a dedication write — expires every scoped
/// surface the old ∪ new assignments render on (#3102). Logged on failure
/// and reported to the caller so a stale public page is never silent.
async fn revalidate_dedication(
    revalidator: &WebsiteRevalidator,
    dedication_id: i32,
    old: &[(i32, ScopeMatch)],
    new: &[(i32, ScopeMatch)],
) -> &'static str {
    revalidator
        .invalidate_dedication(dedication_id, &union_assignments(old, new))
        .await
        .as_str()
}

/// Creates a dedication with its purposes and validated targets in one
/// transaction. Returns the stored aggregate (every assignment attached).
pub async fn create(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    subject: String,
    expires_at: Option<String>,
    purpose_type_ids: Vec<i32>,
    targets: Vec<DedicationTargetInput>,
) -> Result<WriteOutcome, ServiceError> {
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

    let aggregate = find_aggregate(db, id).await?;
    let new_matches: Vec<(i32, ScopeMatch)> = aggregate
        .scopes
        .iter()
        .map(|scope| (id, scope.clone()))
        .collect();
    let revalidation = revalidate_dedication(revalidator, id, &[], &new_matches).await;
    Ok(WriteOutcome {
        aggregate,
        revalidation,
    })
}

/// Reloads one dedication with all its assignments and purposes — the
/// post-write read mutations return.
async fn find_aggregate(db: &Database, id: i32) -> Result<DedicationAggregate, ServiceError> {
    let model = dedication::Entity::find_by_id(id)
        .one(db.get_connection())
        .await
        .map_err(internal)?
        .ok_or_else(|| ServiceError::not_found("Dedication Not Found", None::<ServiceError>))?;
    let matched = link_scopes(db.get_connection(), Some(id)).await?;
    let mut aggregates = hydrate(db, vec![model], matched, false, Utc::now().naive_utc()).await?;
    Ok(aggregates.remove(0))
}

/// Applies field/subject/expiry changes plus optional full purpose/target
/// replacement sets, atomically.
pub async fn update(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    id: i32,
    input: UpdateDedicationInput,
) -> Result<WriteOutcome, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(internal)?;

    let existing = dedication::Entity::find_by_id(id)
        .one(&txn)
        .await
        .map_err(internal)?
        .ok_or_else(|| ServiceError::not_found("Dedication Not Found", None::<ServiceError>))?;

    // The pre-write assignment set — subject/purpose edits also expire these
    // surfaces since the dedication's text renders on them.
    let old_matches = link_scopes(&txn, Some(id)).await?;

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
        delete_targets(&txn, id).await?;
        insert_targets(&txn, id, &validated).await?;
    }

    txn.commit().await.map_err(internal)?;
    let aggregate = find_aggregate(db, id).await?;
    let new_matches: Vec<(i32, ScopeMatch)> = aggregate
        .scopes
        .iter()
        .map(|scope| (id, scope.clone()))
        .collect();
    let revalidation = revalidate_dedication(revalidator, id, &old_matches, &new_matches).await;
    Ok(WriteOutcome {
        aggregate,
        revalidation,
    })
}

/// Deletes a dedication and all its assignments/purpose links atomically.
/// Returns false when nothing was removed.
pub async fn remove(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    id: i32,
) -> Result<bool, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(internal)?;
    // The assignment set must be captured before the delete — the website
    // expires the surfaces those targets render on.
    let old_matches = link_scopes(&txn, Some(id)).await?;
    delete_targets(&txn, id).await?;
    dedication_dedication_type::Entity::delete_many()
        .filter(dedication_dedication_type::Column::DedicationId.eq(id))
        .exec(&txn)
        .await
        .map_err(internal)?;
    let result = dedication::Entity::delete_by_id(id)
        .exec(&txn)
        .await
        .map_err(internal)?;
    txn.commit().await.map_err(internal)?;
    if result.rows_affected > 0 {
        // The bool result cannot carry the invalidation status — surface a
        // failed expiry loudly in logs instead (the public pages still hold
        // the deleted dedication until the revalidate succeeds).
        let revalidation = revalidate_dedication(revalidator, id, &old_matches, &[]).await;
        if revalidation == "FAILED" {
            tracing::error!(
                dedication_id = id,
                "dedication delete committed but website revalidation failed"
            );
        }
    }
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

    /// A revalidator that always reports SKIPPED — deterministic for unit
    /// tests (no WEBSITE_URL/REVALIDATE_SECRET influence).
    fn rv() -> crate::common::website_revalidate::WebsiteRevalidator {
        crate::common::website_revalidate::WebsiteRevalidator::new(None, None)
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
        let sefers = vec![(1, 1, 50), (7, 212, 232)];
        let heleks = vec![(1, 1, 5), (2, 6, 24)];
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
        let sefers = vec![(1, 1, 50)];
        let heleks = vec![(1, 1, 5)];
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
            // canonical union: sefer 7 (212-232), helek 2 (6-24)
            .append_query_results([vec![
                urow(KIND_SEFER, Some(7), Some(212), Some(232), None, None),
                urow(KIND_HELEK, Some(2), Some(6), Some(24), None, None),
            ]])
            // link union — one in range, one out of range, one expired
            .append_query_results([vec![
                urow(KIND_PEREK, Some(9), Some(218), Some(221), None, None),
                urow(KIND_PEREK, Some(99), Some(1), Some(5), None, None),
                urow(KIND_PEREK, Some(88), Some(219), Some(220), None, Some(ts(NOW))),
                urow(KIND_SEFER_DED, Some(9), Some(7), None, None, None),
                urow(KIND_HELEK_DED, Some(10), Some(2), None, None, None),
            ]])
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
            .append_query_results([vec![urow(
                KIND_ARTICLE,
                Some(9),
                Some(5),
                None,
                None,
                None,
            )]])
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
            .append_query_results([vec![urow(
                KIND_MASORA,
                Some(7),
                None,
                None,
                None,
                None,
            )]])
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
            .append_query_results([vec![
                urow(KIND_PARASHA, Some(3), Some(12), None, None, None),
                urow(KIND_ENTRY, Some(4), None, None, Some("entry-1"), None),
            ]])
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
            .append_query_results([vec![urow(
                KIND_PEREK,
                Some(9),
                Some(1),
                Some(2),
                None,
                Some(ts("2000-01-01 00:00:00")),
            )]])
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

    /// One empty UNION ALL result — the link scans run as a single union read.
    fn empty_link_tables(mock: MockDatabase) -> MockDatabase {
        mock.append_query_results::<
            std::collections::BTreeMap<String, Value>,
            Vec<std::collections::BTreeMap<String, Value>>,
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
        // find_aggregate: the new row, then its (empty) link tables.
        let mock = mock.append_query_results::<dedication::Model, Vec<dedication::Model>, _>([
            vec![dedication_model(42, "x", None)],
        ]);
        let mock = empty_link_tables(mock)
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

        let out = create(&db, &rv(), "x".into(), None, vec![], vec![])
            .await
            .unwrap();
        assert_eq!(out.aggregate.dedication.id, 42);
        assert!(out.aggregate.scopes.is_empty());
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
            &rv(),
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
            let err = create(&db, &rv(), "x".into(), None, vec![], vec![input])
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
            let err = create(&db, &rv(), "x".into(), None, vec![], vec![input])
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
            &rv(),
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
            &rv(),
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
        let err = create(&db, &rv(), "x".into(), None, vec![77], vec![])
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
            &rv(),
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
            create(&db, &rv(), "  ".into(), None, vec![], vec![])
                .await
                .unwrap_err(),
            ServiceError::BadRequest(_)
        ));
        assert!(matches!(
            create(&db, &rv(), "x".into(), Some("soon".into()), vec![], vec![])
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
            // find_aggregate: the new row, then its union of link rows.
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(42, "מרדכי בן זאב", None),
            ]])
            .append_query_results([vec![urow(
                KIND_SEFER_DED,
                Some(42),
                Some(24),
                None,
                None,
                None,
            )]])
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
            &rv(),
            "מרדכי בן זאב".into(),
            None,
            vec![1],
            vec![target_input(DedicationScopeKind::Sefer, |i| {
                i.sefer_id = Some(24);
            })],
        )
        .await
        .unwrap();

        assert_eq!(out.aggregate.dedication.id, 42);
        assert_eq!(out.aggregate.purposes, vec!["לע\"נ".to_string()]);
        assert_eq!(
            out.aggregate.scopes,
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
            &rv(),
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
            ]]);
        // The pre-write link read feeding the old∪new invalidation payload.
        let mock = empty_link_tables(mock)
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            // find_aggregate: the row, then its union of link rows.
            .append_query_results::<dedication::Model, Vec<dedication::Model>, _>([vec![
                dedication_model(9, "new", None),
            ]])
            .append_query_results([vec![urow(
                KIND_PEREK,
                Some(9),
                Some(565),
                Some(565),
                None,
                None,
            )]])
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
            &rv(),
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
        assert_eq!(out.aggregate.dedication.id, 9);
        assert_eq!(out.aggregate.dedication.expires_at, None);
    }

    #[tokio::test]
    async fn remove_returns_false_for_unknown_id() {
        let mock = empty_link_tables(MockDatabase::new(DatabaseBackend::MySql))
            .append_exec_results(exec_results(9, 0, 0))
            .into_connection();
        let db = Database::from_connection(mock);
        assert!(!remove(&db, &rv(), 1234).await.unwrap());
    }

    #[tokio::test]
    async fn remove_returns_true_when_row_deleted() {
        let mock = empty_link_tables(MockDatabase::new(DatabaseBackend::MySql))
            .append_exec_results(exec_results(8, 0, 0))
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock);
        assert!(remove(&db, &rv(), 1).await.unwrap());
    }

    #[tokio::test]
    async fn update_target_replacement_preserves_purposes() {
        for replace_purposes in [false, true] {
            let mock = MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results([vec![dedication_model(9, "subject", None)]]);
            // Pre-write link read (old ∪ new invalidation payload).
            let mut mock = empty_link_tables(mock)
                // Extra result lets this test observe an unintended purpose deletion too.
                .append_exec_results(exec_results(12, 0, 1));
            if replace_purposes {
                mock = mock.append_query_results([vec![dedication_type::Model {
                    id: 1,
                    description: "purpose".into(),
                }]]);
            }
            let mock = mock.append_query_results([vec![dedication_model(9, "subject", None)]]);
            let mock = empty_link_tables(mock)
                .append_query_results([vec![dedication_dedication_type::Model {
                    dedication_id: 9,
                    dedication_type_id: 1,
                }]])
                .append_query_results([vec![dedication_type::Model {
                    id: 1,
                    description: "purpose".into(),
                }]]);
            let db = Database::from_connection(mock.into_connection());
            let result = update(
                &db,
                &rv(),
                9,
                UpdateDedicationInput {
                    subject: None,
                    expires_at: None,
                    clear_expires_at: None,
                    purpose_type_ids: replace_purposes.then_some(vec![1]),
                    targets: Some(vec![]),
                },
            )
            .await
            .unwrap();
            assert_eq!(result.aggregate.purposes, ["purpose"]);
            assert!(result.aggregate.scopes.is_empty());
            let log = db.get_connection().clone().into_transaction_log();
            let sql = format!("{log:?}");
            assert_eq!(
                sql.matches("DELETE FROM `tanah_dedication_dedication_type`")
                    .count(),
                usize::from(replace_purposes),
                "target replacement must not delete purpose links: {sql}"
            );
            assert_eq!(
                sql.matches("DELETE FROM `tanah_masora_dedication`").count(),
                1
            );
        }
    }

    #[tokio::test]
    async fn assignment_inserts_keep_target_identity_and_expiry_for_every_scope() {
        let expiry = ts("2032-01-02 03:04:05");
        let targets = [
            (
                ScopeTarget::Perek { low: 1, high: 50 },
                "tanah_perek_dedication",
            ),
            (
                ScopeTarget::Sefer { sefer_id: 24 },
                "tanah_sefer_dedication",
            ),
            (ScopeTarget::Helek { helek_id: 2 }, "tanah_helek_dedication"),
            (
                ScopeTarget::Parasha { parasha_id: 3 },
                "tanah_parasha_dedication",
            ),
            (
                ScopeTarget::Article { article_id: 19 },
                "tanah_article_dedication",
            ),
            (
                ScopeTarget::TanahpediaEntry {
                    entry_id: "entry-1".into(),
                },
                "tanahpedia_entry_dedication",
            ),
            (ScopeTarget::Masora, "tanah_masora_dedication"),
        ];
        for expires_at in [None, Some(expiry)] {
            for (target, table) in &targets {
                let conn = MockDatabase::new(DatabaseBackend::MySql)
                    .append_exec_results(exec_results(1, 0, 1))
                    .into_connection();
                insert_targets(
                    &conn,
                    17,
                    &[ValidatedTarget {
                        target: target.clone(),
                        expires_at,
                    }],
                )
                .await
                .unwrap();
                let log = conn.into_transaction_log();
                let sql = format!("{log:?}");
                assert!(sql.contains(&format!("INSERT INTO `{table}`")), "{sql}");
                assert!(
                    sql.contains("dedication_id") && sql.contains("expires_at"),
                    "{sql}"
                );
                assert!(sql.contains("17"), "{sql}");
                if expires_at.is_some() {
                    assert!(sql.contains("2032-01-02"), "{sql}");
                } else {
                    assert!(sql.contains("None"), "{sql}");
                }
                match target {
                    ScopeTarget::Perek { .. } => {
                        assert!(sql.contains("perek_id_low") && sql.contains("perek_id_high"))
                    }
                    ScopeTarget::TanahpediaEntry { .. } => assert!(sql.contains("entry-1")),
                    _ => {}
                }
            }
        }
    }

    #[tokio::test]
    async fn repeated_purpose_ids_insert_one_link() {
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_exec_results(exec_results(2, 0, 1))
            .into_connection();
        insert_purposes(&conn, 17, &[1, 1, 2, 2]).await.unwrap();
        let sql = format!("{:?}", conn.into_transaction_log());
        assert_eq!(
            sql.matches("INSERT INTO `tanah_dedication_dedication_type`")
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn invalid_assignment_expiry_rolls_back_without_writing() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());
        let error = create(
            &db,
            &rv(),
            "subject".into(),
            None,
            vec![],
            vec![target_input(DedicationScopeKind::Masora, |target| {
                target.expires_at = Some("2032-01-01".into());
            })],
        )
        .await
        .unwrap_err();
        assert!(matches!(error, ServiceError::BadRequest(_)));
        let sql = format!("{:?}", db.get_connection().clone().into_transaction_log());
        assert!(sql.contains("ROLLBACK"), "{sql}");
        assert!(!sql.contains("INSERT INTO"), "{sql}");
    }

    fn canonical_perek(id: i32) -> entities::perek::Model {
        entities::perek::Model {
            id,
            perek_id: Some(id),
            sefer_id: Some(1),
            sefer_name: None,
            additional: None,
            additional_letter: None,
            perek: None,
            perek_in_context: None,
            date: None,
            hebdate: None,
            tseit: None,
            header: None,
            pasuk_count: None,
        }
    }

    #[tokio::test]
    async fn target_validation_accepts_each_real_identity_and_normalizes_expiry() {
        let now = ts(NOW);
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![canonical_perek(1)], vec![canonical_perek(50)]])
            .append_query_results([vec![sefer_model(1, 1, 50)]])
            .append_query_results([vec![helek_model(1, 1, 5)]])
            .append_query_results([vec![article::Model {
                id: 19,
                perek_id: 1,
                author_id: 1,
                article_abstract: None,
                name: "article".into(),
                priority: 0,
                content: None,
                coverage_verified: false,
            }]])
            .append_query_results([vec![entry::Model {
                id: "entry-1".into(),
                unique_name: "Entry".into(),
                title: "Entry".into(),
                content: None,
                created_at: now,
                updated_at: now,
            }]])
            .into_connection();
        let inputs = [
            (
                target_input(DedicationScopeKind::Perek, |i| {
                    i.perek_id_low = Some(1);
                    i.perek_id_high = Some(50);
                }),
                ScopeTarget::Perek { low: 1, high: 50 },
            ),
            (
                target_input(DedicationScopeKind::Sefer, |i| i.sefer_id = Some(1)),
                ScopeTarget::Sefer { sefer_id: 1 },
            ),
            (
                target_input(DedicationScopeKind::Helek, |i| i.helek_id = Some(1)),
                ScopeTarget::Helek { helek_id: 1 },
            ),
            (
                target_input(DedicationScopeKind::Parasha, |i| i.parasha_id = Some(3)),
                ScopeTarget::Parasha { parasha_id: 3 },
            ),
            (
                target_input(DedicationScopeKind::Article, |i| i.article_id = Some(19)),
                ScopeTarget::Article { article_id: 19 },
            ),
            (
                target_input(DedicationScopeKind::TanahpediaEntry, |i| {
                    i.entry_id = Some("entry-1".into())
                }),
                ScopeTarget::TanahpediaEntry {
                    entry_id: "entry-1".into(),
                },
            ),
            (
                target_input(DedicationScopeKind::Masora, |_| {}),
                ScopeTarget::Masora,
            ),
        ];
        for (mut input, expected) in inputs {
            input.expires_at = Some("2030-06-15T15:00:00+03:00".into());
            let validated = validate_target(&conn, &input).await.unwrap();
            assert_eq!(validated.target, expected);
            assert_eq!(validated.expires_at, Some(now));
        }
    }

    #[tokio::test]
    async fn perek_validation_rejects_missing_high_bound_even_when_low_exists() {
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![canonical_perek(1)], vec![]])
            .into_connection();
        let error = validate_target(
            &conn,
            &target_input(DedicationScopeKind::Perek, |i| {
                i.perek_id_low = Some(1);
                i.perek_id_high = Some(930);
            }),
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(error, ServiceError::BadRequest(_)));
    }

    #[tokio::test]
    async fn article_resolution_filters_unmatched_and_expired_assignments() {
        let now = ts(NOW);
        let conn = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![
                urow(KIND_ARTICLE, Some(1), Some(19), None, None, Some(now)),
                urow(KIND_ARTICLE, Some(2), Some(20), None, None, None),
                urow(KIND_ARTICLE, Some(3), Some(19), None, None, None),
            ]])
            .append_query_results([vec![dedication_model(3, "active", None)]])
            .append_query_results::<dedication_dedication_type::Model, Vec<_>, _>([vec![]])
            .append_query_results::<dedication_type::Model, Vec<_>, _>([vec![]])
            .into_connection();
        let db = Database::from_connection(conn);
        let out = resolve(
            &db,
            DedicationContext {
                article_ids: vec![19],
                ..Default::default()
            },
            now,
        )
        .await
        .unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].dedication.id, 3);
        assert_eq!(
            out[0].scopes,
            [ScopeMatch {
                target: ScopeTarget::Article { article_id: 19 },
                expires_at: None
            }]
        );
    }

    #[tokio::test]
    async fn update_sets_expiry_in_utc_without_replacing_targets_or_purposes() {
        let expiry = ts("2030-06-15 12:00:00");
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![dedication_model(9, "subject", None)]]);
        // Pre-write link read (old ∪ new invalidation payload).
        let mock = empty_link_tables(mock).append_exec_results(exec_results(1, 0, 1));
        let mock = mock.append_query_results([vec![dedication_model(9, "subject", Some(expiry))]]);
        let mock = empty_link_tables(mock)
            .append_query_results::<dedication_dedication_type::Model, Vec<_>, _>([vec![]])
            .append_query_results::<dedication_type::Model, Vec<_>, _>([vec![]]);
        let db = Database::from_connection(mock.into_connection());
        let result = update(
            &db,
            &rv(),
            9,
            UpdateDedicationInput {
                subject: None,
                expires_at: Some("2030-06-15T15:00:00+03:00".into()),
                clear_expires_at: Some(false),
                purpose_type_ids: None,
                targets: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(result.aggregate.dedication.expires_at, Some(expiry));
        let sql = format!("{:?}", db.get_connection().clone().into_transaction_log());
        assert!(
            sql.contains("UPDATE `tanah_dedication` SET `expires_at` = ?"),
            "{sql}"
        );
        assert!(sql.contains("2030-06-15T12:00:00"), "{sql}");
        assert!(!sql.contains("DELETE FROM"), "{sql}");
    }

    #[tokio::test]
    async fn empty_admin_listing_returns_empty_without_loading_purpose_links() {
        let mock = empty_link_tables(MockDatabase::new(DatabaseBackend::MySql))
            .append_query_results::<dedication::Model, Vec<_>, _>([vec![]])
            .append_query_results::<dedication_type::Model, Vec<_>, _>([vec![]]);
        let db = Database::from_connection(mock.into_connection());
        assert!(list_all(&db).await.unwrap().is_empty());
        let sql = format!("{:?}", db.get_connection().clone().into_transaction_log());
        assert!(
            !sql.contains("FROM `tanah_dedication_dedication_type`"),
            "{sql}"
        );
    }

    #[test]
    #[should_panic(expected = "unknown union kind 99")]
    fn scope_branch_rejects_an_unknown_union_kind() {
        scope_branch(99);
    }

    #[test]
    fn scope_of_ignores_an_unknown_union_kind() {
        let row = UnionRow {
            kind: 99,
            c1: Some(5),
            c2: Some(1),
            c3: None,
            c4: None,
            expires_at: None,
        };
        assert!(scope_of(&row).is_none());
    }

    #[test]
    fn union_assignments_collects_every_scope_kind() {
        let scope = |target| ScopeMatch {
            target,
            expires_at: None,
        };
        let old = vec![
            (5, scope(ScopeTarget::Helek { helek_id: 2 })),
            (5, scope(ScopeTarget::Article { article_id: 7 })),
        ];
        let new = vec![
            (5, scope(ScopeTarget::Parasha { parasha_id: 9 })),
            (
                5,
                scope(ScopeTarget::TanahpediaEntry {
                    entry_id: "entry-1".to_string(),
                }),
            ),
            (5, scope(ScopeTarget::Masora)),
        ];
        let merged = union_assignments(&old, &new);
        assert_eq!(merged.helek_ids, [2]);
        assert_eq!(merged.article_ids, [7]);
        assert_eq!(merged.parasha_ids, [9]);
        assert_eq!(merged.entry_ids, ["entry-1".to_string()]);
        assert!(merged.masora);
    }

    #[tokio::test]
    async fn resolve_ignores_unknown_canonical_union_rows() {
        // A forward-compatible row the decoder does not recognize is skipped,
        // not fatal.
        let mock = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([vec![urow(99, Some(1), Some(1), Some(5), None, None)]])
            .append_query_results::<
                std::collections::BTreeMap<String, Value>,
                Vec<std::collections::BTreeMap<String, Value>>,
                _,
            >([vec![]]);
        let db = Database::from_connection(mock.into_connection());
        let resolved = resolve(
            &db,
            DedicationContext {
                perek_ids: vec![1],
                ..Default::default()
            },
            ts(NOW),
        )
        .await
        .unwrap();
        assert!(resolved.is_empty());
    }

    #[tokio::test]
    async fn remove_reports_a_failed_post_commit_revalidation() {
        // The delete committed; only the website expiry failed — the write
        // still reports success and the failure is logged.
        let mock = empty_link_tables(MockDatabase::new(DatabaseBackend::MySql))
            .append_exec_results(exec_results(8, 0, 0))
            .append_exec_results([MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();
        let db = Database::from_connection(mock);
        let failing = crate::common::website_revalidate::WebsiteRevalidator::new(
            Some("http://127.0.0.1:1".to_string()),
            Some("s".to_string()),
        );
        assert!(remove(&db, &failing, 1).await.unwrap());
    }
}
