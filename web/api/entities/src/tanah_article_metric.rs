use sea_orm::entity::prelude::*;

/// Persisted whole-article reading metric over the full article body —
/// not the abstract (issue #2607). `word_count` NULL = unknown, 0 =
/// verified empty. Cascade follows the article row: tanah_article is never
/// recreated by deploys, so a real FK is safe.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article_metric")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub article_id: i32,
    pub word_count: Option<i32>,
    pub estimated_seconds: Option<i32>,
    pub words_per_minute: i32,
    pub calc_version: i32,
    pub source_hash: String,
    pub computed_at: DateTime,
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
    async fn before_save<C: ConnectionTrait>(self, _: &C, _insert: bool) -> Result<Self, DbErr> {
        Ok(self)
    }
}
