use sea_orm::entity::prelude::*;

/// Optional many-to-many article <-> moed link (#3101): a moed may carry
/// zero/one/many articles and an article may link to several moadim. The
/// composite primary key rejects duplicate pairs.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article_moed")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub article_id: i32,
    #[sea_orm(primary_key, auto_increment = false)]
    pub moed_id: i32,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::article::Entity",
        from = "Column::ArticleId",
        to = "super::article::Column::Id"
    )]
    Article,
    #[sea_orm(
        belongs_to = "super::moed::Entity",
        from = "Column::MoedId",
        to = "super::moed::Column::Id"
    )]
    Moed,
}

impl Related<super::article::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Article.def()
    }
}

impl Related<super::moed::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Moed.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
