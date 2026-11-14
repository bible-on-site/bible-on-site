use sea_orm::entity::prelude::*;

/// Legacy inclusive perek-range dedication scope. `perek_id_low`/`perek_id_high`
/// are canonical perek ids (1-929). No FK to tanah_perek: deploys recreate the
/// perek table and a cascade would delete still-valid assignments — the write
/// path validates range bounds instead (docs/data/dedications.md).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_perek_dedication")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub perek_id_low: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub perek_id_high: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub dedication_id: i32,
    /// Assignment expiry, UTC; NULL = ongoing.
    pub expires_at: Option<DateTime>,
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
