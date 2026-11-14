use sea_orm::entity::prelude::*;

/// Persisted whole-entry reading metric over the authored entry body
/// (issue #2607). `word_count` NULL = unknown, 0 = verified empty.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_entry_metric")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub entry_id: String,
    pub word_count: Option<i32>,
    pub estimated_seconds: Option<i32>,
    pub words_per_minute: i32,
    pub calc_version: i32,
    pub source_hash: String,
    pub computed_at: DateTime,
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
