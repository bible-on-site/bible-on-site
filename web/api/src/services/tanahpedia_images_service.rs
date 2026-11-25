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
    common::{
        error_handling::{INTERNAL_SERVER_ERROR, ServiceError},
        website_revalidate::WebsiteRevalidator,
    },
    dtos::tanahpedia_images::{
        TanahpediaEntityImageLinkInput, TanahpediaEntryImageLinkInput, TanahpediaImage,
        TanahpediaImageAsset, TanahpediaImageLink, TanahpediaImageLinkFull,
        TanahpediaImageWriteResult,
    },
    providers::Database,
    services::tanahpedia_entries_service::is_missing_mysql_schema,
};
use entities::tanahpedia::{entity, entity_image, entry, entry_image, image};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter,
    QuerySelect, Statement, TransactionTrait,
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
    width: Option<u16>,
    height: Option<u16>,
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
    revision: i32,
}

const IMAGE_SELECT: &str = r#"l.id AS id, l.OWNER_ID AS owner_id, l.sort_order AS sort_order,
       l.is_primary AS is_primary, i.id AS image_id, i.url AS url, i.width AS width,
       i.height AS height, i.alt_text AS alt_text, i.caption AS caption,
       i.creator AS creator, i.credit_line AS credit_line, i.source_name AS source_name,
       i.source_url AS source_url, i.license_name AS license_name,
       i.license_url AS license_url, i.is_public_domain AS is_public_domain,
       i.modifications AS modifications, i.permission_evidence AS permission_evidence,
       i.is_public AS is_public, i.revision AS revision"#;

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
        license_name: if row.is_public_domain {
            None
        } else {
            row.license_name.clone()
        },
        license_url: if row.is_public_domain {
            None
        } else {
            row.license_url.clone()
        },
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
        license_name: if row.is_public_domain {
            None
        } else {
            row.license_name.clone()
        },
        license_url: if row.is_public_domain {
            None
        } else {
            row.license_url.clone()
        },
        is_public_domain: row.is_public_domain,
        modifications: row.modifications.clone(),
        permission_evidence: row.permission_evidence.clone(),
        is_public: row.is_public,
        revision: row.revision,
        revalidation: None,
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
        revalidation: None,
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
        license_name: if m.is_public_domain {
            None
        } else {
            m.license_name
        },
        license_url: if m.is_public_domain {
            None
        } else {
            m.license_url
        },
        is_public_domain: m.is_public_domain,
        modifications: m.modifications,
        permission_evidence: m.permission_evidence,
        is_public: m.is_public,
        revision: m.revision,
        revalidation: None,
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

/// MySQL stores dimensions as SMALLINT UNSIGNED; GraphQL uses i32, so reject
/// out-of-range input instead of narrowing it through a lossy cast.
fn checked_u16(value: i32) -> Result<u16, ServiceError> {
    u16::try_from(value)
        .map_err(|_| ServiceError::bad_request("מידות התמונה חייבות להיות בין 0 ל-65535"))
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

#[derive(Default)]
struct ImageRevalidationOwners {
    entry_unique_names: Vec<String>,
    entity_ids: Vec<String>,
}

impl ImageRevalidationOwners {
    fn is_empty(&self) -> bool {
        self.entry_unique_names.is_empty() && self.entity_ids.is_empty()
    }
}

fn sorted_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut values: Vec<String> = values.into_iter().collect();
    values.sort_unstable();
    values.dedup();
    values
}

#[derive(FromQueryResult)]
struct EntryOwnerRow {
    entry_id: String,
}

#[derive(FromQueryResult)]
struct EntityOwnerRow {
    entity_id: String,
}

#[derive(FromQueryResult)]
struct EntryNameRow {
    unique_name: String,
}

/// Owners whose rendered galleries carry one image asset. Deletes must run
/// this before the FK cascade removes the link rows — afterwards the owner
/// set is unrecoverable.
async fn image_revalidation_owners<C: ConnectionTrait>(
    conn: &C,
    image_id: &str,
) -> Result<ImageRevalidationOwners, ServiceError> {
    let entry_ids: Vec<String> = entry_image::Entity::find()
        .select_only()
        .column(entry_image::Column::EntryId)
        .filter(entry_image::Column::ImageId.eq(image_id))
        .into_model::<EntryOwnerRow>()
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.entry_id)
        .collect();
    let entity_ids: Vec<String> = entity_image::Entity::find()
        .select_only()
        .column(entity_image::Column::EntityId)
        .filter(entity_image::Column::ImageId.eq(image_id))
        .into_model::<EntityOwnerRow>()
        .all(conn)
        .await
        .map_err(db_error)?
        .into_iter()
        .map(|row| row.entity_id)
        .collect();
    let entry_unique_names = if entry_ids.is_empty() {
        Vec::new()
    } else {
        entry::Entity::find()
            .select_only()
            .column(entry::Column::UniqueName)
            .filter(entry::Column::Id.is_in(entry_ids))
            .into_model::<EntryNameRow>()
            .all(conn)
            .await
            .map_err(db_error)?
            .into_iter()
            .map(|row| row.unique_name)
            .collect()
    };
    Ok(ImageRevalidationOwners {
        entry_unique_names: sorted_unique(entry_unique_names),
        entity_ids: sorted_unique(entity_ids),
    })
}

async fn revalidate_image_owners(
    revalidator: &WebsiteRevalidator,
    owners: &ImageRevalidationOwners,
) -> Option<String> {
    if owners.is_empty() {
        return None;
    }
    Some(
        revalidator
            .invalidate_pedia_entry_and_entities(&owners.entry_unique_names, &owners.entity_ids)
            .await
            .as_str()
            .to_string(),
    )
}

fn owner_targets(
    owner_kind: &str,
    owner_id: &str,
    entry_unique_name: Option<String>,
) -> ImageRevalidationOwners {
    if owner_kind == "ENTRY" {
        ImageRevalidationOwners {
            entry_unique_names: entry_unique_name.into_iter().collect(),
            entity_ids: Vec::new(),
        }
    } else {
        ImageRevalidationOwners {
            entry_unique_names: Vec::new(),
            entity_ids: vec![owner_id.to_string()],
        }
    }
}

/// Create or update an image asset. `input.id` null → create with a fresh
/// UUID; otherwise update the existing row (404-style bad_request when the
/// id does not exist).
pub async fn put_image_asset(
    db: &Database,
    revalidator: &WebsiteRevalidator,
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

    let is_public_domain = input.is_public_domain.unwrap_or(false);
    // Rights states are mutually exclusive: public domain never carries a license.
    let license_name = if is_public_domain {
        None
    } else {
        blank_to_none(input.license_name)
    };
    let license_url = if is_public_domain {
        None
    } else {
        blank_to_none(input.license_url)
    };
    let values: Vec<sea_orm::Value> = vec![
        input.url.trim().to_string().into(),
        input.width.map(checked_u16).transpose()?.into(),
        input.height.map(checked_u16).transpose()?.into(),
        input.alt_text.trim().to_string().into(),
        blank_to_none(input.caption).into(),
        blank_to_none(input.creator).into(),
        blank_to_none(input.credit_line).into(),
        blank_to_none(input.source_name).into(),
        blank_to_none(input.source_url).into(),
        license_name.into(),
        license_url.into(),
        is_public_domain.into(),
        blank_to_none(input.modifications).into(),
        blank_to_none(input.permission_evidence).into(),
        is_public.into(),
    ];

    let image_id = match input.id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => Uuid::new_v4().to_string(),
    };

    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let existing = image::Entity::find_by_id(&image_id)
        .one(&txn)
        .await
        .map_err(db_error)?;
    let mut owners = ImageRevalidationOwners::default();

    if let Some(existing) = existing {
        if input.revision != Some(existing.revision) {
            return Err(ServiceError::bad_request(
                "התמונה נערכה במקום אחר - רענן לפני שמירה חוזרת",
            ));
        }
        owners = image_revalidation_owners(&txn, &image_id).await?;
        let updated = txn
            .execute_raw(Statement::from_sql_and_values(
                DatabaseBackend::MySql,
                "UPDATE tanahpedia_image SET url = ?, width = ?, height = ?, alt_text = ?, caption = ?, creator = ?, credit_line = ?, source_name = ?, source_url = ?, license_name = ?, license_url = ?, is_public_domain = ?, modifications = ?, permission_evidence = ?, is_public = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
                values
                    .into_iter()
                    .chain([image_id.clone().into(), existing.revision.into()]),
            ))
            .await
            .map_err(db_error)?;
        if updated.rows_affected() == 0 {
            return Err(ServiceError::bad_request(
                "התמונה נערכה במקום אחר - רענן לפני שמירה חוזרת",
            ));
        }
    } else {
        if input.id.is_some() {
            return Err(ServiceError::bad_request("התמונה לא נמצאה"));
        }
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            "INSERT INTO tanahpedia_image (id, url, width, height, alt_text, caption, creator, credit_line, source_name, source_url, license_name, license_url, is_public_domain, modifications, permission_evidence, is_public, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
            std::iter::once(image_id.clone().into()).chain(values),
        ))
        .await
        .map_err(db_error)?;
    }
    txn.commit().await.map_err(db_error)?;

    let revalidation = revalidate_image_owners(revalidator, &owners).await;
    let mut asset = get_image_asset(db, &image_id)
        .await?
        .ok_or_else(|| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, None::<&str>))?;
    asset.revalidation = revalidation;
    Ok(asset)
}

/// Delete an image asset; its entity/entry links cascade away with it.
pub async fn delete_image_asset(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    image_id: &str,
) -> Result<TanahpediaImageWriteResult, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::delete_image_asset", %image_id);
    // The FK cascade destroys every link row, so capture the affected owners
    // before the delete — they are impossible to reconstruct afterwards.
    let owners = image_revalidation_owners(db.get_connection(), image_id).await?;
    let result = image::Entity::delete_by_id(image_id)
        .exec(db.get_connection())
        .await
        .map_err(db_error)?;
    let affected = result.rows_affected > 0;
    let revalidation = if affected {
        revalidate_image_owners(revalidator, &owners).await
    } else {
        None
    };
    Ok(TanahpediaImageWriteResult {
        affected,
        revalidation,
    })
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
) -> Result<Option<String>, ServiceError> {
    match spec.owner_kind {
        "ENTRY" => entry::Entity::find_by_id(spec.owner_id)
            .one(txn)
            .await
            .map_err(db_error)?
            .map(|model| Some(model.unique_name))
            .ok_or_else(|| ServiceError::bad_request("הערך לא נמצא")),
        _ => entity::Entity::find_by_id(spec.owner_id)
            .one(txn)
            .await
            .map_err(db_error)?
            .map(|_| None)
            .ok_or_else(|| ServiceError::bad_request("הישות לא נמצאה")),
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
    revalidator: &WebsiteRevalidator,
    spec: LinkWriteSpec<'_>,
    link_id: Option<&str>,
    image_id: &str,
    sort_order: Option<i32>,
    is_primary: Option<bool>,
) -> Result<TanahpediaImageLinkFull, ServiceError> {
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let entry_unique_name = assert_owner_exists(&txn, &spec).await?;

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

    let owners = owner_targets(spec.owner_kind, spec.owner_id, entry_unique_name);
    let revalidation = revalidate_image_owners(revalidator, &owners).await;
    let mut link = link_row_by_id(db, &spec, &effective_id)
        .await?
        .map(|row| to_link_full(&row, spec.owner_kind))
        .ok_or_else(|| ServiceError::internal_server_error(INTERNAL_SERVER_ERROR, None::<&str>))?;
    link.revalidation = revalidation;
    Ok(link)
}

pub async fn put_entity_image_link(
    db: &Database,
    revalidator: &WebsiteRevalidator,
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
        revalidator,
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
    revalidator: &WebsiteRevalidator,
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
        revalidator,
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
/// the flag lives on the removed row. The owner is captured before the row
/// disappears so the affected gallery can be expired.
pub async fn remove_entity_image_link(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    id: &str,
) -> Result<TanahpediaImageWriteResult, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::remove_entity_image_link", %id);
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let owner_id = entity_image::Entity::find_by_id(id)
        .one(&txn)
        .await
        .map_err(db_error)?
        .map(|link| link.entity_id);
    let result = entity_image::Entity::delete_by_id(id)
        .exec(&txn)
        .await
        .map_err(db_error)?;
    txn.commit().await.map_err(db_error)?;
    let affected = result.rows_affected > 0;
    let revalidation = if affected {
        match owner_id {
            Some(owner_id) => {
                revalidate_image_owners(
                    revalidator,
                    &ImageRevalidationOwners {
                        entry_unique_names: Vec::new(),
                        entity_ids: vec![owner_id],
                    },
                )
                .await
            }
            None => None,
        }
    } else {
        None
    };
    Ok(TanahpediaImageWriteResult {
        affected,
        revalidation,
    })
}

/// Remove one image link — see `remove_entity_image_link`.
pub async fn remove_entry_image_link(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    id: &str,
) -> Result<TanahpediaImageWriteResult, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::remove_entry_image_link", %id);
    let txn = db.get_connection().begin().await.map_err(db_error)?;
    let owner_id = entry_image::Entity::find_by_id(id)
        .one(&txn)
        .await
        .map_err(db_error)?
        .map(|link| link.entry_id);
    let entry_unique_name = match &owner_id {
        Some(owner_id) => entry::Entity::find_by_id(owner_id)
            .one(&txn)
            .await
            .map_err(db_error)?
            .map(|model| model.unique_name),
        None => None,
    };
    let result = entry_image::Entity::delete_by_id(id)
        .exec(&txn)
        .await
        .map_err(db_error)?;
    txn.commit().await.map_err(db_error)?;
    let affected = result.rows_affected > 0;
    let revalidation = if affected {
        match entry_unique_name {
            Some(unique_name) => {
                revalidate_image_owners(
                    revalidator,
                    &ImageRevalidationOwners {
                        entry_unique_names: vec![unique_name],
                        entity_ids: Vec::new(),
                    },
                )
                .await
            }
            None => None,
        }
    } else {
        None
    };
    Ok(TanahpediaImageWriteResult {
        affected,
        revalidation,
    })
}

/// Explicitly clear the owner's primary flag — the "no primary" state.
pub async fn clear_entity_primary_image(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    entity_id: &str,
) -> Result<TanahpediaImageWriteResult, ServiceError> {
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
    let affected = result.rows_affected() > 0;
    let revalidation = if affected {
        revalidate_image_owners(
            revalidator,
            &ImageRevalidationOwners {
                entry_unique_names: Vec::new(),
                entity_ids: vec![entity_id.to_string()],
            },
        )
        .await
    } else {
        None
    };
    Ok(TanahpediaImageWriteResult {
        affected,
        revalidation,
    })
}

/// Explicitly clear the owner's primary flag — see `clear_entity_primary_image`.
pub async fn clear_entry_primary_image(
    db: &Database,
    revalidator: &WebsiteRevalidator,
    entry_id: &str,
) -> Result<TanahpediaImageWriteResult, ServiceError> {
    tracing::info_span!("tanahpedia_images_service::clear_entry_primary_image", %entry_id);
    // Resolve the invalidation target before the write: after commit a
    // transient read error must not make the committed mutation look failed.
    let entry_unique_name = entry::Entity::find_by_id(entry_id)
        .one(db.get_connection())
        .await
        .map_err(db_error)?
        .map(|model| model.unique_name);
    let result = db
        .get_connection()
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::MySql,
            "UPDATE tanahpedia_entry_image SET is_primary = 0 WHERE entry_id = ?",
            [entry_id.into()],
        ))
        .await
        .map_err(db_error)?;
    let affected = result.rows_affected() > 0;
    let revalidation = if affected {
        match entry_unique_name {
            Some(unique_name) => {
                revalidate_image_owners(
                    revalidator,
                    &ImageRevalidationOwners {
                        entry_unique_names: vec![unique_name],
                        entity_ids: Vec::new(),
                    },
                )
                .await
            }
            None => None,
        }
    } else {
        None
    };
    Ok(TanahpediaImageWriteResult {
        affected,
        revalidation,
    })
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
            revision: 1,
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
            ("width", 800_u16.into()),
            ("height", 600_u16.into()),
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
            ("revision", 1_i32.into()),
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
            revision: None,
        };
        over(&mut input);
        input
    }

    #[tokio::test]
    async fn put_image_asset_validates_before_any_write() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let no_url = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| i.url = " ".to_string()),
        )
        .await;
        assert!(no_url.is_err());

        let no_alt = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| i.alt_text = "".to_string()),
        )
        .await;
        assert!(no_alt.is_err());

        // Publishing requires recorded permission/public-domain evidence.
        let public_no_evidence = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| i.is_public = Some(true)),
        )
        .await;
        assert!(public_no_evidence.is_err());
        let public_blank_evidence = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
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

        let asset = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|_| {}),
        )
        .await
        .unwrap();

        assert_eq!(asset.image_id, "img-new");
        assert_eq!(asset.alt_text, "תיאור התמונה");
        // A brand-new unattached asset has no rendered surface to expire.
        assert_eq!(asset.revalidation, None);
    }

    #[tokio::test]
    async fn put_image_asset_updates_existing_and_rejects_a_missing_id() {
        let update_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                // owner lookup before the write: one entry owner, one entity
                // owner, then the entry unique-name lookup for revalidation
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("entry_id", "e1".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("entity_id", "en1".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("unique_name", "ערך".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_exec_results([exec_result(1)])
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .into_connection(),
        );

        let updated = put_image_asset(
            &update_db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| {
                i.id = Some("img1".to_string());
                i.revision = Some(1);
            }),
        )
        .await
        .unwrap();
        assert_eq!(updated.image_id, "img1");
        assert_eq!(updated.revalidation.as_deref(), Some("SKIPPED"));
        let log = format!(
            "{:?}",
            update_db.get_connection().clone().into_transaction_log()
        );
        assert!(log.contains("revision = revision + 1"), "{log}");
        assert!(log.contains("WHERE id = ? AND revision = ?"), "{log}");

        let missing_db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![]])
                .into_connection(),
        );
        let missing = put_image_asset(
            &missing_db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| i.id = Some("ghost".to_string())),
        )
        .await;
        assert!(missing.is_err());
    }

    #[tokio::test]
    async fn put_image_asset_rejects_a_stale_revision_before_any_write() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .into_connection(),
        );

        let result = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| {
                i.id = Some("img1".to_string());
                i.revision = Some(0);
            }),
        )
        .await;

        assert!(result.is_err());
        let log = format!("{:?}", db.get_connection().clone().into_transaction_log());
        assert!(!log.contains("UPDATE tanahpedia_image"), "{log}");
    }

    #[tokio::test]
    async fn put_image_asset_rejects_a_revision_guard_race_without_success() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_exec_results([exec_result(0)])
                .into_connection(),
        );

        let result = put_image_asset(
            &db,
            &WebsiteRevalidator::new(None, None),
            asset_input(|i| {
                i.id = Some("img1".to_string());
                i.revision = Some(1);
            }),
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_image_asset_reports_rows_affected() {
        let deleted = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("entry_id", "e1".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("entity_id", "en1".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![
                        [("unique_name", "ערך".into())]
                            .into_iter()
                            .map(|(k, v): (&'static str, Value)| (k.to_string(), v))
                            .collect(),
                    ],
                ])
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        let deleted_result =
            delete_image_asset(&deleted, &WebsiteRevalidator::new(None, None), "img1")
                .await
                .unwrap();
        assert!(deleted_result.affected);
        assert_eq!(deleted_result.revalidation.as_deref(), Some("SKIPPED"));
        let log = format!(
            "{:?}",
            deleted.get_connection().clone().into_transaction_log()
        );
        let owner_lookup = log.find("tanahpedia_entry_image").unwrap();
        let delete = log.rfind("DELETE FROM").unwrap();
        assert!(owner_lookup < delete, "{log}");

        let kept = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_exec_results([exec_result(0)])
                .into_connection(),
        );
        assert!(
            !delete_image_asset(&kept, &WebsiteRevalidator::new(None, None), "img1")
                .await
                .unwrap()
                .affected
        );
    }

    #[tokio::test]
    async fn link_mutations_reject_blank_owner_and_image() {
        let db =
            Database::from_connection(MockDatabase::new(DatabaseBackend::MySql).into_connection());

        let no_entity = put_entity_image_link(
            &db,
            &WebsiteRevalidator::new(None, None),
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
            &WebsiteRevalidator::new(None, None),
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

    fn entity_link_model(id: &str, entity_id: &str) -> entity_image::Model {
        entity_image::Model {
            id: id.to_string(),
            entity_id: entity_id.to_string(),
            image_id: "img1".to_string(),
            sort_order: 0,
            is_primary: false,
        }
    }

    fn entry_link_model(id: &str, entry_id: &str) -> entry_image::Model {
        entry_image::Model {
            id: id.to_string(),
            entry_id: entry_id.to_string(),
            image_id: "img1".to_string(),
            sort_order: 0,
            is_primary: false,
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
            &WebsiteRevalidator::new(None, None),
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
        assert_eq!(link.revalidation.as_deref(), Some("SKIPPED"));
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
            &WebsiteRevalidator::new(None, None),
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
        assert_eq!(link.revalidation.as_deref(), Some("SKIPPED"));
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
            &WebsiteRevalidator::new(None, None),
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
                .append_query_results::<entity_image::Model, Vec<entity_image::Model>, _>([vec![
                    entity_link_model("l1", "en1"),
                ]])
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        let removed_result =
            remove_entity_image_link(&removed, &WebsiteRevalidator::new(None, None), "l1")
                .await
                .unwrap();
        assert!(removed_result.affected);
        assert_eq!(removed_result.revalidation.as_deref(), Some("SKIPPED"));

        let removed_entry = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_image::Model, Vec<entry_image::Model>, _>([vec![
                    entry_link_model("l2", "e1"),
                ]])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        let removed_entry_result =
            remove_entry_image_link(&removed_entry, &WebsiteRevalidator::new(None, None), "l2")
                .await
                .unwrap();
        assert!(removed_entry_result.affected);
        assert_eq!(
            removed_entry_result.revalidation.as_deref(),
            Some("SKIPPED")
        );

        let cleared = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(1)])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .into_connection(),
        );
        let cleared_result =
            clear_entry_primary_image(&cleared, &WebsiteRevalidator::new(None, None), "e1")
                .await
                .unwrap();
        assert!(cleared_result.affected);
        assert_eq!(cleared_result.revalidation.as_deref(), Some("SKIPPED"));

        let cleared_entity = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_exec_results([exec_result(1)])
                .into_connection(),
        );
        let cleared_entity_result = clear_entity_primary_image(
            &cleared_entity,
            &WebsiteRevalidator::new(None, None),
            "en1",
        )
        .await
        .unwrap();
        assert!(cleared_entity_result.affected);
        assert_eq!(
            cleared_entity_result.revalidation.as_deref(),
            Some("SKIPPED")
        );
    }
}
