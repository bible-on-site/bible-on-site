use sea_orm::entity::prelude::*;

/// Full-sefer dedication scope (#2731): `sefer_id` is the canonical
/// tanah_sefer id and covers the sefer's additionals too. No FK — deploys
/// recreate tanah_sefer; the write path validates the id instead.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_sefer_dedication")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub sefer_id: i32,
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
