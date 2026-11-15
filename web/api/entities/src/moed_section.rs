use sea_orm::entity::prelude::*;

/// One labelled reading section of a moed (e.g. מגילת איכה, a custom-scoped
/// הפטרה). `position` is the 1-based display order inside the moed.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_moed_section")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub moed_id: i32,
    pub label: String,
    pub position: i16,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::moed::Entity",
        from = "Column::MoedId",
        to = "super::moed::Column::Id"
    )]
    Moed,
    #[sea_orm(has_many = "super::moed_range::Entity")]
    MoedRange,
}

impl Related<super::moed::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Moed.def()
    }
}

impl Related<super::moed_range::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MoedRange.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
