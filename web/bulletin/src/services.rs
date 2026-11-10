//! Data access services — reuse same query patterns as web/api.
//! Only includes the queries needed for PDF generation.

use crate::db::Database;
use entities::article::{Column as ArticleCol, Entity as ArticleEntity, Model as Article};
use entities::author::{Entity as AuthorEntity, Model as Author};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

/// Fetch all articles for a given perek.
#[allow(dead_code)]
pub async fn get_articles_by_perek(db: &Database, perek_id: i32) -> anyhow::Result<Vec<Article>> {
    Ok(ArticleEntity::find()
        .filter(ArticleCol::PerekId.eq(perek_id as i16))
        .all(db.get_connection())
        .await?)
}

/// Fetch author by ID.
#[allow(dead_code)]
pub async fn get_author(db: &Database, author_id: i32) -> anyhow::Result<Author> {
    AuthorEntity::find_by_id(author_id)
        .one(db.get_connection())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Author {} not found", author_id))
}

/// Render rows per perek with the author name prepended.
pub type ArticleRows = std::collections::HashMap<i16, Vec<(String, String, String)>>;

/// Fetch every article (with its author) for all `perakim_ids` in two queries:
/// one for the articles, one for all referenced authors. `article_ids`/`author_ids`
/// filters match `get_articles_by_perek` + caller-side filtering in handlers.rs.
/// Returns an empty map when no database is configured (`db` is `None`).
pub async fn get_articles_and_authors(
    db: Option<&Database>,
    perakim_ids: &[i32],
    article_ids: &[i32],
    author_ids: &[i32],
) -> anyhow::Result<ArticleRows> {
    let Some(db) = db else {
        return Ok(Default::default());
    };
    let perek_ids: Vec<i16> = perakim_ids.iter().map(|&id| id as i16).collect();
    let author_ids_i16: Vec<i16> = author_ids.iter().map(|&id| id as i16).collect();

    let mut article_query = ArticleEntity::find().filter(ArticleCol::PerekId.is_in(perek_ids));
    if !article_ids.is_empty() {
        article_query = article_query.filter(ArticleCol::Id.is_in(article_ids.to_vec()));
    }
    if !author_ids_i16.is_empty() {
        article_query = article_query.filter(ArticleCol::AuthorId.is_in(author_ids_i16));
    }
    let articles = article_query.all(db.get_connection()).await?;

    let author_ids_needed: Vec<i32> = articles
        .iter()
        .map(|a| a.author_id as i32)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let authors_rows = AuthorEntity::find()
        .filter(entities::author::Column::Id.is_in(author_ids_needed))
        .all(db.get_connection())
        .await?;
    let authors = authors_rows
        .into_iter()
        .map(|a| (a.id, a.name))
        .collect::<std::collections::HashMap<_, _>>();

    let mut rows: ArticleRows = std::collections::HashMap::new();
    for article in articles {
        let author_name = authors
            .get(&(article.author_id as i32))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Author {} not found", article.author_id))?;
        rows.entry(article.perek_id).or_default().push((
            article.name.clone(),
            author_name,
            article.content.clone().unwrap_or_default(),
        ));
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, MockDatabase};

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
    async fn get_articles_and_authors_batches_articles_and_authors() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Article, Vec<Article>, _>([vec![
                    article_model(1, 5, 10),
                    article_model(2, 7, 10),
                    article_model(3, 7, 11),
                ]])
                .append_query_results::<Author, Vec<Author>, _>([vec![
                    author_model(10),
                    author_model(11),
                ]])
                .into_connection(),
        );

        let rows = get_articles_and_authors(Some(&db), &[5, 7], &[], &[])
            .await
            .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows.get(&5).unwrap().len(), 1);
        let perek7 = rows.get(&7).unwrap();
        assert_eq!(perek7.len(), 2);
        assert_eq!(perek7[0].1, "Author 10");
        assert_eq!(perek7[1].1, "Author 11");
        assert_eq!(db.get_connection().clone().into_transaction_log().len(), 2);
    }

    #[tokio::test]
    async fn get_articles_and_authors_errors_on_missing_author() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Article, Vec<Article>, _>([vec![article_model(1, 5, 10)]])
                .append_query_results::<Author, Vec<Author>, _>([vec![]])
                .into_connection(),
        );

        let err = get_articles_and_authors(Some(&db), &[5], &[], &[])
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Author 10 not found"));
    }

    #[tokio::test]
    async fn get_articles_and_authors_returns_empty_without_database() {
        let rows = get_articles_and_authors(None, &[5, 7], &[], &[])
            .await
            .unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn get_articles_and_authors_applies_article_and_author_filters() {
        let db = Database::from_connection(
            MockDatabase::new(DatabaseBackend::MySql)
                .append_query_results::<Article, Vec<Article>, _>([vec![article_model(1, 5, 10)]])
                .append_query_results::<Author, Vec<Author>, _>([vec![author_model(10)]])
                .into_connection(),
        );

        let rows = get_articles_and_authors(Some(&db), &[5], &[1, 2], &[10])
            .await
            .unwrap();

        assert_eq!(rows.get(&5).unwrap().len(), 1);
        assert_eq!(rows.get(&5).unwrap()[0].1, "Author 10");
        assert_eq!(db.get_connection().clone().into_transaction_log().len(), 2);
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
