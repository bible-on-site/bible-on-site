//! Data access services — reuse same query patterns as web/api.
//! Only includes the queries needed for PDF generation.

use crate::db::Database;
use entities::article::{Column as ArticleCol, Entity as ArticleEntity, Model as Article};
use entities::author::{Entity as AuthorEntity, Model as Author};
use entities::perek::{Column as PerekCol, Entity as PerekEntity, Model as Perek};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

/// Fetch perek metadata by perek_id (1-929).
#[allow(dead_code)]
pub async fn get_perek(db: &Database, perek_id: i32) -> anyhow::Result<Perek> {
    PerekEntity::find()
        .filter(PerekCol::PerekId.eq(perek_id))
        .one(db.get_connection())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Perek {} not found", perek_id))
}

/// Fetch all articles for a given perek.
pub async fn get_articles_by_perek(db: &Database, perek_id: i32) -> anyhow::Result<Vec<Article>> {
    Ok(ArticleEntity::find()
        .filter(ArticleCol::PerekId.eq(perek_id as i16))
        .all(db.get_connection())
        .await?)
}

/// Fetch author by ID.
pub async fn get_author(db: &Database, author_id: i32) -> anyhow::Result<Author> {
    AuthorEntity::find_by_id(author_id)
        .one(db.get_connection())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Author {} not found", author_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};

    fn perek_model(id: i32, perek_id: i32) -> Perek {
        Perek {
            id,
            perek_id: Some(perek_id),
            sefer_id: Some(1),
            sefer_name: Some("Genesis".to_string()),
            additional: None,
            additional_letter: None,
            perek: Some(1),
            perek_in_context: Some(1),
            date: None,
            hebdate: None,
            tseit: None,
            header: Some("Header".to_string()),
        }
    }

    fn article_model(id: i32, perek_id: i16, author_id: i16) -> Article {
        Article {
            id,
            perek_id,
            author_id,
            article_abstract: Some(format!("abstract-{id}")),
            name: format!("Article {id}"),
            priority: id as i8,
            content: Some(format!("content-{id}")),
        }
    }

    fn author_model(id: i32) -> Author {
        Author {
            id,
            name: format!("Author {id}"),
            details: format!("Details {id}"),
        }
    }

    #[tokio::test]
    async fn get_perek_returns_matching_metadata() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Perek, Vec<Perek>, _>([vec![perek_model(1, 7)]])
                .into_connection(),
        );

        let perek = get_perek(&db, 7).await.unwrap();

        assert_eq!(perek.id, 1);
        assert_eq!(perek.perek_id, Some(7));
        assert_eq!(perek.header.as_deref(), Some("Header"));
    }

    #[tokio::test]
    async fn get_perek_reports_missing_perek_id() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Perek, Vec<Perek>, _>([vec![]])
                .into_connection(),
        );

        let err = get_perek(&db, 999).await.unwrap_err();

        assert!(err.to_string().contains("Perek 999 not found"));
    }

    #[tokio::test]
    async fn get_articles_by_perek_returns_all_articles() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Article, Vec<Article>, _>([vec![
                    article_model(1, 5, 10),
                    article_model(2, 5, 11),
                ]])
                .into_connection(),
        );

        let articles = get_articles_by_perek(&db, 5).await.unwrap();

        assert_eq!(articles.len(), 2);
        assert_eq!(articles[0].perek_id, 5);
        assert_eq!(articles[1].author_id, 11);
    }

    #[tokio::test]
    async fn get_author_returns_author_or_not_found() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Author, Vec<Author>, _>([vec![author_model(4)]])
                .append_query_results::<Author, Vec<Author>, _>([vec![]])
                .into_connection(),
        );

        let author = get_author(&db, 4).await.unwrap();
        assert_eq!(author.name, "Author 4");

        let err = get_author(&db, 404).await.unwrap_err();
        assert!(err.to_string().contains("Author 404 not found"));
    }
}
