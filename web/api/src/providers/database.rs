use std::env;

use anyhow::Result;
use sea_orm::DatabaseConnection;

#[derive(Debug)]
pub struct Database {
    connection: DatabaseConnection,
}

impl Clone for Database {
    fn clone(&self) -> Self {
        // DatabaseConnection is internally Arc-wrapped, so we need to clone the Arc
        // For MockDatabaseConnection, we panic since it's not meant to be cloned
        #[cfg(test)]
        {
            panic!("Database::clone() is not supported in tests. Use references instead.");
        }
        #[cfg(not(test))]
        {
            Self {
                connection: self.connection.clone(),
            }
        }
    }
}

impl Database {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DB_URL").expect("Missing the DB_URL environment variable.");
        let connection = sea_orm::Database::connect(&database_url).await?;

        Ok(Self { connection })
    }

    /// Create a Database from an existing connection (useful for testing with MockDatabase)
    #[cfg(test)]
    pub fn from_connection(connection: DatabaseConnection) -> Self {
        Self { connection }
    }

    pub fn get_connection(&self) -> &DatabaseConnection {
        &self.connection
    }
}
