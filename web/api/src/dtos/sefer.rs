use async_graphql::{ComplexObject, SimpleObject};

use entities::sefer::Model;

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Sefer {
    pub id: i32,
    pub name: String,
    /// The tanachUS name - can be a simple string like "Gen" or a JSON object
    /// for sefarim with additionals like {"1":"1 Sam","2":"2 Sam"}
    pub tanach_us_name: Option<String>,
}

impl From<Model> for Sefer {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            tanach_us_name: value.tanach_us_name,
        }
    }
}

#[ComplexObject]
impl Sefer {}
