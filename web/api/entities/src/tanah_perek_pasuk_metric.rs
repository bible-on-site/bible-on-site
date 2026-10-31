use sea_orm::entity::prelude::*;

/// Ordered per-pasuk word counts for word-weighted reading-position progress
/// (issue #2607). `cumulative_words` counts words up to and including the
/// pasuk in canonical order, so consumers map scroll position to a word
/// offset without re-parsing text.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_perek_pasuk_metric")]
pub struct Model {
    /// Canonical perek id (1-929).
    #[sea_orm(primary_key, auto_increment = false)]
    pub perek_id: i32,
    /// 1-based pasuk index within the perek.
    #[sea_orm(primary_key, auto_increment = false)]
    pub pasuk: i32,
    pub word_count: i32,
    pub cumulative_words: i32,
    pub calc_version: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C: ConnectionTrait>(self, _: &C, _insert: bool) -> Result<Self, DbErr> {
        Ok(self)
    }
}
