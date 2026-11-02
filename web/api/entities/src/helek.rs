use sea_orm::entity::prelude::*;

/// A canonical helek (תורה / נביאים / כתובים) expressed as an inclusive
/// sefer-id range — the ancestor link for sefer- and perek-level resolution.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_helek")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i32,
    pub name: String,
    pub sefer_id_from: i32,
    pub sefer_id_to: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
