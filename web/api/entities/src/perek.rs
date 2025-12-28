use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_perek")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub perek_id: Option<i32>,
    pub sefer_id: Option<i32>,
    pub additional: Option<i32>,
    pub perek: Option<i32>,
    #[sea_orm(column_name = "date")]
    pub date: Option<Date>,
    pub hebdate: Option<String>,
    pub tseit: Option<Time>,
    pub header: Option<String>,
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
