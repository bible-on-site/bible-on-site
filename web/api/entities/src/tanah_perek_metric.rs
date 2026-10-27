use sea_orm::entity::prelude::*;

/// Persisted whole-perek reading metric (issue #2607). `word_count` NULL =
/// metric unknown or not computed, 0 = verified empty body; `estimated_seconds`
/// is derived (ceil(word_count*60/words_per_minute)) and NULL when unknown.
/// No FK: deploys recreate tanah_perek — source_hash + calc_version detect
/// staleness instead of a cascade deleting still-valid metrics.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_perek_metric")]
pub struct Model {
    /// Canonical perek id (1-929).
    #[sea_orm(primary_key, auto_increment = false)]
    pub perek_id: i32,
    pub word_count: Option<i32>,
    pub estimated_seconds: Option<i32>,
    pub words_per_minute: i32,
    pub calc_version: i32,
    pub source_hash: String,
    pub computed_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C: ConnectionTrait>(self, _: &C, _insert: bool) -> Result<Self, DbErr> {
        Ok(self)
    }
}
