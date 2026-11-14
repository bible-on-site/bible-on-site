use sea_orm::entity::prelude::*;

/// Recurring Hebrew-date article override (tanah_article_hebrew_date, #3098).
/// Each row binds one article to one recurring {hebrew_month, hebrew_day} —
/// no Hebrew year — using the uniform month numbering shared with the app,
/// the website and the bulletin: 1=Tishrei .. 12=Elul, 6=Adar of a non-leap
/// year, 13=Adar I and 14=Adar II (leap years only). The composite key keeps
/// at most one article per recurring date.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article_hebrew_date")]
pub struct Model {
    /// TINYINT UNSIGNED.
    #[sea_orm(primary_key, auto_increment = false)]
    pub hebrew_month: u8,
    /// TINYINT UNSIGNED.
    #[sea_orm(primary_key, auto_increment = false)]
    pub hebrew_day: u8,
    pub article_id: i32,
    /// MySQL TIMESTAMP, decoded in the connection's UTC time zone.
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::article::Entity",
        from = "Column::ArticleId",
        to = "super::article::Column::Id"
    )]
    Article,
}

impl Related<super::article::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Article.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
