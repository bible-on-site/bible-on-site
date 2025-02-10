use std::env;

use anyhow::Result;
use sea_orm::DatabaseConnection;

#[derive(Clone, Debug)]
pub struct Database {
    connection: DatabaseConnection,
}

impl Database {
    pub async fn new() -> Result<Self> {
        let database_url = env::var("DB_URL").expect("Missing the DB_URL environment variable.");
        let connection = sea_orm::Database::connect(&database_url).await?;

        Ok(Self { connection })
    }

    pub fn get_connection(&self) -> &DatabaseConnection {
        &self.connection
    }
}
