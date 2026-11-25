//! Tanahpedia image assets and entity/entry links (#3769).
//!
//! The asset row (`tanahpedia_image`) stores the served URL plus
//! attribution/licensing provenance once; `tanahpedia_entry_image` and
//! `tanahpedia_entity_image` attach it to an entry and/or an entity with
//! per-link `sort_order` and an `is_primary` flag (a generated
//! `primary_owner` column enforces at most one primary link per owner).
//!
//! Public readers only ever see `is_public` assets and only the render
//! fields — `permission_evidence`/`is_public` stay behind the authorized
//! editor shapes. All public reads degrade to an empty listing while the
//! additive schema deploy is pending (same rollout convention as
//! `articles_service`).

use crate::{
    common::error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
    dtos::tanahpedia_images::{
        TanahpediaEntityImageLinkInput, TanahpediaEntryImageLinkInput, TanahpediaImage,
        TanahpediaImageAsset, TanahpediaImageLink, TanahpediaImageLinkFull,
    },
    providers::Database,
    services::tanahpedia_entries_service::is_missing_mysql_schema,
};
use entities::tanahpedia::{entity, entity_image, entry, entry_image, image};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, Statement, TransactionTrait,
};
use uuid::Uuid;

fn db_error(db_err: sea_orm::DbErr) -> ServiceError {
    ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, Some(db_err))
}

/// One JOIN row: link fields plus the attached image record.
#[derive(FromQueryResult)]
struct ImageLinkRow {
    id: String,
    owner_id: String,
    sort_order: i16,
    is_primary: bool,
    image_id: String,
    url: String,
    width: Option<i16>,
    height: Option<i16>,
    alt_text: String,
    caption: Option<String>,
    creator: Option<String>,
    credit_line: Option<String>,
    source_name: Option<String>,
    source_url: Option<String>,
    license_name: Option<String>,
    license_url: Option<String>,
    is_public_domain: bool,
    modifications: Option<String>,
    permission_evidence: Option<String>,
    is_public: bool,
}

const IMAGE_SELECT: &str = r#"l.id AS id, l.OWNER_ID AS owner_id, l.sort_order AS sort_order,
       l.is_primary AS is_primary, i.id AS image_id, i.url AS url, i.width AS width,
       i.height AS height, i.alt_text AS alt_text, i.caption AS caption,
       i.creator AS creator, i.credit_line AS credit_line, i.source_name AS source_name,
       i.source_url AS source_url, i.license_name AS license_name,
       i.license_url AS license_url, i.is_public_domain AS is_public_domain,
       i.modifications AS modifications, i.permission_evidence AS permission_evidence,
       i.is_public AS is_public"#;

fn image_link_sql(table: &str, owner_column: &str, include_unpublished: bool) -> String {
    let published_filter = if include_unpublished {
        ""
    } else {
        "AND i.is_public = 1 "
    };
    format!(
        "SELECT {} FROM {} l JOIN tanahpedia_image i ON i.id = l.image_id \
         WHERE l.{} = ? {}ORDER BY l.sort_order, l.id",
        IMAGE_SELECT.replace("OWNER_ID", owner_column),
        table,
        owner_column,
        published_filter,
    )
}

async fn link_rows(
    db: &Database,
    table: &str,
    owner_column: &str,
    owner_id: &str,
    include_unpublished: bool,
) -> Result<Vec<ImageLinkRow>, ServiceError> {
    match ImageLinkRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        image_link_sql(table, owner_column, include_unpublished),
        [owner_id.into()],
    ))
    .all(db.get_connection())
    .await
    {
        Ok(rows) => Ok(rows),
        // Tables land with the data deploy — until then read as empty.
        Err(err) if is_missing_mysql_schema(&err) => Ok(Vec::new()),
        Err(err) => Err(db_error(err)),
    }
}

fn to_public_image(row: &ImageLinkRow) -> TanahpediaImage {
    TanahpediaImage {
        image_id: row.image_id.clone(),
        url: row.url.clone(),
        width: row.width.map(i32::from),
        height: row.height.map(i32::from),
        alt_text: row.alt_text.clone(),
        caption: row.caption.clone(),
        creator: row.creator.clone(),
        credit_line: row.credit_line.clone(),
        source_name: row.source_name.clone(),
        source_url: row.source_url.clone(),
        license_name: row.license_name.clone(),
        license_url: row.license_url.clone(),
        is_public_domain: row.is_public_domain,
        modifications: row.modifications.clone(),
    }
}

fn to_asset(row: &ImageLinkRow) -> TanahpediaImageAsset {
    TanahpediaImageAsset {
        image_id: row.image_id.clone(),
        url: row.url.clone(),
        width: row.width.map(i32::from),
        height: row.height.map(i32::from),
        alt_text: row.alt_text.clone(),
        caption: row.caption.clone(),
        creator: row.creator.clone(),
        credit_line: row.credit_line.clone(),
        source_name: row.source_name.clone(),
        source_url: row.source_url.clone(),
        license_name: row.license_name.clone(),
        license_url: row.license_url.clone(),
        is_public_domain: row.is_public_domain,
        modifications: row.modifications.clone(),
        permission_evidence: row.permission_evidence.clone(),
        is_public: row.is_public,
    }
}

fn to_link(row: &ImageLinkRow, owner_kind: &str) -> TanahpediaImageLink {
    TanahpediaImageLink {
        id: row.id.clone(),
        owner_kind: owner_kind.to_string(),
        owner_id: row.owner_id.clone(),
        sort_order: i32::from(row.sort_order),
        is_primary: row.is_primary,
        image: to_public_image(row),
    }
}

fn to_link_full(row: &ImageLinkRow, owner_kind: &str) -> TanahpediaImageLinkFull {
    TanahpediaImageLinkFull {
        id: row.id.clone(),
        owner_kind: owner_kind.to_string(),
        owner_id: row.owner_id.clone(),
        sort_order: i32::from(row.sort_order),
        is_primary: row.is_primary,
        image: to_asset(row),
    }
}

/// Public image links for an entry — `is_public` assets only, ordered by the
/// link's sort order.
pub async fn get_entry_images(
    db: &Database,
    entry_id: &str,
) -> Result<Vec<TanahpediaImageLink>, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::get_entry_images", %entry_id);
    Ok(
        link_rows(db, "tanahpedia_entry_image", "entry_id", entry_id, false)
            .await?
            .iter()
            .map(|row| to_link(row, "ENTRY"))
            .collect(),
    )
}

/// Public image links for an entity — `is_public` assets only.
pub async fn get_entity_images(
    db: &Database,
    entity_id: &str,
) -> Result<Vec<TanahpediaImageLink>, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::get_entity_images", %entity_id);
    Ok(
        link_rows(db, "tanahpedia_entity_image", "entity_id", entity_id, false)
            .await?
            .iter()
            .map(|row| to_link(row, "ENTITY"))
            .collect(),
    )
}

/// Public entity-scope images for every entity linked to an entry — the
/// `entityImages` side of the entry page gallery (entry-scope images are
/// `get_entry_images`). Batched over the entry's entity ids.
pub async fn get_entity_images_for_entry(
    db: &Database,
    entry_id: &str,
) -> Result<Vec<TanahpediaImageLink>, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::get_entity_images_for_entry", %entry_id);
    let sql = format!(
        "SELECT {} FROM tanahpedia_entity_image l \
         JOIN tanahpedia_image i ON i.id = l.image_id \
         JOIN tanahpedia_entry_entity ee ON ee.entity_id = l.entity_id \
         WHERE ee.entry_id = ? AND i.is_public = 1 \
         ORDER BY l.entity_id, l.sort_order, l.id",
        IMAGE_SELECT.replace("OWNER_ID", "entity_id"),
    );
    let rows = match ImageLinkRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        sql,
        [entry_id.into()],
    ))
    .all(db.get_connection())
    .await
    {
        Ok(rows) => rows,
        Err(err) if is_missing_mysql_schema(&err) => Vec::new(),
        Err(err) => return Err(db_error(err)),
    };
    Ok(rows.iter().map(|row| to_link(row, "ENTITY")).collect())
}

/// Editor link listing — every link including unpublished assets and the
/// private provenance fields. Authorized resolvers only.
pub async fn get_entry_image_links_editor(
    db: &Database,
    entry_id: &str,
) -> Result<Vec<TanahpediaImageLinkFull>, ServiceError> {
    Ok(
        link_rows(db, "tanahpedia_entry_image", "entry_id", entry_id, true)
            .await?
            .iter()
            .map(|row| to_link_full(row, "ENTRY"))
            .collect(),
    )
}

/// Editor link listing for an entity — see `get_entry_image_links_editor`.
pub async fn get_entity_image_links_editor(
    db: &Database,
    entity_id: &str,
) -> Result<Vec<TanahpediaImageLinkFull>, ServiceError> {
    Ok(
        link_rows(db, "tanahpedia_entity_image", "entity_id", entity_id, true)
            .await?
            .iter()
            .map(|row| to_link_full(row, "ENTITY"))
            .collect(),
    )
}

/// Full asset record for the authorized client — includes the private
/// `permission_evidence` and `is_public` fields.
pub async fn get_image_asset(
    db: &Database,
    image_id: &str,
) -> Result<Option<TanahpediaImageAsset>, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::get_image_asset", %image_id);
    let model = image::Entity::find_by_id(image_id)
        .one(db.get_connection())
        .await
        .map_err(db_error)?;
    Ok(model.map(|m| TanahpediaImageAsset {
        image_id: m.id,
        url: m.url,
        width: m.width.map(i32::from),
        height: m.height.map(i32::from),
        alt_text: m.alt_text,
        caption: m.caption,
        creator: m.creator,
        credit_line: m.credit_line,
        source_name: m.source_name,
        source_url: m.source_url,
        license_name: m.license_name,
        license_url: m.license_url,
        is_public_domain: m.is_public_domain,
        modifications: m.modifications,
        permission_evidence: m.permission_evidence,
        is_public: m.is_public,
    }))
}

fn blank_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

/// Validation shared by create and update: required fields stay non-empty
/// and publishing requires recorded permission/public-domain evidence (#3769
/// "Record permission or public-domain evidence before publishing").
fn validate_asset(
    url: &str,
    alt_text: &str,
    is_public: bool,
    evidence: &Option<String>,
) -> Result<(), ServiceError> {
    if url.trim().is_empty() {
        return Err(ServiceError::bad_request("כתובת התמונה חייבת להיות מלאה"));
    }
    if alt_text.trim().is_empty() {
        return Err(ServiceError::bad_request("טקסט חלופי (alt) חייב להיות מלא"));
    }
    if is_public && blank_to_none(evidence.clone()).is_none() {
        return Err(ServiceError::bad_request(
            "יש לתעד ראיות רשות או נחלת הכלל לפני פרסום התמונה",
        ));
    }
    Ok(())
}

/// Create or update an image asset. `input.id` null → create with a fresh
/// UUID; otherwise update the existing row (404-style bad_request when the
/// id does not exist).
pub async fn put_image_asset(
    db: &Database,
    input: crate::dtos::tanahpedia_images::TanahpediaImageAssetInput,
) -> Result<TanahpediaImageAsset, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::put_image_asset");
    let is_public = input.is_public.unwrap_or(false);
    validate_asset(
        &input.url,
        &input.alt_text,
        is_public,
        &input.permission_evidence,
    )?;

    const COLUMNS: [&str; 15] = [
        "url",
        "width",
        "height",
        "alt_text",
        "caption",
        "creator",
        "credit_line",
        "source_name",
        "source_url",
        "license_name",
        "license_url",
        "is_public_domain",
        "modifications",
        "permission_evidence",
        "is_public",
    ];
    let values: Vec<sea_orm::Value> = vec![
        input.url.trim().to_string().into(),
        input.width.map(|w| w as i16).into(),
        input.height.map(|h| h as i16).into(),
        input.alt_text.trim().to_string().into(),
        blank_to_none(input.caption).into(),
        blank_to_none(input.creator).into(),
        blank_to_none(input.credit_line).into(),
        blank_to_none(input.source_name).into(),
        blank_to_none(input.source_url).into(),
        blank_to_none(input.license_name).into(),
        blank_to_none(input.license_url).into(),
        input.is_public_domain.unwrap_or(false).into(),
        blank_to_none(input.modifications).into(),
        blank_to_none(input.permission_evidence).into(),
        is_public.into(),
    ];

    let image_id = match input.id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => Uuid::new_v4().to_string(),
    };

    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let exists = image::Entity::find_by_id(&image_id)
        .one(&txn)
        .await
        .map_err(db_error)?
        .is_some();

    if exists {
        let assignments = COLUMNS
            .iter()
            .map(|column| format!("{column} = ?"))
            .collect::<Vec<_>>()
            .join(", ");
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            format!("UPDATE tanahpedia_image SET {assignments} WHERE id = ?"),
            values.into_iter().chain([image_id.clone().into()]),
        ))
        .await
        .map_err(db_error)?;
    } else {
        if input.id.is_some() {
            return Err(ServiceError::bad_request("התמונה לא נמצאה"));
        }
        let columns = COLUMNS.join(", ");
        let placeholders = COLUMNS.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            format!("INSERT INTO tanahpedia_image (id, {columns}) VALUES (?, {placeholders})"),
            std::iter::once(image_id.clone().into()).chain(values),
        ))
        .await
        .map_err(db_error)?;
    }
    txn.commit().await.map_err(db_error)?;

    get_image_asset(db, &image_id)
        .await?
        .ok_or_else(|| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, None::<&str>))
}

/// Delete an image asset; its entity/entry links cascade away with it.
pub async fn delete_image_asset(db: &Database, image_id: &str) -> Result<bool, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::delete_image_asset", %image_id);
    let result = image::Entity::delete_by_id(image_id)
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    Ok(result.rows_affected > 0)
}

/// The `owner` side of a link row — ENTRY scopes `entry_id`, ENTITY scopes
/// `entity_id`.
struct LinkWriteSpec<'a> {
    table: &'a str,
    owner_column: &'a str,
    owner_id: &'a str,
    owner_kind: &'a str,
}

async fn assert_owner_exists(
    txn: &sea_orm::DatabaseTransaction,
    spec: &LinkWriteSpec<'_>,
) -> Result<(), ServiceError> {
    let (found, missing_label) = match spec.owner_kind {
        "ENTRY" => (
            entry::Entity::find_by_id(spec.owner_id)
                .one(txn)
                .await
                .map_err(db_error)?
                .is_some(),
            "הערך לא נמצא",
        ),
        _ => (
            entity::Entity::find_by_id(spec.owner_id)
                .one(txn)
                .await
                .map_err(db_error)?
                .is_some(),
            "הישות לא נמצאה",
        ),
    };
    if found {
        Ok(())
    } else {
        Err(ServiceError::bad_request(missing_label))
    }
}

/// Re-read one link row by id — the row the last write produced (the editor
/// shape includes unpublished assets and private provenance).
async fn link_row_by_id(
    db: &Database,
    spec: &LinkWriteSpec<'_>,
    id: &str,
) -> Result<Option<ImageLinkRow>, ServiceError> {
    ImageLinkRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::MySql,
        format!(
            "SELECT {} FROM {} l JOIN tanahpedia_image i ON i.id = l.image_id \
             WHERE l.id = ?",
            IMAGE_SELECT.replace("OWNER_ID", spec.owner_column),
            spec.table,
        ),
        [id.into()],
    ))
    .one(db.get_connection())
    .await
    .map_err(db_error)
}

/// Attach an image to an owner or update an existing link's sort/primary.
/// `link_id` present → update that link; otherwise attach (erroring when the
/// pair already exists — update the returned link instead). Setting
/// `is_primary` clears every other primary flag for the owner inside the
/// same transaction; the `primary_owner` unique index backstops it.
async fn put_image_link(
    db: &Database,
    spec: LinkWriteSpec<'_>,
    link_id: Option<&str>,
    image_id: &str,
    sort_order: Option<i32>,
    is_primary: Option<bool>,
) -> Result<TanahpediaImageLinkFull, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    assert_owner_exists(&txn, &spec).await?;

    // Attach needs the asset; update only needs the link row.
    if link_id.is_none()
        && image::Entity::find_by_id(image_id)
            .one(&txn)
            .await
            .map_err(db_error)?
            .is_none()
    {
        return Err(ServiceError::bad_request("התמונה לא נמצאה"));
    }

    let effective_id = match link_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => id.to_string(),
        None => Uuid::new_v4().to_string(),
    };

    // Clear the incumbent primary before the target row becomes primary: the
    // generated unique index rejects even a transient second primary. The
    // transaction rolls this clear back if the link write itself fails.
    if is_primary == Some(true) {
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            format!(
                "UPDATE {} SET is_primary = 0 WHERE {} = ? AND id <> ?",
                spec.table, spec.owner_column
            ),
            [spec.owner_id.into(), effective_id.clone().into()],
        ))
        .await
        .map_err(db_error)?;
    }

    if let Some(id) = link_id.map(str::trim).filter(|id| !id.is_empty()) {
        // Update path — the row must exist on the owner the caller supplied.
        let updated = txn
            .execute_raw(Statement::from_sql_and_values(
                DatabaseBackend::MySql,
                format!(
                    "UPDATE {} SET sort_order = COALESCE(?, sort_order), \
                     is_primary = COALESCE(?, is_primary) WHERE id = ? AND {} = ?",
                    spec.table, spec.owner_column
                ),
                [
                    sort_order.map(|s| s as i16).into(),
                    is_primary.into(),
                    id.into(),
                    spec.owner_id.into(),
                ],
            ))
            .await
            .map_err(db_error)?;
        if updated.rows_affected() == 0 {
            return Err(ServiceError::bad_request("הקישור לתמונה לא נמצא"));
        }
    } else {
        // Attach: default to the end of the gallery order.
        let next_order: Option<i16> = match sort_order {
            Some(order) => Some(order as i16),
            None => {
                #[derive(FromQueryResult)]
                struct MaxOrderRow {
                    next_order: Option<i64>,
                }
                MaxOrderRow::find_by_statement(Statement::from_sql_and_values(
                    DatabaseBackend::MySql,
                    format!(
                        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order \
                         FROM {} WHERE {} = ?",
                        spec.table, spec.owner_column
                    ),
                    [spec.owner_id.into()],
                ))
                .one(&txn)
                .await
                .map_err(db_error)?
                .and_then(|row| row.next_order.map(|v| v as i16))
            }
        };
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            format!(
                "INSERT INTO {} (id, {}, image_id, sort_order, is_primary) \
                 VALUES (?, ?, ?, ?, ?)",
                spec.table, spec.owner_column
            ),
            [
                effective_id.clone().into(),
                spec.owner_id.into(),
                image_id.into(),
                next_order.unwrap_or(0).into(),
                is_primary.unwrap_or(false).into(),
            ],
        ))
        .await
        .map_err(db_error)?;
    }
    txn.commit().await.map_err(db_error)?;

    link_row_by_id(db, &spec, &effective_id)
        .await?
        .map(|row| to_link_full(&row, spec.owner_kind))
        .ok_or_else(|| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, None::<&str>))
}

pub async fn put_entity_image_link(
    db: &Database,
    input: TanahpediaEntityImageLinkInput,
) -> Result<TanahpediaImageLinkFull, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::put_entity_image_link");
    if input.entity_id.trim().is_empty() {
        return Err(ServiceError::bad_request("ישות חייבת להיות מלאה"));
    }
    if input.image_id.trim().is_empty() {
        return Err(ServiceError::bad_request("תמונה חייבת להיות מלאה"));
    }
    put_image_link(
        db,
        LinkWriteSpec {
            table: "tanahpedia_entity_image",
            owner_column: "entity_id",
            owner_id: input.entity_id.trim(),
            owner_kind: "ENTITY",
        },
        input.id.as_deref(),
        input.image_id.trim(),
        input.sort_order,
        input.is_primary,
    )
    .await
}

pub async fn put_entry_image_link(
    db: &Database,
    input: TanahpediaEntryImageLinkInput,
) -> Result<TanahpediaImageLinkFull, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::put_entry_image_link");
    if input.entry_id.trim().is_empty() {
        return Err(ServiceError::bad_request("ערך חייב להיות מלא"));
    }
    if input.image_id.trim().is_empty() {
        return Err(ServiceError::bad_request("תמונה חייבת להיות מלאה"));
    }
    put_image_link(
        db,
        LinkWriteSpec {
            table: "tanahpedia_entry_image",
            owner_column: "entry_id",
            owner_id: input.entry_id.trim(),
            owner_kind: "ENTRY",
        },
        input.id.as_deref(),
        input.image_id.trim(),
        input.sort_order,
        input.is_primary,
    )
    .await
}

/// Remove one image link — unlinking never leaves a stale primary because
/// the flag lives on the removed row.
pub async fn remove_entity_image_link(db: &Database, id: &str) -> Result<bool, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::remove_entity_image_link", %id);
    let result = entity_image::Entity::delete_by_id(id)
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    Ok(result.rows_affected > 0)
}

/// Remove one image link — see `remove_entity_image_link`.
pub async fn remove_entry_image_link(db: &Database, id: &str) -> Result<bool, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::remove_entry_image_link", %id);
    let result = entry_image::Entity::delete_by_id(id)
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    Ok(result.rows_affected > 0)
}

/// Explicitly clear the owner's primary flag — the "no primary" state.
pub async fn clear_entity_primary_image(
    db: &Database,
    entity_id: &str,
) -> Result<bool, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::clear_entity_primary_image", %entity_id);
    let result = db
        .get_connection()
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            "UPDATE tanahpedia_entity_image SET is_primary = 0 WHERE entity_id = ?",
            [entity_id.into()],
        ))
        .await
        .map_err(db_error)?;
    Ok(result.rows_affected() > 0)
}

/// Explicitly clear the owner's primary flag — see `clear_entity_primary_image`.
pub async fn clear_entry_primary_image(
    db: &Database,
    entry_id: &str,
) -> Result<bool, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::clear_entry_primary_image", %entry_id);
    let result = db
        .get_connection()
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            "UPDATE tanahpedia_entry_image SET is_primary = 0 WHERE entry_id = ?",
            [entry_id.into()],
        ))
        .await
        .map_err(db_error)?;
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dtos::tanahpedia_images::TanahpediaImageAssetInput;
    use sea_orm::{DbErr, MockDatabase, MockExecResult, Value};
    use std::collections::BTreeMap;

    fn now() -> chrono::NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 7, 19)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap()
    }

    fn image_model(id: &str) -> image::Model {
        image::Model {
            id: id.to_string(),
            url: "https://cdn.example.com/img.jpg".to_string(),
            width: Some(800),
            height: Some(600),
            alt_text: "תיאור התמונה".to_string(),
            caption: Some("כיתוב".to_string()),
            creator: Some("יוצר".to_string()),
            credit_line: Some("קרדיט".to_string()),
            source_name: Some("Wikimedia Commons".to_string()),
            source_url: Some("https://commons.example.com/f.jpg".to_string()),
            license_name: Some("CC BY-SA 4.0".to_string()),
            license_url: Some("https://creativecommons.org/licenses/by-sa/4.0/".to_string()),
            is_public_domain: false,
            modifications: None,
            permission_evidence: Some("evidence".to_string()),
            is_public: true,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn link_row(
        id: &str,
        owner_id: &str,
        image_id: &str,
        is_primary: bool,
    ) -> BTreeMap<String, Value> {
        [
            ("id", id.into()),
            ("owner_id", owner_id.into()),
            ("sort_order", 0_i16.into()),
            ("is_primary", is_primary.into()),
            ("image_id", image_id.into()),
            ("url", "https://cdn.example.com/img.jpg".into()),
            ("width", 800_i16.into()),
            ("height", 600_i16.into()),
            ("alt_text", "תיאור התמונה".into()),
            ("caption", "כיתוב".into()),
            ("creator", "יוצר".into()),
            ("credit_line", "קרדיט".into()),
            ("source_name", "Wikimedia Commons".into()),
            ("source_url", "https://commons.example.com/f.jpg".into()),
            ("license_name", "CC BY-SA 4.0".into()),
            (
                "license_url",
                "https://creativecommons.org/licenses/by-sa/4.0/".into(),
            ),
            ("is_public_domain", false.into()),
            ("modifications", Value::String(None)),
            ("permission_evidence", "evidence".into()),
            ("is_public", true.into()),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
    }

    fn missing_schema_db(table: &str) -> Database {
        Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_errors([DbErr::Custom(format!(
                    "Table 'tanah.{table}' doesn't exist"
                ))])
                .into_connection(),
        )
    }

    fn exec_result(rows_affected: u64) -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected,
        }
    }

    #[tokio::test]
    async fn get_entry_images_returns_public_links_without_private_fields() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l1", "e1", "img1", true)],
                ])
                .into_connection(),
        );

        let links = get_entry_images(&db, "e1").await.unwrap();

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].owner_kind, "ENTRY");
        assert_eq!(links[0].owner_id, "e1");
        assert!(links[0].is_primary);
        assert_eq!(links[0].image.image_id, "img1");
        assert_eq!(links[0].image.url, "https://cdn.example.com/img.jpg");
        assert_eq!(links[0].image.width, Some(800));
        assert_eq!(links[0].image.license_name.as_deref(), Some("CC BY-SA 4.0"));
    }

    #[tokio::test]
    async fn public_reads_degrade_to_empty_while_tables_are_undeployed() {
        assert!(
            get_entry_images(&missing_schema_db("tanahpedia_entry_image"), "e1")
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            get_entity_images(&missing_schema_db("tanahpedia_entity_image"), "en1")
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            get_entity_images_for_entry(&missing_schema_db("tanahpedia_entity_image"), "e1")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn get_entity_images_for_entry_returns_entity_links() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l2", "en1", "img1", false)],
                ])
                .into_connection(),
        );

        let links = get_entity_images_for_entry(&db, "e1").await.unwrap();

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].owner_kind, "ENTITY");
        assert_eq!(links[0].owner_id, "en1");
        assert!(!links[0].is_primary);
    }

    #[tokio::test]
    async fn editor_links_carry_private_provenance() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l3", "en1", "img1", false)],
                ])
                .into_connection(),
        );

        let links = get_entity_image_links_editor(&db, "en1").await.unwrap();

        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].image.permission_evidence.as_deref(),
            Some("evidence")
        );
        assert!(links[0].image.is_public);
    }

    #[tokio::test]
    async fn get_image_asset_maps_the_full_record() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .into_connection(),
        );

        let asset = get_image_asset(&db, "img1").await.unwrap().unwrap();

        assert_eq!(asset.image_id, "img1");
        assert_eq!(asset.permission_evidence.as_deref(), Some("evidence"));
        assert!(asset.is_public);

        let missing = get_image_asset(
            &Database::from_connection(
                MockDatabase::new(DatabaseBackend::MySql)
                    .append_query_results::<image::Model, Vec<image::Model>, _>([vec![]])
                    .into_connection(),
            ),
            "nope",
        )
        .await
        .unwrap();
        assert!(missing.is_none());
    }

    fn asset_input(over: impl FnOnce(&mut TanahpediaImageAssetInput)) -> TanahpediaImageAssetInput {
        let mut input = TanahpediaImageAssetInput {
            id: None,
            url: "https://cdn.example.com/img.jpg".to_string(),
            width: None,
            height: None,
            alt_text: "alt".to_string(),
            caption: None,
            creator: None,
            credit_line: None,
            source_name: None,
            source_url: None,
            license_name: None,
            license_url: None,
            is_public_domain: None,
            modifications: None,
            permission_evidence: None,
            is_public: None,
        };
        over(&mut input);
        input
    }

    #[tokio::test]
    async fn put_image_asset_validates_before_any_write() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let no_url = put_image_asset(&db, asset_input(|i| i.url = " ".to_string())).await;
        assert!(no_url.is_err());

        let no_alt = put_image_asset(&db, asset_input(|i| i.alt_text = "".to_string())).await;
        assert!(no_alt.is_err());

        // Publishing requires recorded permission/public-domain evidence.
        let public_no_evidence =
            put_image_asset(&db, asset_input(|i| i.is_public = Some(true))).await;
        assert!(public_no_evidence.is_err());
        let public_blank_evidence = put_image_asset(
            &db,
            asset_input(|i| {
                i.is_public = Some(true);
                i.permission_evidence = Some("  ".to_string());
            }),
        )
        .await;
        assert!(public_blank_evidence.is_err());
    }

    #[tokio::test]
    async fn put_image_asset_creates_and_returns_the_asset() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // exists check inside the txn → not found
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![]])
                .append_exec_results([exec_result(1)])
                // get_image_asset re-read after commit
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img-new",
                )]])
                .into_connection(),
        );

        let asset = put_image_asset(&db, asset_input(|_| {})).await.unwrap();

        assert_eq!(asset.image_id, "img-new");
        assert_eq!(asset.alt_text, "תיאור התמונה");
    }

    #[tokio::test]
    async fn put_image_asset_updates_existing_and_rejects_a_missing_id() {
        let update_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .append_exec_results([exec_result(1)])
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .into_connection(),
        );

        let updated = put_image_asset(&update_db, asset_input(|i| i.id = Some("img1".to_string())))
            .await
            .unwrap();
        assert_eq!(updated.image_id, "img1");

        let missing_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![]])
                .into_connection(),
        );
        let missing = put_image_asset(
            &missing_db,
            asset_input(|i| i.id = Some("ghost".to_string())),
        )
        .await;
        assert!(missing.is_err());
    }

    #[tokio::test]
    async fn delete_image_asset_reports_rows_affected() {
        let deleted = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        assert!(delete_image_asset(&deleted, "img1").await.unwrap());

        let kept = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(0)])
                .into_connection(),
        );
        assert!(!delete_image_asset(&kept, "img1").await.unwrap());
    }

    #[tokio::test]
    async fn link_mutations_reject_blank_owner_and_image() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let no_entity = put_entity_image_link(
            &db,
            TanahpediaEntityImageLinkInput {
                id: None,
                entity_id: " ".to_string(),
                image_id: "img1".to_string(),
                sort_order: None,
                is_primary: None,
            },
        )
        .await;
        assert!(no_entity.is_err());

        let no_image = put_entry_image_link(
            &db,
            TanahpediaEntryImageLinkInput {
                id: None,
                entry_id: "e1".to_string(),
                image_id: "".to_string(),
                sort_order: None,
                is_primary: None,
            },
        )
        .await;
        assert!(no_image.is_err());
    }

    fn entry_model(id: &str) -> entry::Model {
        entry::Model {
            id: id.to_string(),
            unique_name: "ערך".to_string(),
            title: "ערך".to_string(),
            content: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn entity_model(id: &str) -> entity::Model {
        entity::Model {
            id: id.to_string(),
            entity_type: "PERSON".to_string(),
            name: "ישות".to_string(),
            created_at: now(),
            updated_at: now(),
        }
    }

    #[tokio::test]
    async fn put_entity_image_link_attaches_then_clears_sibling_primaries() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                // owner exists
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "en1",
                )]])
                // image asset exists
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                // MAX(sort_order) + 1
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("next_order", 3_i64.into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                // INSERT link + UPDATE clear-siblings
                .append_exec_results([exec_result(1), exec_result(2)])
                // link_rows re-read after commit
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("generated", "en1", "img1", true)],
                ])
                .into_connection(),
        );

        let link = put_entity_image_link(
            &db,
            TanahpediaEntityImageLinkInput {
                id: None,
                entity_id: "en1".to_string(),
                image_id: "img1".to_string(),
                sort_order: None,
                is_primary: Some(true),
            },
        )
        .await
        .unwrap();

        assert_eq!(link.id, "generated");
        assert_eq!(link.owner_kind, "ENTITY");
        assert!(link.is_primary);
    }

    #[tokio::test]
    async fn put_entry_image_link_updates_existing_link() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(1)])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l1", "e1", "img1", false)],
                ])
                .into_connection(),
        );

        let link = put_entry_image_link(
            &db,
            TanahpediaEntryImageLinkInput {
                id: Some("l1".to_string()),
                entry_id: "e1".to_string(),
                image_id: "img1".to_string(),
                sort_order: Some(4),
                is_primary: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(link.id, "l1");
    }

    #[tokio::test]
    async fn put_entry_image_link_errors_when_the_link_row_is_missing() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(0)])
                .into_connection(),
        );

        let result = put_entry_image_link(
            &db,
            TanahpediaEntryImageLinkInput {
                id: Some("ghost".to_string()),
                entry_id: "e1".to_string(),
                image_id: "img1".to_string(),
                sort_order: Some(4),
                is_primary: None,
            },
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn remove_and_clear_report_rows_affected() {
        let removed = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        assert!(remove_entity_image_link(&removed, "l1").await.unwrap());

        let cleared = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        assert!(clear_entry_primary_image(&cleared, "e1").await.unwrap());
    }
}
