use sea_orm::entity::prelude::*;

/// Ordered per-block word counts over the article's readable blocks for
/// word-weighted reading-position progress (issue #2607). `block_idx` is the
/// 0-based ordinal over the same top-level block segmentation the website's
/// readable-block splitter produces.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article_metric_block")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub article_id: i32,
    /// 0-based ordinal over the article readable blocks.
    #[sea_orm(primary_key, auto_increment = false)]
    pub block_idx: i32,
    pub word_count: i32,
    pub cumulative_words: i32,
    pub calc_version: i32,
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
