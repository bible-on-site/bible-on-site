use sea_orm::entity::prelude::*;

/// One moed of the מועדים על הפרק catalogue (#3101). `slug` is the canonical
/// Hebrew name-based URL segment; `annual_order` is wheel/display ordering,
/// never a Hebrew-calendar rule.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_moed")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub slug: String,
    pub name: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub summary: Option<String>,
    pub hebrew_month: Option<String>,
    pub date_label: Option<String>,
    pub annual_order: i16,
    /// FALSE moadim are hidden from every public surface (404 on the detail
    /// route) — drafts stay admin-manageable.
    pub published: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::moed_section::Entity")]
    MoedSection,
    #[sea_orm(has_many = "super::article_moed::Entity")]
    ArticleMoed,
}

impl Related<super::moed_section::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MoedSection.def()
    }
}

impl Related<super::article_moed::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ArticleMoed.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
