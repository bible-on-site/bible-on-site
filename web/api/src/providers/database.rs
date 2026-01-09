use std::env;
use std::sync::Arc;

use anyhow::Result;
use sea_orm::DatabaseConnection;

/// Database wrapper that is always Clone by using Arc internally.
/// This is necessary because sea-orm's DatabaseConnection doesn't implement Clone
/// when the mock feature is enabled (used in tests via dev-dependencies).
#[derive(Debug, Clone)]
pub struct Database {
    connection: Arc<DatabaseConnection>,
}

impl Database {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DB_URL").expect("Missing the DB_URL environment variable.");
        let connection = sea_orm::Database::connect(&database_url).await?;

        Ok(Self {
            connection: Arc::new(connection),
        })
    }

    /// Create a Database from an existing connection (useful for testing with MockDatabase)
    #[cfg(test)]
    pub fn from_connection(connection: DatabaseConnection) -> Self {
        Self {
            connection: Arc::new(connection),
        }
    }

    pub fn get_connection(&self) -> &DatabaseConnection {
        &self.connection
    }
}
