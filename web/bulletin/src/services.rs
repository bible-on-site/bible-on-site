//! Data access services — reuse same query patterns as web/api.
//! Only includes the queries needed for PDF generation.

use crate::db::Database;
use entities::article::{Column as ArticleCol, Entity as ArticleEntity, Model as Article};
use entities::author::{Column as AuthorCol, Entity as AuthorEntity, Model as Author};
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

/// Fetch all articles for the given perakim in a single query.
pub async fn get_articles_by_perakim(
    db: &Database,
    perakim_ids: &[i32],
) -> anyhow::Result<Vec<Article>> {
    Ok(ArticleEntity::find()
        .filter(ArticleCol::PerekId.is_in(perakim_ids.iter().map(|&id| id as i16)))
        .all(db.get_connection())
        .await?)
}

/// Fetch authors by IDs in a single query.
pub async fn get_authors(db: &Database, author_ids: &[i32]) -> anyhow::Result<Vec<Author>> {
    Ok(AuthorEntity::find()
        .filter(AuthorCol::Id.is_in(author_ids.iter().copied()))
        .all(db.get_connection())
        .await?)
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
            pasuk_count: Some(31),
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
            coverage_verified: false,
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
    async fn get_articles_by_perakim_returns_all_articles() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Article, Vec<Article>, _>([vec![
                    article_model(1, 5, 10),
                    article_model(2, 5, 11),
                    article_model(3, 6, 10),
                ]])
                .into_connection(),
        );

        let articles = get_articles_by_perakim(&db, &[5, 6]).await.unwrap();

        assert_eq!(articles.len(), 3);
        assert_eq!(articles[0].perek_id, 5);
        assert_eq!(articles[1].author_id, 11);
        assert_eq!(articles[2].perek_id, 6);
    }

    #[tokio::test]
    async fn get_authors_returns_matching_authors() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Author, Vec<Author>, _>([vec![
                    author_model(4),
                    author_model(7),
                ]])
                .into_connection(),
        );

        let authors = get_authors(&db, &[4, 7]).await.unwrap();

        assert_eq!(authors.len(), 2);
        assert_eq!(authors[0].name, "Author 4");
        assert_eq!(authors[1].id, 7);
    }
}
