use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tanah_article")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub perek_id: i16,
    pub author_id: i16,
    #[sea_orm(column_name = "abstract", column_type = "Text", nullable)]
    pub article_abstract: Option<String>,
    pub name: String,
    pub priority: i8,
    #[sea_orm(column_type = "Text", nullable)]
    pub content: Option<String>,
    /// TRUE: covering-source rows are the verified verse-level coverage.
    /// FALSE: coverage unknown — consumers use the primary perek only.
    pub coverage_verified: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::article_covering_source::Entity")]
    ArticleCoveringSource,
}

impl Related<super::article_covering_source::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ArticleCoveringSource.def()
    }
}

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
