use sea_orm::entity::prelude::*;

/// One inclusive canonical scripture range inside a moed section — several
/// rows express noncontiguous readings (and cross-sefer jumps) in display
/// order. Pasuk bounds are validated against tanah_perek.pasuk_count by the
/// write paths.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_moed_range")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub section_id: i32,
    pub position: i16,
    pub perek_id_start: i32,
    pub pasuk_start: i16,
    pub perek_id_end: i32,
    pub pasuk_end: i16,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::moed_section::Entity",
        from = "Column::SectionId",
        to = "super::moed_section::Column::Id"
    )]
    MoedSection,
}

impl Related<super::moed_section::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MoedSection.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
