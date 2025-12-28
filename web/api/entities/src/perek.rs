use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_perek")]
pub struct Model {
    #[sea_orm(primary_key, column_name = "ID")]
    pub id: i32,
    #[sea_orm(column_name = "PEREK_ID")]
    pub perek_id: Option<i32>,
    #[sea_orm(column_name = "SEFER_ID")]
    pub sefer_id: Option<i32>,
    #[sea_orm(column_name = "ADDITIONAL")]
    pub additional: Option<i32>,
    #[sea_orm(column_name = "PEREK")]
    pub perek: Option<i32>,
    #[sea_orm(column_name = "DATE")]
    pub date: Option<Date>,
    #[sea_orm(column_name = "HEBDATE")]
    pub hebdate: Option<String>,
    #[sea_orm(column_name = "TSEIT")]
    pub tseit: Option<Time>,
    #[sea_orm(column_name = "HEADER")]
    pub header: Option<String>,
    #[sea_orm(column_name = "SOURCE")]
    pub source: Option<String>,
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
