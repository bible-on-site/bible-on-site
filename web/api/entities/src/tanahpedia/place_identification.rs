use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_place_identification")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub place_id: String,
    #[sea_orm(nullable)]
    pub modern_name: Option<String>,
    #[sea_orm(nullable)]
    pub latitude: Option<Decimal>,
    #[sea_orm(nullable)]
    pub longitude: Option<Decimal>,
    #[sea_orm(nullable)]
    pub alt_group_id: Option<String>,
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
