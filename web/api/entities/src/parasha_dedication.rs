use sea_orm::entity::prelude::*;

/// Weekly-parasha dedication scope (#2731): `parasha_id` is the stable unit id
/// of the shared parasha division (web/bible-on-site parasha-units `unitId`),
/// so joined weekly readings dedicate once. Not a FK — the division is
/// content-side, not a table.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_parasha_dedication")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub parasha_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub dedication_id: i32,
    /// Assignment expiry, UTC; NULL = ongoing.
    pub expires_at: Option<DateTime>,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::dedication::Entity",
        from = "Column::DedicationId",
        to = "super::dedication::Column::Id"
    )]
    Dedication,
}

impl Related<super::dedication::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Dedication.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
