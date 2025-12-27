use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_sefer")]
pub struct Model {
    #[sea_orm(primary_key, column_name = "SEFER_ID")]
    pub id: i32,
    #[sea_orm(column_name = "NAME")]
    pub name: String,
    #[sea_orm(column_name = "TANACH_US_NAME")]
    pub tanach_us_name: String,
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
