use sea_orm::entity::prelude::*;

/// One canonical {perek_id, pasuk} an article verifiably covers
/// (tanah_article_covering_source, #2189 / epic #2175 §3). Rows exist only
/// for author-mapped coverage — a missing set means coverage unknown, not
/// "covers nothing", so readers must check the article's coverage_verified
/// flag before interpreting rows.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article_covering_source")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub article_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub perek_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub pasuk: i16,
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

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C: ConnectionTrait>(
        mut self,
        _: &C,
        _insert: bool,
    ) -> Result<Self, DbErr> {
        Ok(self)
    }
}
