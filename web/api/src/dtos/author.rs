use async_graphql::{ComplexObject, SimpleObject};

use entities::author::Model;

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Author {
    pub id: i32,
    pub name: String,
    pub details: String,
}

impl From<Model> for Author {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            details: value.details,
        }
    }
}

#[ComplexObject]
impl Author {}
