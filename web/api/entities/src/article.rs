use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub perek_id: i16,
    pub author_id: i16,
    #[sea_orm(column_name = "abstract", column_type = "Text", nullable)]
    pub article_abstract: Option<String>,
    pub name: String,
    pub priority: i8,
    #[sea_orm(column_type = "Text", nullable)]
    pub content: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

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
