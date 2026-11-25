use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanahpedia_image")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// Served asset URL (CDN/S3 public object or external host).
    pub url: String,
    pub width: Option<i16>,
    pub height: Option<i16>,
    pub alt_text: String,
    pub caption: Option<String>,
    /// Artist / photographer when known.
    pub creator: Option<String>,
    /// Concise display credit line.
    pub credit_line: Option<String>,
    /// Holding collection/site, e.g. Wikimedia Commons.
    pub source_name: Option<String>,
    /// Source item page URL.
    pub source_url: Option<String>,
    /// License / rights statement; `None` when public domain.
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub is_public_domain: bool,
    /// Changes from the source item, e.g. crops.
    pub modifications: Option<String>,
    /// PRIVATE: permission/public-domain evidence; never publicly exposed.
    pub permission_evidence: Option<String>,
    /// Published to readers only after evidence is recorded.
    pub is_public: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
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
