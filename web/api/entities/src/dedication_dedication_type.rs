use sea_orm::entity::prelude::*;

/// Many-to-many link between a dedication and its purpose types.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_dedication_dedication_type")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub dedication_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub dedication_type_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::dedication::Entity",
        from = "Column::DedicationId",
        to = "super::dedication::Column::Id"
    )]
    Dedication,
    #[sea_orm(
        belongs_to = "super::dedication_type::Entity",
        from = "Column::DedicationTypeId",
        to = "super::dedication_type::Column::Id"
    )]
    DedicationType,
}

impl Related<super::dedication::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Dedication.def()
    }
}

impl Related<super::dedication_type::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DedicationType.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
