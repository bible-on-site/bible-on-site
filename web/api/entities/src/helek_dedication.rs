use sea_orm::entity::prelude::*;

/// Whole-helek dedication scope (#2731): `helek_id` is the canonical
/// tanah_helek id (1 = תורה, 2 = נביאים, 3 = כתובים). No FK — deploys
/// recreate tanah_helek; the write path validates the id instead.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_helek_dedication")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub helek_id: i32,
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
