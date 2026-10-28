use sea_orm::entity::prelude::*;

/// Tanahpedia-entry dedication scope (#2731): targets the canonical entry id,
/// never a mutable title/alias. FK cascades with the entry.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_entry_dedication")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub entry_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub dedication_id: i32,
    /// Assignment expiry, UTC; NULL = ongoing.
    pub expires_at: Option<DateTime>,
    /// MySQL TIMESTAMP, decoded in the connection's UTC time zone.
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::tanahpedia::entry::Entity",
        from = "Column::EntryId",
        to = "super::tanahpedia::entry::Column::Id"
    )]
    Entry,
    #[sea_orm(
        belongs_to = "super::dedication::Entity",
        from = "Column::DedicationId",
        to = "super::dedication::Column::Id"
    )]
    Dedication,
}

impl Related<super::tanahpedia::entry::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Entry.def()
    }
}

impl Related<super::dedication::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Dedication.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
