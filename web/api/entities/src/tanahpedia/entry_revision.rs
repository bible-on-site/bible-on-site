use sea_orm::entity::prelude::*;

/// A revision to a Tanahpedia entry — either a change already applied to the
/// entry (wiki-style history: admin saves, LLM-assistant applies, applied
/// external proposals) or a proposal by an external AI client awaiting triage.
///
/// `entry_id` is `None` when the revision proposes a brand-new entry. `status`
/// is a free-text lifecycle marker (`PENDING`, `APPLIED`, `REJECTED`).
/// `base_revision_id` records the APPLIED head the change was based on, for
/// optimistic concurrency and restore auditing.
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
    pub base_revision_id: Option<String>,
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
