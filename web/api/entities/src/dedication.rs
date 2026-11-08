use sea_orm::entity::prelude::*;

/// A dedication (הקדשה): an honoured subject plus its whole-dedication expiry.
/// Per-assignment expiry lives on each scope link row — see
/// docs/data/dedications.md (#2731).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_dedication")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub subject: String,
    /// Whole-dedication expiry, UTC; NULL = ongoing.
    pub expires_at: Option<DateTime>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
