use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article")]
pub struct Model {
    #[sea_orm(primary_key, column_name = "ID")]
    pub id: i32,
    #[sea_orm(column_name = "PEREK_ID")]
    pub perek_id: i16,
    #[sea_orm(column_name = "AUTHOR_ID")]
    pub author_id: i16,
    #[sea_orm(column_name = "ABSTRACT", column_type = "Text", nullable)]
    pub article_abstract: Option<String>,
    #[sea_orm(column_name = "NAME")]
    pub name: String,
    #[sea_orm(column_name = "PRIORITY")]
    pub priority: i8,
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
