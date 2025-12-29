use async_graphql::{ComplexObject, Context, Result, SimpleObject};

use crate::{providers::Database, services::articles_service};
use entities::perek::Model;

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Perek {
    pub id: i32,
    /// The perek ID (1-929) used in the 929 project
    pub perek_id: Option<i32>,
    /// The sefer ID this perek belongs to
    pub sefer_id: Option<i32>,
    /// Additional identifier for sefarim with multiple parts (e.g., שמואל א, שמואל ב)
    pub additional: Option<i32>,
    /// The perek number within the sefer/additional
    pub perek: Option<i32>,
    /// The date this perek is scheduled for in the 929 cycle
    pub date: Option<String>,
    /// The Hebrew date representation
    pub hebdate: Option<String>,
    /// The tseit (nightfall) time for this date
    pub tseit: Option<String>,
    /// The header/title for this perek
    pub header: Option<String>,
    /// The source reference
    pub source: Option<String>,
}

impl From<Model> for Perek {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            perek_id: value.perek_id,
            sefer_id: value.sefer_id,
            additional: value.additional,
            perek: value.perek,
            date: value.date.map(|d| d.to_string()),
            hebdate: value.hebdate,
            tseit: value.tseit.map(|t| t.to_string()),
            header: value.header,
            source: value.source,
        }
    }
}

#[ComplexObject]
impl Perek {
    /// Returns the count of articles for this perek
    #[graphql(name = "articlesCount")]
    async fn articles_count(&self, ctx: &Context<'_>) -> Result<i64> {
        // Use perek_id (1-929) for counting, not the DB id
        let perek_id = self.perek_id.unwrap_or(self.id);
        let db = ctx.data::<Database>()?;
        let count = articles_service::count_by_perek_id(db, perek_id).await?;
        Ok(count)
    }
}
