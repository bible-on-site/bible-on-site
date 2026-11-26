//! Image galleries for Tanahpedia entries/entities (#3769).
//!
//! Public reads surface only `is_public` assets through the two scope queries
//! and the `images`/`entityImages` complex fields on `TanahpediaEntryDetail`.
//! The editor surface — full asset records including the private
//! `permissionEvidence`, unpublished links, and every mutation — sits behind
//! the same `TANAHPEDIA_REVISION_API_KEY` scope as the other Tanahpedia write
//! operations (family links, alias writes).

use async_graphql::{Context, ErrorExtensions, Object, Result};

use crate::common::auth::ApiAuth;
use crate::common::website_revalidate::WebsiteRevalidator;
use crate::dtos::tanahpedia_images::{
    TanahpediaEntityImageLinkInput, TanahpediaEntryImageLinkInput, TanahpediaImageAsset,
    TanahpediaImageAssetInput, TanahpediaImageLink, TanahpediaImageLinkFull,
    TanahpediaImageWriteResult,
};
use crate::providers::Database;
use crate::services::tanahpedia_images_service;

#[derive(Default)]
pub struct TanahpediaImagesQuery;

#[Object]
impl TanahpediaImagesQuery {
    /// Public image links attached to an entry (`is_public` assets only,
    /// ordered by `sortOrder`). Reads as empty while the additive schema
    /// deploy is pending.
    async fn tanahpedia_entry_images(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entry_images(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Public image links attached directly to an entity (`is_public` assets
    /// only) — the entity node gallery, e.g. a person's portraits.
    async fn tanahpedia_entity_images(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Vec<TanahpediaImageLink>> {
        tanahpedia_images_service::get_entity_images(ctx.data::<Database>()?, &entity_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Editor listing of an entry's image links: unpublished assets included
    /// and the full provenance fields (`permissionEvidence`, `isPublic`)
    /// exposed. Requires an `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>`
    /// header.
    async fn tanahpedia_entry_image_links(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<Vec<TanahpediaImageLinkFull>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_entry_image_links_editor(ctx.data::<Database>()?, &entry_id)
            .await
            .map_err(|e| e.extend())
    }

    /// Editor listing of an entity's image links — see
    /// `tanahpediaEntryImageLinks`. Requires the same authorization.
    async fn tanahpedia_entity_image_links(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<Vec<TanahpediaImageLinkFull>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_entity_image_links_editor(
            ctx.data::<Database>()?,
            &entity_id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// One image asset record with its private editorial fields — for the
    /// authorized editor's credit/provenance form. Requires the same
    /// `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn tanahpedia_image_asset(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<Option<TanahpediaImageAsset>> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::get_image_asset(ctx.data::<Database>()?, &id)
            .await
            .map_err(|e| e.extend())
    }
}

#[derive(Default)]
pub struct TanahpediaImagesMutation;

#[Object]
impl TanahpediaImagesMutation {
    /// Create or update an image asset — `input.id` null creates, otherwise
    /// the existing row is updated. Publishing (`isPublic: true`) requires
    /// recorded permission/public-domain evidence. Requires an
    /// `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>` header.
    async fn put_tanahpedia_image_asset(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaImageAssetInput,
    ) -> Result<TanahpediaImageAsset> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_image_asset(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            input,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Delete an image asset; its entity/entry links cascade away with it.
    /// `result.affected` reports whether a row was removed; `result.revalidation`
    /// is the post-commit website invalidation outcome.
    async fn delete_tanahpedia_image_asset(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<TanahpediaImageWriteResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::delete_image_asset(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Attach an image to an entity or update an existing link's
    /// order/primary flag (`input.id` selects the update path). Setting
    /// `isPrimary` clears the entity's other primary links atomically.
    async fn put_tanahpedia_entity_image_link(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaEntityImageLinkInput,
    ) -> Result<TanahpediaImageLinkFull> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_entity_image_link(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            input,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Attach an image to an entry or update an existing link's
    /// order/primary flag — see `putTanahpediaEntityImageLink`.
    async fn put_tanahpedia_entry_image_link(
        &self,
        ctx: &Context<'_>,
        input: TanahpediaEntryImageLinkInput,
    ) -> Result<TanahpediaImageLinkFull> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::put_entry_image_link(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            input,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Remove one entity-image link. See `deleteTanahpediaImageAsset` for the result contract.
    async fn remove_tanahpedia_entity_image_link(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<TanahpediaImageWriteResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::remove_entity_image_link(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Remove one entry-image link. See `deleteTanahpediaImageAsset` for the result contract.
    async fn remove_tanahpedia_entry_image_link(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> Result<TanahpediaImageWriteResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::remove_entry_image_link(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Clear the entity's primary-image flag — the explicit "no primary"
    /// state. See `deleteTanahpediaImageAsset` for the result contract.
    async fn clear_tanahpedia_entity_primary_image(
        &self,
        ctx: &Context<'_>,
        entity_id: String,
    ) -> Result<TanahpediaImageWriteResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::clear_entity_primary_image(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &entity_id,
        )
        .await
        .map_err(|e| e.extend())
    }

    /// Clear the entry's primary-image flag — see
    /// `clearTanahpediaEntityPrimaryImage`.
    async fn clear_tanahpedia_entry_primary_image(
        &self,
        ctx: &Context<'_>,
        entry_id: String,
    ) -> Result<TanahpediaImageWriteResult> {
        ctx.data::<ApiAuth>()?
            .authorize_revision_manager()
            .map_err(|e| e.extend())?;
        tanahpedia_images_service::clear_entry_primary_image(
            ctx.data::<Database>()?,
            &WebsiteRevalidator::from_env(),
            &entry_id,
        )
        .await
        .map_err(|e| e.extend())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::tanahpedia::{entity, entry, entry_image, entity_image, image};
    use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult, Value};
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

    fn link_rows(
        rows: Vec<BTreeMap<String, Value>>,
    ) -> sea_orm::MockDatabase {
        MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                rows,
            ])
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

    fn exec_result(rows_affected: u64) -> MockExecResult {
        MockExecResult {
            last_insert_id: 0,
            rows_affected,
        }
    }

    /// A schema wired like production: the shared secret is configured and
    /// the request presents it (`Some("k")` both sides).
    fn schema(db: MockDatabase) -> async_graphql::Schema<TanahpediaImagesQuery, TanahpediaImagesMutation, async_graphql::EmptySubscription> {
        async_graphql::Schema::build(
            TanahpediaImagesQuery,
            TanahpediaImagesMutation,
            async_graphql::EmptySubscription,
        )
        .data(Database::from_connection(db.into_connection()))
        .data(ApiAuth::with_revision_api_key(
            Some("k".to_string()),
            Some("k".to_string()),
        ))
        .finish()
    }

    #[tokio::test]
    async fn public_scope_queries_return_the_public_links() {
        let res = schema(link_rows(vec![link_row("l1", "e1", "img1", true)]))
            .execute(
                "{ tanahpediaEntryImages(entryId: \"e1\") { id ownerKind ownerId sortOrder isPrimary image { imageId url altText licenseName } } }",
            )
            .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let links = res.data.into_json().unwrap()["tanahpediaEntryImages"].clone();
        assert_eq!(links[0]["id"], "l1");
        assert_eq!(links[0]["ownerKind"], "ENTRY");
        assert_eq!(links[0]["image"]["imageId"], "img1");

        let res = schema(link_rows(vec![link_row("l2", "en1", "img2", false)]))
            .execute(
                "{ tanahpediaEntityImages(entityId: \"en1\") { id ownerKind image { imageId } } }",
            )
            .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let links = res.data.into_json().unwrap()["tanahpediaEntityImages"].clone();
        assert_eq!(links[0]["ownerKind"], "ENTITY");
        assert_eq!(links[0]["image"]["imageId"], "img2");
    }

    #[tokio::test]
    async fn editor_scope_queries_expose_the_private_fields() {
        let res = schema(link_rows(vec![link_row("l3", "e1", "img1", false)]))
            .execute(
                "{ tanahpediaEntryImageLinks(entryId: \"e1\") { id image { permissionEvidence isPublic revision } } }",
            )
            .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let links = res.data.into_json().unwrap()["tanahpediaEntryImageLinks"].clone();
        assert_eq!(links[0]["image"]["permissionEvidence"], "evidence");

        let res = schema(link_rows(vec![link_row("l4", "en1", "img1", false)]))
            .execute(
                "{ tanahpediaEntityImageLinks(entityId: \"en1\") { id image { permissionEvidence } } }",
            )
            .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert_eq!(
            res.data.into_json().unwrap()["tanahpediaEntityImageLinks"][0]["image"]
                ["permissionEvidence"],
            "evidence"
        );

        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]]),
        )
        .execute(
            "{ tanahpediaImageAsset(id: \"img1\") { imageId permissionEvidence isPublic revision revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let asset = res.data.into_json().unwrap()["tanahpediaImageAsset"].clone();
        assert_eq!(asset["imageId"], "img1");
        assert_eq!(asset["permissionEvidence"], "evidence");
        assert_eq!(asset["revision"], 1);
    }

    /// Editor surfaces fail closed without the revision-scope bearer.
    #[tokio::test]
    async fn editor_surfaces_reject_an_unauthorized_request() {
        let schema = async_graphql::Schema::build(
            TanahpediaImagesQuery,
            TanahpediaImagesMutation,
            async_graphql::EmptySubscription,
        )
        .data(Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql).into_connection(),
        ))
        .data(ApiAuth::with_revision_api_key(
            Some("wrong".to_string()),
            Some("k".to_string()),
        ))
        .finish();

        let res = schema
            .execute("{ tanahpediaEntryImageLinks(entryId: \"e1\") { id } }")
            .await;
        assert!(!res.errors.is_empty());

        let res = schema
            .execute("mutation { removeTanahpediaEntityImageLink(id: \"l1\") { affected } }")
            .await;
        assert!(!res.errors.is_empty());
    }

    #[tokio::test]
    async fn put_image_asset_creates_and_updates() {
        // Create: exists-check empty → INSERT → post-commit re-read.
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![]])
                .append_exec_results([exec_result(1)])
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]]),
        )
        .execute(
            "mutation { putTanahpediaImageAsset(input: { url: \"https://cdn.example.com/img.jpg\", altText: \"alt\" }) { imageId revision revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let asset = res.data.into_json().unwrap()["putTanahpediaImageAsset"].clone();
        assert_eq!(asset["imageId"], "img1");
        assert!(asset["revalidation"].is_null());

        // Update: existing row → owner lookup → UPDATE → re-read.
        let res = schema(
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
                .append_exec_results([exec_result(1)])
                .append_query_results::<image::Model, Vec<image::Model>, _>([vec![image_model(
                    "img1",
                )]]),
        )
        .execute(
            "mutation { putTanahpediaImageAsset(input: { id: \"img1\", url: \"https://cdn.example.com/img.jpg\", altText: \"alt\", revision: 1 }) { imageId } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
    }

    #[tokio::test]
    async fn delete_image_asset_reports_the_outcome() {
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![],
                ])
                .append_exec_results([exec_result(1)]),
        )
        .execute("mutation { deleteTanahpediaImageAsset(id: \"img1\") { affected revalidation } }")
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let result = res.data.into_json().unwrap()["deleteTanahpediaImageAsset"].clone();
        assert_eq!(result["affected"], true);
        // No linked owners → no public surface to expire.
        assert!(result["revalidation"].is_null());
    }

    #[tokio::test]
    async fn put_link_mutations_update_and_return_the_link() {
        // Update path on an entity link: owner check → UPDATE → re-read.
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entity::Model, Vec<entity::Model>, _>([vec![entity_model(
                    "en1",
                )]])
                .append_exec_results([exec_result(1)])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l1", "en1", "img1", false)],
                ]),
        )
        .execute(
            "mutation { putTanahpediaEntityImageLink(input: { id: \"l1\", entityId: \"en1\", imageId: \"img1\", sortOrder: 4 }) { id ownerKind revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let link = res.data.into_json().unwrap()["putTanahpediaEntityImageLink"].clone();
        assert_eq!(link["id"], "l1");
        assert_eq!(link["ownerKind"], "ENTITY");
        assert_eq!(link["revalidation"], "SKIPPED");

        // Update path on an entry link.
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(1)])
                .append_query_results::<BTreeMap<String, Value>, Vec<BTreeMap<String, Value>>, _>([
                    vec![link_row("l2", "e1", "img1", false)],
                ]),
        )
        .execute(
            "mutation { putTanahpediaEntryImageLink(input: { id: \"l2\", entryId: \"e1\", imageId: \"img1\", sortOrder: 2 }) { id ownerKind revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let link = res.data.into_json().unwrap()["putTanahpediaEntryImageLink"].clone();
        assert_eq!(link["id"], "l2");
        assert_eq!(link["ownerKind"], "ENTRY");
    }

    #[tokio::test]
    async fn remove_link_mutations_report_the_outcome() {
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entity_image::Model, Vec<entity_image::Model>, _>([vec![
                    entity_image::Model {
                        id: "l1".to_string(),
                        entity_id: "en1".to_string(),
                        image_id: "img1".to_string(),
                        sort_order: 0,
                        is_primary: false,
                    },
                ]])
                .append_exec_results([exec_result(1)]),
        )
        .execute("mutation { removeTanahpediaEntityImageLink(id: \"l1\") { affected revalidation } }")
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert_eq!(
            res.data.into_json().unwrap()["removeTanahpediaEntityImageLink"]["affected"],
            true
        );

        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry_image::Model, Vec<entry_image::Model>, _>([vec![
                    entry_image::Model {
                        id: "l2".to_string(),
                        entry_id: "e1".to_string(),
                        image_id: "img1".to_string(),
                        sort_order: 0,
                        is_primary: false,
                    },
                ]])
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(1)]),
        )
        .execute("mutation { removeTanahpediaEntryImageLink(id: \"l2\") { affected revalidation } }")
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        let result = res.data.into_json().unwrap()["removeTanahpediaEntryImageLink"].clone();
        assert_eq!(result["affected"], true);
        assert_eq!(result["revalidation"], "SKIPPED");
    }

    #[tokio::test]
    async fn clear_primary_mutations_report_the_outcome() {
        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql).append_exec_results([exec_result(1)]),
        )
        .execute(
            "mutation { clearTanahpediaEntityPrimaryImage(entityId: \"en1\") { affected revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert_eq!(
            res.data.into_json().unwrap()["clearTanahpediaEntityPrimaryImage"]["affected"],
            true
        );

        let res = schema(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<entry::Model, Vec<entry::Model>, _>([vec![entry_model(
                    "e1",
                )]])
                .append_exec_results([exec_result(1)]),
        )
        .execute(
            "mutation { clearTanahpediaEntryPrimaryImage(entryId: \"e1\") { affected revalidation } }",
        )
        .await;
        assert!(res.errors.is_empty(), "{:?}", res.errors);
        assert_eq!(
            res.data.into_json().unwrap()["clearTanahpediaEntryPrimaryImage"]["affected"],
            true
        );
    }
}
