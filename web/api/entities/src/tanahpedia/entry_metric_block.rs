use sea_orm::entity::prelude::*;

/// Ordered per-block word counts over the entry's readable blocks for
/// word-weighted reading-position progress (issue #2607).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_entry_metric_block")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub entry_id: String,
    /// 0-based ordinal over the entry readable blocks.
    #[sea_orm(primary_key, auto_increment = false)]
    pub block_idx: i32,
    pub word_count: i32,
    pub cumulative_words: i32,
    pub calc_version: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::entry::Entity",
        from = "Column::EntryId",
        to = "super::entry::Column::Id"
    )]
    Entry,
}

impl Related<super::entry::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Entry.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C: ConnectionTrait>(self, _: &C, _insert: bool) -> Result<Self, DbErr> {
        Ok(self)
    }
}
