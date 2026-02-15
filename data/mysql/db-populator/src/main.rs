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

    /// Path to static structure SQL file (sefarim, perakim, dates - rarely changes)
    #[arg(long, default_value = "../tanah_static_structure.sql")]
    static_structure_script: String,

    /// Path to dynamic structure SQL file (articles, dedications, authors - changes frequently)
    #[arg(long, default_value = "../tanah_dynamic_structure.sql")]
    dynamic_structure_script: String,

    /// Path to data SQL file
    #[arg(long, default_value = "../tanah_test_data.sql")]
    data_script: String,

    /// Path to tanah view data SQL file (sefarim and perakim)
    #[arg(long, default_value = "../tanah_sefarim_and_perakim_data.sql")]
    tanah_view_data_script: String,

    /// Path to perushim (commentaries) structure SQL file; skipped if missing
    #[arg(long, default_value = "../perushim_structure.sql")]
    perushim_structure_script: String,

    /// Path to perushim data SQL file; skipped if missing
    #[arg(long, default_value = "../perushim_data.sql")]
    perushim_data_script: String,

    /// Skip structure script execution
    #[arg(long, default_value = "false")]
    skip_structure: bool,

    /// Skip data script execution
    #[arg(long, default_value = "false")]
    skip_data: bool,

    /// Only drop the database (do not create or populate)
    #[arg(long, default_value = "false")]
    drop_only: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load .test.env if it exists
    let test_env_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.test.env");
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

    // Handle --drop-only mode
    if cli.drop_only {
        let drop_db_sql = format!("DROP DATABASE IF EXISTS `{}`", database_name);
        sqlx::raw_sql(&drop_db_sql)
            .execute(&mut conn)
            .await
            .with_context(|| format!("Failed to drop database '{}'", database_name))?;
        println!("Database '{}' dropped successfully", database_name);
        conn.close().await.ok();
        return Ok(());
    }

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
        // Execute static structure first (sefarim, perakim, dates)
        let static_structure_path = base_path.join(&cli.static_structure_script);
        execute_script(&mut conn, &static_structure_path, "static-structure").await?;

        // Execute dynamic structure (articles, dedications, authors)
        let dynamic_structure_path = base_path.join(&cli.dynamic_structure_script);
        execute_script(&mut conn, &dynamic_structure_path, "dynamic-structure").await?;

        let perushim_structure_path = base_path.join(&cli.perushim_structure_script);
        if perushim_structure_path.exists() {
            execute_script(&mut conn, &perushim_structure_path, "perushim-structure").await?;
        }
    }

    if !cli.skip_data {
        let data_path = base_path.join(&cli.data_script);
        execute_script(&mut conn, &data_path, "data").await?;

        let tanah_view_data_path = base_path.join(&cli.tanah_view_data_script);
        execute_script(&mut conn, &tanah_view_data_path, "tanah-view-data").await?;

        let perushim_data_path = base_path.join(&cli.perushim_data_script);
        if perushim_data_path.exists() {
            // Truncate perushim tables before loading full dataset — test data
            // (tanah_test_data.sql) may have already inserted rows with the same PKs.
            let truncate_sql = "SET FOREIGN_KEY_CHECKS = 0;\
                                TRUNCATE TABLE note;\
                                TRUNCATE TABLE perush;\
                                TRUNCATE TABLE parshan;\
                                SET FOREIGN_KEY_CHECKS = 1;";
            sqlx::raw_sql(truncate_sql)
                .execute(&mut conn)
                .await
                .context("Failed to truncate perushim tables before data load")?;

            execute_script_chunked(&mut conn, &perushim_data_path, "perushim-data").await?;
        }
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

    // Filter out USE statements - database is already selected via connection options
    let script = filter_use_statements(&script);

    // Use raw_sql to execute the entire script at once
    // This handles MySQL comments and other DDL that prepared statements don't support
    sqlx::raw_sql(&script)
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to execute {} script", script_type))?;

    println!("{} script executed successfully", script_type);
    Ok(())
}

/// Execute a large SQL script statement-by-statement to stay under max_allowed_packet.
/// Splits on single-line statements (line ends with ";") and multi-line note INSERTs (block ending with ");").
async fn execute_script_chunked(
    conn: &mut MySqlConnection,
    script_path: &Path,
    script_type: &str,
) -> Result<()> {
    println!(
        "Executing {} script (chunked) from {:?}...",
        script_type, script_path
    );

    let script = std::fs::read_to_string(script_path)
        .with_context(|| format!("Failed to read {} script: {:?}", script_type, script_path))?;

    let script = filter_use_statements(&script);
    let mut stmt_count = 0usize;

    let mut buf = String::new();
    for line in script.lines() {
        let trimmed = line.trim();
        if trimmed == ");" {
            // End of multi-line INSERT INTO note ... VALUES (...), (...), ... );
            buf.push_str(line);
            buf.push('\n');
            if !buf.trim().is_empty() {
                sqlx::raw_sql(buf.trim())
                    .execute(&mut *conn)
                    .await
                    .with_context(|| {
                        format!(
                            "Failed to execute {} statement #{}",
                            script_type,
                            stmt_count + 1
                        )
                    })?;
                stmt_count += 1;
            }
            buf.clear();
            continue;
        }
        if trimmed.ends_with(';') && trimmed != ");" {
            // Single-line statement (SET, INSERT parshan, INSERT perush, etc.)
            buf.push_str(line);
            buf.push('\n');
            if !buf.trim().is_empty() {
                sqlx::raw_sql(buf.trim())
                    .execute(&mut *conn)
                    .await
                    .with_context(|| {
                        format!(
                            "Failed to execute {} statement #{}",
                            script_type,
                            stmt_count + 1
                        )
                    })?;
                stmt_count += 1;
            }
            buf.clear();
            continue;
        }
        buf.push_str(line);
        buf.push('\n');
    }
    if !buf.trim().is_empty() {
        sqlx::raw_sql(buf.trim())
            .execute(&mut *conn)
            .await
            .with_context(|| format!("Failed to execute {} final statement", script_type))?;
        stmt_count += 1;
    }

    println!(
        "{} script executed successfully ({} statements)",
        script_type, stmt_count
    );
    Ok(())
}

/// Filters out USE statements from SQL script.
/// Database selection is handled by the connection options, not embedded in SQL files.
fn filter_use_statements(sql: &str) -> String {
    sql.lines()
        .filter(|line| {
            let trimmed = line.trim().to_uppercase();
            !trimmed.starts_with("USE ") && !trimmed.starts_with("USE`")
        })
        .collect::<Vec<_>>()
        .join("\n")
}
