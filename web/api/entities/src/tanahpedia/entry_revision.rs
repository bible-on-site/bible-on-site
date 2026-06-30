use sea_orm::entity::prelude::*;

/// A revision to a Tanahpedia entry fed by an external AI client through the API.
///
/// `entry_id` is `None` when the revision proposes a brand-new entry. Revisions
/// are never auto-applied to `tanahpedia_entry`; a human triages them via the
/// admin panel. `status` is a free-text lifecycle marker (`PENDING`, `APPROVED`,
/// `REJECTED`).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_entry_revision")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub entry_id: Option<String>,
    pub proposed_unique_name: Option<String>,
    pub proposed_title: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub proposed_content: Option<String>,
    pub source: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub notes: Option<String>,
    pub status: String,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C: ConnectionTrait>(
        mut self,
        _: &C,
        _insert: bool,
    ) -> Result<Self, DbErr> {
        Ok(self)
    }
}
