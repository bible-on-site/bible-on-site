use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_person_union")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub person1_id: String,
    pub person2_id: String,
    pub union_type_id: String,
    pub union_order: Option<i32>,
    pub start_date: Option<i32>,
    pub end_date: Option<i32>,
    pub end_reason_id: Option<String>,
    pub alt_group_id: Option<String>,
    pub source_citation: Option<String>,
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
