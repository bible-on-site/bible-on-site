use sea_orm::entity::prelude::*;

/// One stored mention annotation (`tanahpedia_mention_decoration`, #2516):
/// a span/intended-name annotation the pipeline computed over a pasuk or an
/// article body. Article rows carry `article_id` + `content_hash` (the
/// content fingerprint they were computed against); resolution to a live
/// entry is by `intended_name` at display time — an annotation record, not
/// an editorial FK-based article-to-entry link.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_mention_decoration")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub contract_version: i16,
    /// 'pasuk' | 'article' — the coordinate halves are mutually NULL.
    pub source_kind: String,
    pub perek_id: Option<i32>,
    pub pasuk_number: Option<i32>,
    pub segment_start: Option<i32>,
    pub segment_end: Option<i32>,
    pub article_id: Option<i32>,
    /// SHA-256 hex of the article `content` the annotation was computed on.
    pub content_hash: Option<String>,
    pub span_start: Option<i32>,
    pub span_end: Option<i32>,
    pub surface: String,
    pub dedupe_key: String,
    /// Name the annotation intends — resolves to an entry at display time.
    pub intended_name: String,
    pub entity_type: String,
    pub disambiguation: Option<String>,
    pub confidence: Option<Decimal>,
    /// 'auto' | 'manual' | 'held' | 'rejected'.
    pub acceptance: String,
    pub model_revision: String,
    pub source_hash: String,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::super::article::Entity",
        from = "Column::ArticleId",
        to = "super::super::article::Column::Id"
    )]
    Article,
}

impl Related<super::super::article::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Article.def()
    }
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {}
