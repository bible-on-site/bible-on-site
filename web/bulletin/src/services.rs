//! Data access services — reuse same query patterns as web/api.
//! Only includes the queries needed for PDF generation.

use crate::db::Database;
use entities::article::{Column as ArticleCol, Entity as ArticleEntity, Model as Article};
use entities::author::{Entity as AuthorEntity, Model as Author};
use entities::perek::{Column as PerekCol, Entity as PerekEntity, Model as Perek};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

/// Fetch perek metadata by perek_id (1-929).
pub async fn get_perek(db: &Database, perek_id: i32) -> anyhow::Result<Perek> {
    PerekEntity::find()
        .filter(PerekCol::PerekId.eq(perek_id))
        .one(db.get_connection())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Perek {} not found", perek_id))
}

/// Fetch all articles for a given perek.
pub async fn get_articles_by_perek(db: &Database, perek_id: i32) -> anyhow::Result<Vec<Article>> {
    Ok(ArticleEntity::find()
        .filter(ArticleCol::PerekId.eq(perek_id as i16))
        .all(db.get_connection())
        .await?)
}

/// Fetch author by ID.
pub async fn get_author(db: &Database, author_id: i32) -> anyhow::Result<Author> {
    AuthorEntity::find_by_id(author_id)
        .one(db.get_connection())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Author {} not found", author_id))
}
