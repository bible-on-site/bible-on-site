//! Database provider — mirrors web/api's Database wrapper.
//! Reuses the same entities crate and connection pattern.

use std::env;
use std::sync::Arc;

use anyhow::Result;
use sea_orm::DatabaseConnection;

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
