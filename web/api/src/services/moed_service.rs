//! מועדים על הפרק (#3101): the public catalogue read and the authorized
//! catalogue write path behind `upsertMoed`/`deleteMoed`.
//!
//! - `moadim` / `moed(slug)` expose published moadim with their ordered
//!   labelled sections and inclusive canonical ranges.
//! - `Moed.articles` resolves the deduplicated union of explicit article
//!   links and scripture-range matches, under the same coverage semantics as
//!   the website (`coverage_verified` -> covering rows, otherwise the
//!   primary perek fallback — never fabricated pasuk precision).
//! - Writes run in one transaction, validate slugs/order/range bounds, and
//!   post a `moed` entity change per affected old ∪ new slug.

use std::collections::{BTreeSet, HashMap};

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, ExprTrait,
    FromQueryResult, QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait,
};

use crate::common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError};
use crate::common::website_revalidate::WebsiteRevalidator;
use crate::dtos::article::Article;
use crate::dtos::moed::{Moed, MoedRange, MoedSection, UpsertMoedInput};
use crate::providers::Database;
use crate::services::articles_service;
use entities::{article_moed, moed, moed_range, moed_section, perek};

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

const MOED_NOT_FOUND: &str = "Moed Not Found";

/// The aggregate shape the resolvers return — the moed row plus its ordered
/// sections (each with ordered ranges) and its explicit article links.
#[derive(Debug)]
pub struct MoedAggregate {
    pub moed: moed::Model,
    pub sections: Vec<(moed_section::Model, Vec<moed_range::Model>)>,
    pub explicit_article_ids: Vec<i32>,
}

impl From<MoedAggregate> for Moed {
    fn from(value: MoedAggregate) -> Self {
        Self {
            id: value.moed.id,
            slug: value.moed.slug,
            name: value.moed.name,
            summary: value.moed.summary,
            hebrew_month: value.moed.hebrew_month,
            date_label: value.moed.date_label,
            annual_order: value.moed.annual_order as i32,
            published: value.moed.published,
            sections: value
                .sections
                .into_iter()
                .map(|(section, ranges)| MoedSection {
                    id: section.id,
                    label: section.label,
                    position: section.position as i32,
                    ranges: ranges
                        .into_iter()
                        .map(|range| MoedRange {
                            id: range.id,
                            position: range.position as i32,
                            perek_id_start: range.perek_id_start,
                            pasuk_start: range.pasuk_start as i32,
                            perek_id_end: range.perek_id_end,
                            pasuk_end: range.pasuk_end as i32,
                        })
                        .collect(),
                })
                .collect(),
            explicit_article_ids: value.explicit_article_ids,
        }
    }
}

/// Loads the ordered sections+ranges of one moed, in display order.
async fn load_sections(
    conn: &impl ConnectionTrait,
    moed_id: i32,
) -> Result<Vec<(moed_section::Model, Vec<moed_range::Model>)>, ServiceError> {
    let sections = moed_section::Entity::find()
        .filter(moed_section::Column::MoedId.eq(moed_id))
        .order_by_asc(moed_section::Column::Position)
        .all(conn)
        .await
        .map_err(db_error)?;
    if sections.is_empty() {
        return Ok(Vec::new());
    }
    let section_ids: Vec<i32> = sections.iter().map(|s| s.id).collect();
    let ranges = moed_range::Entity::find()
        .filter(moed_range::Column::SectionId.is_in(section_ids))
        .order_by_asc(moed_range::Column::SectionId)
        .order_by_asc(moed_range::Column::Position)
        .all(conn)
        .await
        .map_err(db_error)?;
    let mut by_section: HashMap<i32, Vec<moed_range::Model>> = HashMap::new();
    for range in ranges {
        by_section.entry(range.section_id).or_default().push(range);
    }
    Ok(sections
        .into_iter()
        .map(|section| {
            let ranges = by_section.remove(&section.id).unwrap_or_default();
            (section, ranges)
        })
        .collect())
}

/// Loads the article ids explicitly linked to one moed (junction only — the
/// range-matched side is computed by the union read).
async fn load_explicit_article_ids(
    conn: &impl ConnectionTrait,
    moed_id: i32,
) -> Result<Vec<i32>, ServiceError> {
    let links = article_moed::Entity::find()
        .filter(article_moed::Column::MoedId.eq(moed_id))
        .order_by_asc(article_moed::Column::ArticleId)
        .all(conn)
        .await
        .map_err(db_error)?;
    Ok(links.into_iter().map(|link| link.article_id).collect())
}

/// The moed aggregate by slug. `published_only` hides drafts from the public
/// surface (a draft's detail page is a normal not-found).
pub async fn load_by_slug(
    conn: &impl ConnectionTrait,
    slug: &str,
    published_only: bool,
) -> Result<Option<MoedAggregate>, ServiceError> {
    let mut finder = moed::Entity::find().filter(moed::Column::Slug.eq(slug));
    if published_only {
        finder = finder.filter(moed::Column::Published.eq(true));
    }
    let Some(model) = finder.one(conn).await.map_err(db_error)? else {
        return Ok(None);
    };
    let sections = load_sections(conn, model.id).await?;
    let explicit_article_ids = load_explicit_article_ids(conn, model.id).await?;
    Ok(Some(MoedAggregate {
        moed: model,
        sections,
        explicit_article_ids,
    }))
}

/// The moed aggregate by id (admin path — drafts included).
async fn load_by_id(
    conn: &impl ConnectionTrait,
    moed_id: i32,
) -> Result<Option<MoedAggregate>, ServiceError> {
    let Some(model) = moed::Entity::find_by_id(moed_id)
        .one(conn)
        .await
        .map_err(db_error)?
    else {
        return Ok(None);
    };
    let sections = load_sections(conn, model.id).await?;
    let explicit_article_ids = load_explicit_article_ids(conn, model.id).await?;
    Ok(Some(MoedAggregate {
        moed: model,
        sections,
        explicit_article_ids,
    }))
}

/// Public catalogue — published moadim in wheel order.
pub async fn list_published(conn: &impl ConnectionTrait) -> Result<Vec<Moed>, ServiceError> {
    list_where(conn, true).await
}

/// Management catalogue — every moed including drafts, in wheel order.
pub async fn list_all(conn: &impl ConnectionTrait) -> Result<Vec<Moed>, ServiceError> {
    list_where(conn, false).await
}

async fn list_where(
    conn: &impl ConnectionTrait,
    published_only: bool,
) -> Result<Vec<Moed>, ServiceError> {
    let mut finder = moed::Entity::find();
    if published_only {
        finder = finder.filter(moed::Column::Published.eq(true));
    }
    let moadim = finder
        .order_by_asc(moed::Column::AnnualOrder)
        .all(conn)
        .await
        .map_err(db_error)?;
    let mut out = Vec::with_capacity(moadim.len());
    for model in moadim {
        let sections = load_sections(conn, model.id).await?;
        let explicit_article_ids = load_explicit_article_ids(conn, model.id).await?;
        out.push(
            MoedAggregate {
                moed: model,
                sections,
                explicit_article_ids,
            }
            .into(),
        );
    }
    Ok(out)
}

/// All ranges of a moed across its sections, flattened in display order —
/// the range set the union article read matches against.
fn all_ranges(dto: &Moed) -> Vec<MoedRange> {
    dto.sections
        .iter()
        .flat_map(|section| section.ranges.iter().cloned())
        .collect()
}

/// One per-perek slice of a range list — the query granularity shared with
/// the website (`PerekSlice`): a range crossing perakim clips its first/
/// last pasuk at the bounds and includes whole perakim in between.
#[derive(Debug, Clone, Copy)]
struct Slice {
    slice_order: i32,
    perek_id: i32,
    start_pasuk: i32,
    end_pasuk: i32,
}

/// Expands inclusive ranges into per-perek slices, preserving supplied order:
/// first perek of a range starts at `pasuk_start`, last ends at `pasuk_end`,
/// interior perakim are whole. `pasuk_count` supplies the canonical bound —
/// mirroring `rangesPerekSlices` in the website reading lib.
fn slices_for_ranges(ranges: &[MoedRange], pasuk_count: &HashMap<i32, i32>) -> Vec<Slice> {
    let mut slices = Vec::new();
    for range in ranges {
        for perek_id in range.perek_id_start..=range.perek_id_end {
            let Some(&count) = pasuk_count.get(&perek_id) else {
                continue;
            };
            let start = if perek_id == range.perek_id_start {
                range.pasuk_start
            } else {
                1
            };
            let end = if perek_id == range.perek_id_end {
                range.pasuk_end
            } else {
                count
            };
            if start <= end {
                slices.push(Slice {
                    slice_order: slices.len() as i32,
                    perek_id,
                    start_pasuk: start,
                    end_pasuk: end,
                });
            }
        }
    }
    slices
}

/// The derived-table SELECT list numbering each slice by its ordinal — same
/// idiom as the website's `sliceOrdinalSelects`.
fn slice_ordinal_selects(slices: &[Slice]) -> (String, Vec<sea_orm::Value>) {
    let mut params: Vec<sea_orm::Value> = Vec::new();
    let selects: Vec<String> = slices
        .iter()
        .map(|slice| {
            params.push(slice.perek_id.into());
            params.push(slice.start_pasuk.into());
            params.push(slice.end_pasuk.into());
            format!(
                "SELECT {} AS slice_order, ? AS perek_id, ? AS start_pasuk, ? AS end_pasuk",
                slice.slice_order
            )
        })
        .collect();
    (selects.join(" UNION ALL "), params)
}

#[derive(Debug, FromQueryResult)]
struct UnionRow {
    id: i32,
}

/// The deduplicated union of the moed's explicit links and range-matched
/// articles — the read the public `Moed.articles` field and the website's
/// detail page share.
///
/// Coverage semantics (mirrors the website's `getArticleSummariesForRanges`):
/// a `coverage_verified` article matches when any covering row lands inside
/// a slice; an unverified one falls back to its primary perek. Explicit
/// links always match. Ordering: editorial priority, then first matched
/// slice order (explicit-only last within the priority tier), then id —
/// deterministic with a stable tie-breaker.
pub async fn articles_for_moed(db: &Database, dto: &Moed) -> Result<Vec<Article>, ServiceError> {
    let conn = db.get_connection();
    let ranges = all_ranges(dto);
    let perek_ids: Vec<i32> = {
        // Every perek a range touches — interior perakim count too.
        let mut ids: Vec<i32> = ranges
            .iter()
            .flat_map(|range| range.perek_id_start..=range.perek_id_end)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    };
    let counts = perek::Entity::find()
        .filter(perek::Column::Id.is_in(perek_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .filter_map(|model| model.pasuk_count.map(|count| (model.id, count as i32)))
        .collect::<HashMap<i32, i32>>();
    let slices = slices_for_ranges(&ranges, &counts);

    let (sql, params) = if slices.is_empty() {
        (
            "SELECT a.id FROM tanah_article a \
             WHERE EXISTS (SELECT 1 FROM tanah_article_moed am \
                 WHERE am.moed_id = ? AND am.article_id = a.id) \
             ORDER BY a.priority ASC, a.id ASC"
                .to_string(),
            vec![dto.id.into()],
        )
    } else {
        let (slices_sql, mut params) = slice_ordinal_selects(&slices);
        params.push(dto.id.into());
        (
            format!(
                "SELECT a.id FROM tanah_article a \
                 LEFT JOIN ({slices_sql}) sm ON (\
                     (a.coverage_verified = TRUE AND EXISTS (\
                         SELECT 1 FROM tanah_article_covering_source cs \
                         WHERE cs.article_id = a.id AND cs.perek_id = sm.perek_id \
                         AND cs.pasuk BETWEEN sm.start_pasuk AND sm.end_pasuk)) \
                     OR (a.coverage_verified = FALSE AND a.perek_id BETWEEN 1 AND 929 \
                         AND a.perek_id = sm.perek_id)) \
                 WHERE sm.perek_id IS NOT NULL OR EXISTS (\
                     SELECT 1 FROM tanah_article_moed am \
                     WHERE am.moed_id = ? AND am.article_id = a.id) \
                 GROUP BY a.id, a.priority \
                 ORDER BY a.priority ASC, (MIN(sm.slice_order) IS NULL) ASC, \
                     MIN(sm.slice_order) ASC, a.id ASC"
            ),
            params,
        )
    };
    let rows = UnionRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        sql,
        params,
    ))
    .all(conn)
    .await
    .map_err(db_error)?;
    let ids: Vec<i32> = rows.into_iter().map(|row| row.id).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let articles = articles_service::find_by_ids(db, &ids).await?;
    let mut covering_by_article =
        articles_service::find_covering_sources_by_article_ids(db, &ids).await?;
    let by_id: HashMap<i32, entities::article::Model> =
        articles.into_iter().map(|a| (a.id, a)).collect();
    Ok(ids
        .into_iter()
        .filter_map(|id| {
            by_id.get(&id).map(|model| {
                let mut article = Article::from(model.clone());
                article.covering_sources = Some(
                    covering_by_article
                        .remove(&id)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|row| crate::dtos::article::ArticleCoveringSource {
                            perek_id: row.perek_id,
                            pasuk: row.pasuk as i32,
                        })
                        .collect(),
                );
                article
            })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Authorized catalogue writes
// ---------------------------------------------------------------------------

/// Normalizes a caller-supplied or name-derived slug: trims, collapses
/// whitespace to ASCII hyphens and drops Hebrew quote marks, then validates
/// the Hebrew/Latin/digit/hyphen alphabet the public route accepts.
pub fn normalize_moed_slug(raw: &str) -> Result<String, ServiceError> {
    let slug = raw
        .replace(['\'', '"', '\u{05f3}', '\u{05f4}'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    let valid = !slug.is_empty()
        && slug.chars().all(|c| {
            c == '-'
                || c.is_ascii_alphanumeric()
                || ('\u{0590}'..='\u{05ff}').contains(&c)
        })
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--");
    if !valid || slug.chars().count() > 191 {
        return Err(ServiceError::bad_request(&format!(
            "invalid moed slug '{raw}' — use Hebrew letters, digits and single hyphens"
        )));
    }
    Ok(slug)
}

/// Validates one range's canonical bounds inside the transaction: both perek
/// ids exist in the corpus and carry pasuk_count, every pasuk sits inside
/// the bound, and the start coordinate does not come after the end.
async fn validate_ranges(
    conn: &impl ConnectionTrait,
    ranges: &[crate::dtos::moed::MoedRangeInput],
    section_label: &str,
) -> Result<(), ServiceError> {
    let perek_ids: BTreeSet<i32> = ranges
        .iter()
        .flat_map(|r| [r.perek_id_start, r.perek_id_end])
        .collect();
    let bounds: HashMap<i32, Option<i32>> = perek::Entity::find()
        .filter(perek::Column::Id.is_in(perek_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|model| (model.id, model.pasuk_count.map(|c| c as i32)))
        .collect();
    for (index, range) in ranges.iter().enumerate() {
        let field = format!("section '{section_label}' range {}", index + 1);
        for (perek_id, pasuk, bound_name) in [
            (range.perek_id_start, range.pasuk_start, "start"),
            (range.perek_id_end, range.pasuk_end, "end"),
        ] {
            match bounds.get(&perek_id) {
                None => {
                    return Err(ServiceError::bad_request(&format!(
                        "{field}: {bound_name} perek {perek_id} does not exist"
                    )));
                }
                Some(None) => {
                    return Err(ServiceError::bad_request(&format!(
                        "{field}: canonical pasuk count is missing for perek {perek_id}; apply tanah_perek_pasuk_count_data.sql"
                    )));
                }
                Some(Some(count)) => {
                    if pasuk < 1 || pasuk > *count {
                        return Err(ServiceError::bad_request(&format!(
                            "{field}: {bound_name} pasuk {pasuk} is out of range for perek {perek_id} (1-{count})"
                        )));
                    }
                }
            }
        }
        if (range.perek_id_start, range.pasuk_start) > (range.perek_id_end, range.pasuk_end) {
            return Err(ServiceError::bad_request(&format!(
                "{field}: the start coordinate comes after the end coordinate"
            )));
        }
    }
    Ok(())
}

/// Validates the whole write inside the transaction: name/slug/order and the
/// section/range structure. Conflict checks run under the row lock so the
/// reported conflicts are against committed state.
async fn validate_write(
    conn: &impl ConnectionTrait,
    input: &UpsertMoedInput,
    slug: &str,
) -> Result<(), ServiceError> {
    if input.name.trim().is_empty() {
        return Err(ServiceError::bad_request("moed name must not be empty"));
    }
    if input.annual_order < 1 {
        return Err(ServiceError::bad_request("annualOrder must be at least 1"));
    }
    let mut conflict = moed::Entity::find().filter(
        moed::Column::Slug
            .eq(slug)
            .or(moed::Column::AnnualOrder.eq(input.annual_order)),
    );
    if let Some(id) = input.id {
        conflict = conflict.filter(moed::Column::Id.ne(id));
    }
    if let Some(existing) = conflict.one(conn).await.map_err(db_error)? {
        if existing.slug == slug {
            return Err(ServiceError::bad_request(&format!(
                "moed slug '{slug}' is already used by moed {}",
                existing.id
            )));
        }
        return Err(ServiceError::bad_request(&format!(
            "annualOrder {} is already used by moed {}",
            input.annual_order, existing.id
        )));
    }
    if let Some(sections) = &input.sections {
        for section in sections {
            if section.label.trim().is_empty() {
                return Err(ServiceError::bad_request(
                    "moed section label must not be empty",
                ));
            }
            if section.ranges.is_empty() {
                return Err(ServiceError::bad_request(&format!(
                    "moed section '{}' must carry at least one range",
                    section.label
                )));
            }
            validate_ranges(conn, &section.ranges, &section.label).await?;
        }
    }
    Ok(())
}

/// `upsertMoed` — creates or updates a moed plus (when supplied) its full
/// ordered section set in one transaction. Ranges keep `created_at` of
/// untouched pairs only implicitly via replace; section positions derive
/// from list order so position conflicts are impossible.
pub async fn upsert_moed(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    input: UpsertMoedInput,
) -> Result<(Moed, &'static str), ServiceError> {
    let slug = normalize_moed_slug(
        input
            .slug
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(input.name.as_str()),
    )?;
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let previous = if let Some(id) = input.id {
        moed::Entity::find_by_id(id)
            .lock_exclusive()
            .one(&txn)
            .await
            .map_err(db_error)?
            .ok_or_else(|| ServiceError::not_found(MOED_NOT_FOUND, None::<sea_orm::DbErr>))
            .map(Some)?
    } else {
        None
    };
    validate_write(&txn, &input, &slug).await?;

    let model = moed::ActiveModel {
        id: input.id.map(sea_orm::Set).unwrap_or(sea_orm::NotSet),
        slug: sea_orm::Set(slug.clone()),
        name: sea_orm::Set(input.name.trim().to_string()),
        summary: sea_orm::Set(input.summary.clone().filter(|s| !s.trim().is_empty())),
        hebrew_month: sea_orm::Set(input.hebrew_month.clone()),
        date_label: sea_orm::Set(input.date_label.clone()),
        annual_order: sea_orm::Set(input.annual_order as i16),
        published: sea_orm::Set(input.published),
    };
    let saved = if input.id.is_some() {
        model.update(&txn).await.map_err(db_error)?
    } else {
        model.insert(&txn).await.map_err(db_error)?
    };

    if let Some(sections) = &input.sections {
        moed_section::Entity::delete_many()
            .filter(moed_section::Column::MoedId.eq(saved.id))
            .exec(&txn)
            .await
            .map_err(db_error)?;
        for (position, section) in sections.iter().enumerate() {
            let section_model = moed_section::ActiveModel {
                id: sea_orm::NotSet,
                moed_id: sea_orm::Set(saved.id),
                label: sea_orm::Set(section.label.trim().to_string()),
                position: sea_orm::Set((position + 1) as i16),
            };
            let saved_section = section_model.insert(&txn).await.map_err(db_error)?;
            for (range_position, range) in section.ranges.iter().enumerate() {
                moed_range::ActiveModel {
                    id: sea_orm::NotSet,
                    section_id: sea_orm::Set(saved_section.id),
                    position: sea_orm::Set((range_position + 1) as i16),
                    perek_id_start: sea_orm::Set(range.perek_id_start),
                    pasuk_start: sea_orm::Set(range.pasuk_start as i16),
                    perek_id_end: sea_orm::Set(range.perek_id_end),
                    pasuk_end: sea_orm::Set(range.pasuk_end as i16),
                }
                .insert(&txn)
                .await
                .map_err(db_error)?;
            }
        }
    }

    let previous_slug = previous.map(|model| model.slug);
    txn.commit().await.map_err(db_error)?;

    let aggregate = load_by_id(db.get_connection(), saved.id)
        .await?
        .ok_or_else(|| ServiceError::not_found(MOED_NOT_FOUND, None::<sea_orm::DbErr>))?;
    let dto: Moed = aggregate.into();
    let revalidation = revalidator
        .invalidate_moed(saved.id, &slug, previous_slug.as_deref())
        .await
        .as_str();
    Ok((dto, revalidation))
}

/// `deleteMoed` — removes the moed row; sections, ranges and article links
/// cascade without touching articles or scripture. The deleted slug rides
/// the invalidation so its prerendered page expires.
pub async fn delete_moed(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    moed_id: i32,
) -> Result<&'static str, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let model = moed::Entity::find_by_id(moed_id)
        .lock_exclusive()
        .one(&txn)
        .await
        .map_err(db_error)?
        .ok_or_else(|| ServiceError::not_found(MOED_NOT_FOUND, None::<sea_orm::DbErr>))?;
    let slug = model.slug.clone();
    moed::Entity::delete_by_id(moed_id)
        .exec(&txn)
        .await
        .map_err(db_error)?;
    txn.commit().await.map_err(db_error)?;
    Ok(revalidator
        .invalidate_moed(moed_id, &slug, Some(&slug))
        .await
        .as_str())
}

/// Loads the moed ids linked to an article (the `moadim` relationship read —
/// inside `update_relationships` transactions and the aggregate load).
pub async fn load_article_moed_links(
    conn: &impl ConnectionTrait,
    article_id: i32,
) -> Result<Vec<crate::dtos::article_relationships::ArticleMoedLink>, ServiceError> {
    let links = article_moed::Entity::find()
        .filter(article_moed::Column::ArticleId.eq(article_id))
        .order_by_asc(article_moed::Column::MoedId)
        .all(conn)
        .await
        .map_err(db_error)?;
    if links.is_empty() {
        return Ok(Vec::new());
    }
    let moed_ids: Vec<i32> = links.iter().map(|link| link.moed_id).collect();
    let moadim = moed::Entity::find()
        .filter(moed::Column::Id.is_in(moed_ids))
        .all(conn)
        .await
        .map_err(db_error)?;
    let by_id: HashMap<i32, moed::Model> = moadim.into_iter().map(|m| (m.id, m)).collect();
    Ok(links
        .into_iter()
        .filter_map(|link| {
            by_id.get(&link.moed_id).map(|moed| {
                crate::dtos::article_relationships::ArticleMoedLink {
                    moed_id: link.moed_id,
                    slug: moed.slug.clone(),
                    name: moed.name.clone(),
                }
            })
        })
        .collect())
}

/// Applies a full `moadim` link-set replacement inside the
/// `updateArticleRelationships` transaction: inserts only the added pairs
/// and removes only the dropped ones, so untouched pairs keep their
/// `created_at` and an identical set is a no-op.
pub async fn replace_article_moed_links(
    conn: &impl ConnectionTrait,
    article_id: i32,
    moed_ids: &[i32],
) -> Result<bool, ServiceError> {
    // Every id must reference a live moed — checked inside the lock.
    let existing = moed::Entity::find()
        .filter(moed::Column::Id.is_in(moed_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(db_error)?;
    let existing_ids: BTreeSet<i32> = existing.into_iter().map(|m| m.id).collect();
    for id in moed_ids {
        if !existing_ids.contains(id) {
            return Err(ServiceError::bad_request(&format!("Moed {id} does not exist")));
        }
    }
    let current = article_moed::Entity::find()
        .filter(article_moed::Column::ArticleId.eq(article_id))
        .all(conn)
        .await
        .map_err(db_error)?;
    let current_ids: BTreeSet<i32> = current.iter().map(|link| link.moed_id).collect();
    let wanted: BTreeSet<i32> = moed_ids.iter().copied().collect();
    let to_add: Vec<i32> = wanted.difference(&current_ids).copied().collect();
    let to_remove: Vec<i32> = current_ids.difference(&wanted).copied().collect();
    if to_add.is_empty() && to_remove.is_empty() {
        return Ok(false);
    }
    if !to_remove.is_empty() {
        article_moed::Entity::delete_many()
            .filter(article_moed::Column::ArticleId.eq(article_id))
            .filter(article_moed::Column::MoedId.is_in(to_remove))
            .exec(conn)
            .await
            .map_err(db_error)?;
    }
    if !to_add.is_empty() {
        let models: Vec<article_moed::ActiveModel> = to_add
            .into_iter()
            .map(|moed_id| article_moed::ActiveModel {
                article_id: sea_orm::Set(article_id),
                moed_id: sea_orm::Set(moed_id),
                created_at: sea_orm::NotSet,
            })
            .collect();
        article_moed::Entity::insert_many(models)
            .exec(conn)
            .await
            .map_err(db_error)?;
    }
    Ok(true)
}

/// The (id, slug) pairs of a set of moed ids — the invalidation payload for
/// link edits (every affected moed page expires by slug).
pub async fn moed_id_slugs(
    conn: &impl ConnectionTrait,
    moed_ids: &BTreeSet<i32>,
) -> Result<Vec<(i32, String)>, ServiceError> {
    if moed_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut moadim = moed::Entity::find()
        .filter(moed::Column::Id.is_in(moed_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(db_error)?;
    moadim.sort_by_key(|m| m.id);
    Ok(moadim.into_iter().map(|m| (m.id, m.slug)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_moed_slug_derives_from_names_and_rejects_bad_input() {
        assert_eq!(normalize_moed_slug("ראש השנה").unwrap(), "ראש-השנה");
        assert_eq!(normalize_moed_slug("ל\"ג בעומר").unwrap(), "לג-בעומר");
        assert_eq!(normalize_moed_slug("יום  העצמאות").unwrap(), "יום-העצמאות");
        assert!(normalize_moed_slug("").is_err());
        assert!(normalize_moed_slug("-פורים").is_err());
        assert!(normalize_moed_slug("פורים--1").is_err());
    }

    #[test]
    fn slices_for_ranges_clips_only_the_edge_perakim() {
        let counts = HashMap::from([(100, 30), (101, 25), (102, 20)]);
        let ranges = vec![MoedRange {
            id: 1,
            position: 1,
            perek_id_start: 100,
            pasuk_start: 10,
            perek_id_end: 102,
            pasuk_end: 5,
        }];
        let slices = slices_for_ranges(&ranges, &counts);
        assert_eq!(
            slices
                .iter()
                .map(|s| (s.perek_id, s.start_pasuk, s.end_pasuk))
                .collect::<Vec<_>>(),
            vec![(100, 10, 30), (101, 1, 25), (102, 1, 5)]
        );
        assert_eq!(slices[0].slice_order, 0);
        assert_eq!(slices[2].slice_order, 2);
    }

    #[test]
    fn slice_ordinal_selects_numbers_slices_in_order() {
        let slices = vec![
            Slice {
                slice_order: 0,
                perek_id: 1,
                start_pasuk: 1,
                end_pasuk: 3,
            },
            Slice {
                slice_order: 1,
                perek_id: 5,
                start_pasuk: 2,
                end_pasuk: 4,
            },
        ];
        let (sql, params) = slice_ordinal_selects(&slices);
        assert!(sql.contains("SELECT 0 AS slice_order"));
        assert!(sql.contains("UNION ALL"));
        assert_eq!(params.len(), 6);
    }
}
