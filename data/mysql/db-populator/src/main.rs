//! MySQL Database Populator
//!
//! Populates a MySQL database with Tanah structure and test data.
//! This is a Rust port of the legacy TypeScript populate-test-db.mts script.

use anyhow::{Context, Result};
use clap::Parser;
use sqlx::mysql::MySqlConnectOptions;
use sqlx::{ConnectOptions, Connection, MySqlConnection};
use std::path::Path;
use std::str::FromStr;

#[derive(Parser)]
#[command(name = "db-populator")]
#[command(about = "Populate MySQL database with Tanah structure and test data")]
struct Cli {
    /// Database URL (e.g., mysql://user:pass@host:port/database)
    /// Can also be set via DB_URL environment variable
    #[arg(long, env = "DB_URL")]
    db_url: String,

    /// Path to structure SQL file
    #[arg(long, default_value = "../tanah_structure.sql")]
    structure_script: String,

    /// Path to data SQL file
    #[arg(long, default_value = "../tanah_test_data.sql")]
    data_script: String,

    /// Path to tanah view data SQL file (sefarim and perakim)
    #[arg(long, default_value = "../tanah_sefarim_and_perakim_data.sql")]
    tanah_view_data_script: String,

    /// Skip structure script execution
    #[arg(long, default_value = "false")]
    skip_structure: bool,

    /// Skip data script execution
    #[arg(long, default_value = "false")]
    skip_data: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load .test.env if it exists
    let test_env_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.test.env");
    if test_env_path.exists() {
        dotenvy::from_path(&test_env_path).ok();
    }

    let cli = Cli::parse();

    // Parse the database URL
    let options = MySqlConnectOptions::from_str(&cli.db_url)
        .context("Failed to parse database URL")?
        .disable_statement_logging();

    // Extract database name from options
    let database_name = options
        .get_database()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "tanah_test".to_string());

    // First connect without specifying a database to create it if needed
    let options_no_db = options.clone().database("");

    println!(
        "Connecting to database at {}:{}...",
        options.get_host(),
        options.get_port()
    );

    let mut conn = MySqlConnection::connect_with(&options_no_db)
        .await
        .context("Failed to connect to MySQL server")?;

    // Create database if it doesn't exist
    let create_db_sql = format!(
        "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb3",
        database_name
    );
    sqlx::raw_sql(&create_db_sql)
        .execute(&mut conn)
        .await
        .with_context(|| format!("Failed to create database '{}'", database_name))?;
    println!("Database '{}' ensured to exist", database_name);

    // Close initial connection
    conn.close().await.ok();

    // Reconnect to the specific database
    let mut conn = MySqlConnection::connect_with(&options)
        .await
        .context("Failed to connect to database")?;

    println!("Connected to database '{}'", database_name);

    // Resolve script paths relative to this crate's directory
    let base_path = Path::new(env!("CARGO_MANIFEST_DIR"));

    if !cli.skip_structure {
        let structure_path = base_path.join(&cli.structure_script);
        execute_script(&mut conn, &structure_path, "structure").await?;
    }

    if !cli.skip_data {
        let data_path = base_path.join(&cli.data_script);
        execute_script(&mut conn, &data_path, "data").await?;

        let tanah_view_data_path = base_path.join(&cli.tanah_view_data_script);
        execute_script(&mut conn, &tanah_view_data_path, "tanah-view-data").await?;
    }

    conn.close().await.context("Failed to close connection")?;
    println!("Database connection closed");
    println!("Database population completed successfully");

    Ok(())
}

async fn execute_script(
    conn: &mut MySqlConnection,
    script_path: &Path,
    script_type: &str,
) -> Result<()> {
    println!("Executing {} script from {:?}...", script_type, script_path);

    let script = std::fs::read_to_string(script_path)
        .with_context(|| format!("Failed to read {} script: {:?}", script_type, script_path))?;

    // Use raw_sql to execute the entire script at once
    // This handles USE statements, MySQL comments, and other DDL that prepared statements don't support
    sqlx::raw_sql(&script)
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to execute {} script", script_type))?;

    println!("{} script executed successfully", script_type);
    Ok(())
}
