use async_graphql::SimpleObject;

use entities::author::Model;

#[derive(SimpleObject, Debug, Clone)]
pub struct Author {
    pub id: i32,
    pub name: String,
    pub details: String,
    /// Count of articles written by this author — always pre-computed by the
    /// producer (the starter query batches it to avoid N+1).
    pub articles_count: i64,
}

impl Author {
    /// Create an Author with a pre-computed articles count
    pub fn with_articles_count(model: Model, count: i64) -> Self {
        Self {
            id: model.id,
            name: model.name,
            details: model.details,
            articles_count: count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn author_model() -> Model {
        Model {
            id: 7,
            name: "Author".to_string(),
            details: "Details".to_string(),
        }
    }

    #[test]
    fn with_articles_count_sets_the_count() {
        let author = Author::with_articles_count(author_model(), 12);

        assert_eq!(author.id, 7);
        assert_eq!(author.name, "Author");
        assert_eq!(author.details, "Details");
        assert_eq!(author.articles_count, 12);
    }
}
