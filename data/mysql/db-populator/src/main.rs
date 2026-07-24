//! MySQL Database Populator
//!
//! Populates a MySQL database with Tanah structure and test data.
//! This is a Rust port of the legacy TypeScript populate-test-db.mts script.

use anyhow::{Context, Result};
use clap::Parser;
use sqlx_core::connection::{ConnectOptions, Connection};
use sqlx_core::query_scalar::query_scalar;
use sqlx_core::raw_sql::raw_sql;
use sqlx_core::sql_str::AssertSqlSafe;
use sqlx_mysql::{MySql, MySqlConnectOptions, MySqlConnection};
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

    /// Path to Tanahpedia structure SQL file
    #[arg(long, default_value = "../tanahpedia_structure.sql")]
    tanahpedia_structure_script: String,

    /// Path to Tanahpedia source-citation upgrade SQL file
    #[arg(long, default_value = "../tanahpedia_alter_source_citation.sql")]
    tanahpedia_source_citation_upgrade_script: String,

    /// Path to Tanahpedia person-source-citation upgrade SQL file (the related
    /// person's own citation on a union, distinct from the union's relationship
    /// citation stored in source_citation)
    #[arg(long, default_value = "../tanahpedia_alter_person_source_citation.sql")]
    tanahpedia_person_source_citation_upgrade_script: String,

    /// Path to Tanahpedia lookup seed SQL file
    #[arg(long, default_value = "../tanahpedia_seed_data.sql")]
    tanahpedia_seed_script: String,

    /// Path to Tanahpedia incremental lookup SQL file
    #[arg(long, default_value = "../tanahpedia_incremental_lookups.sql")]
    tanahpedia_incremental_lookups_script: String,

    /// Path to Tanahpedia legacy content seed SQL file
    #[arg(long, default_value = "../tanahpedia_legacy_migration.sql")]
    tanahpedia_legacy_script: String,

    /// Path to Tanahpedia Shimshon family demo SQL file
    #[arg(long, default_value = "../tanahpedia_family_shimshon_data.sql")]
    tanahpedia_family_shimshon_script: String,

    /// Path to Tanahpedia Jacob family demo SQL file
    #[arg(long, default_value = "../tanahpedia_family_jacob_data.sql")]
    tanahpedia_family_jacob_script: String,

    /// Path to Tanahpedia place demo SQL file
    #[arg(long, default_value = "../tanahpedia_place_eretz_yisrael_data.sql")]
    tanahpedia_place_eretz_yisrael_script: String,

    /// Path to Tanahpedia edge-case lab SQL file
    #[arg(long, default_value = "../tanahpedia_family_edge_lab_data.sql")]
    tanahpedia_edge_lab_script: String,

    /// Skip structure script execution
    #[arg(long, default_value = "false")]
    skip_structure: bool,

    /// Skip data script execution
    #[arg(long, default_value = "false")]
    skip_data: bool,

    /// Skip bundled Tanah test articles/authors while keeping Tanah view, perushim, and Tanahpedia data
    #[arg(long, default_value = "false")]
    skip_tanah_test_data: bool,

    /// Apply only the safe Tanahpedia structure upgrade/create path
    #[arg(long, default_value = "false")]
    tanahpedia_structure_only: bool,

    /// Apply only Tanahpedia safe baseline lookup seed/upgrade path
    #[arg(long, default_value = "false")]
    tanahpedia_baseline_only: bool,

    /// Apply only Tanahpedia family/place demo content path
    #[arg(long, default_value = "false")]
    tanahpedia_families_only: bool,

    /// Apply only Tanahpedia family edge-case lab data
    #[arg(long, default_value = "false")]
    tanahpedia_edge_lab_only: bool,

    /// Ensure Tanahpedia tables and lookup seed exist before targeted Tanahpedia content scripts
    #[arg(long, default_value = "false")]
    ensure_tanahpedia_seed: bool,

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

    // Quote the database name as a MySQL identifier. A backtick inside an
    // identifier is escaped by doubling it, preventing a name parsed from the
    // connection URL from breaking out of the backtick-quoted context.
    let database_ident = quote_mysql_identifier_part(&database_name);

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
        let drop_db_sql = format!("DROP DATABASE IF EXISTS `{}`", database_ident);
        raw_sql(AssertSqlSafe(drop_db_sql))
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
        database_ident
    );
    raw_sql(AssertSqlSafe(create_db_sql))
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

    let tanahpedia_scripts = TanahpediaScripts::from_cli(base_path, &cli);

    if cli.tanahpedia_structure_only {
        apply_tanahpedia_safe_structure(&mut conn, &tanahpedia_scripts).await?;
        conn.close().await.context("Failed to close connection")?;
        println!("Tanahpedia structure upgrade completed successfully");
        return Ok(());
    }

    if cli.tanahpedia_baseline_only {
        apply_tanahpedia_safe_baseline(&mut conn, &tanahpedia_scripts, cli.ensure_tanahpedia_seed)
            .await?;
        conn.close().await.context("Failed to close connection")?;
        println!("Tanahpedia baseline seed completed successfully");
        return Ok(());
    }

    if cli.tanahpedia_families_only {
        if cli.ensure_tanahpedia_seed {
            apply_tanahpedia_safe_baseline(&mut conn, &tanahpedia_scripts, true).await?;
        } else {
            apply_tanahpedia_safe_upgrades(&mut conn, &tanahpedia_scripts).await?;
            apply_tanahpedia_incremental_lookups(&mut conn, &tanahpedia_scripts).await?;
        }
        apply_tanahpedia_family_and_place_content(&mut conn, &tanahpedia_scripts, true).await?;
        conn.close().await.context("Failed to close connection")?;
        println!("Tanahpedia family/place data completed successfully");
        return Ok(());
    }

    if cli.tanahpedia_edge_lab_only {
        if cli.ensure_tanahpedia_seed {
            apply_tanahpedia_safe_baseline(&mut conn, &tanahpedia_scripts, true).await?;
        } else {
            apply_tanahpedia_safe_upgrades(&mut conn, &tanahpedia_scripts).await?;
        }
        execute_optional_script(
            &mut conn,
            &tanahpedia_scripts.edge_lab,
            "tanahpedia-edge-lab",
        )
        .await?;
        conn.close().await.context("Failed to close connection")?;
        println!("Tanahpedia edge lab data completed successfully");
        return Ok(());
    }

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

        apply_tanahpedia_rebuild_structure(&mut conn, &tanahpedia_scripts).await?;
    }

    if !cli.skip_data {
        if !cli.skip_tanah_test_data {
            let data_path = base_path.join(&cli.data_script);
            execute_script(&mut conn, &data_path, "data").await?;
        }

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
            raw_sql(truncate_sql)
                .execute(&mut conn)
                .await
                .context("Failed to truncate perushim tables before data load")?;

            execute_script_chunked(&mut conn, &perushim_data_path, "perushim-data").await?;
        }

        apply_tanahpedia_full_seed(&mut conn, &tanahpedia_scripts).await?;
    }

    conn.close().await.context("Failed to close connection")?;
    println!("Database connection closed");
    println!("Database population completed successfully");

    Ok(())
}

struct TanahpediaScripts {
    structure: std::path::PathBuf,
    source_citation_upgrade: std::path::PathBuf,
    person_source_citation_upgrade: std::path::PathBuf,
    seed: std::path::PathBuf,
    incremental_lookups: std::path::PathBuf,
    legacy: std::path::PathBuf,
    family_shimshon: std::path::PathBuf,
    family_jacob: std::path::PathBuf,
    place_eretz_yisrael: std::path::PathBuf,
    edge_lab: std::path::PathBuf,
}

impl TanahpediaScripts {
    fn from_cli(base_path: &Path, cli: &Cli) -> Self {
        Self {
            structure: base_path.join(&cli.tanahpedia_structure_script),
            source_citation_upgrade: base_path.join(&cli.tanahpedia_source_citation_upgrade_script),
            person_source_citation_upgrade: base_path
                .join(&cli.tanahpedia_person_source_citation_upgrade_script),
            seed: base_path.join(&cli.tanahpedia_seed_script),
            incremental_lookups: base_path.join(&cli.tanahpedia_incremental_lookups_script),
            legacy: base_path.join(&cli.tanahpedia_legacy_script),
            family_shimshon: base_path.join(&cli.tanahpedia_family_shimshon_script),
            family_jacob: base_path.join(&cli.tanahpedia_family_jacob_script),
            place_eretz_yisrael: base_path.join(&cli.tanahpedia_place_eretz_yisrael_script),
            edge_lab: base_path.join(&cli.tanahpedia_edge_lab_script),
        }
    }
}

async fn apply_tanahpedia_rebuild_structure(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
) -> Result<()> {
    execute_optional_script(conn, &scripts.structure, "tanahpedia-structure").await?;
    apply_tanahpedia_safe_upgrades(conn, scripts).await
}

async fn apply_tanahpedia_safe_structure(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
) -> Result<()> {
    execute_optional_transformed_script(
        conn,
        &scripts.structure,
        "tanahpedia-safe-structure",
        make_structure_sql_safe,
    )
    .await?;
    apply_tanahpedia_safe_upgrades(conn, scripts).await
}

async fn apply_tanahpedia_safe_baseline(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
    ensure_structure: bool,
) -> Result<()> {
    if ensure_structure {
        apply_tanahpedia_safe_structure(conn, scripts).await?;
    } else {
        apply_tanahpedia_safe_upgrades(conn, scripts).await?;
    }

    execute_optional_transformed_script(
        conn,
        &scripts.seed,
        "tanahpedia-safe-seed",
        make_insert_sql_ignore_duplicates,
    )
    .await?;
    apply_tanahpedia_incremental_lookups(conn, scripts).await?;
    Ok(())
}

async fn apply_tanahpedia_safe_upgrades(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
) -> Result<()> {
    apply_source_citation_upgrade(conn, &scripts.source_citation_upgrade).await?;
    apply_person_source_citation_upgrade(conn, &scripts.person_source_citation_upgrade).await
}

async fn apply_tanahpedia_incremental_lookups(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
) -> Result<()> {
    execute_optional_script(
        conn,
        &scripts.incremental_lookups,
        "tanahpedia-incremental-lookups",
    )
    .await
}

async fn apply_tanahpedia_full_seed(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
) -> Result<()> {
    apply_tanahpedia_safe_baseline(conn, scripts, false).await?;

    if !tanahpedia_has_entries(conn).await? {
        execute_optional_script(conn, &scripts.legacy, "tanahpedia-legacy-migration").await?;
    }

    apply_tanahpedia_family_and_place_content(conn, scripts, false).await
}

async fn apply_tanahpedia_family_and_place_content(
    conn: &mut MySqlConnection,
    scripts: &TanahpediaScripts,
    force: bool,
) -> Result<()> {
    if force || tanahpedia_person_exists(conn, "שמשון").await? {
        execute_optional_script(conn, &scripts.family_shimshon, "tanahpedia-family-shimshon")
            .await?;
    }

    if force || !tanahpedia_entry_exists(conn, "יעקב").await? {
        execute_optional_script(conn, &scripts.family_jacob, "tanahpedia-family-jacob").await?;
    }

    if force || !tanahpedia_entry_exists(conn, "eretz-yisrael").await? {
        execute_optional_script(
            conn,
            &scripts.place_eretz_yisrael,
            "tanahpedia-place-eretz-yisrael",
        )
        .await?;
    }

    Ok(())
}

async fn apply_source_citation_upgrade(
    conn: &mut MySqlConnection,
    script_path: &Path,
) -> Result<()> {
    apply_column_add_if_missing(
        conn,
        script_path,
        "tanahpedia_person_union",
        "source_citation",
        "VARCHAR(400) NULL",
    )
    .await?;
    apply_column_add_if_missing(
        conn,
        script_path,
        "tanahpedia_person_parent_child",
        "source_citation",
        "VARCHAR(400) NULL",
    )
    .await
}

async fn apply_person_source_citation_upgrade(
    conn: &mut MySqlConnection,
    script_path: &Path,
) -> Result<()> {
    apply_column_add_if_missing(
        conn,
        script_path,
        "tanahpedia_person_union",
        "person_source_citation",
        "VARCHAR(400) NULL",
    )
    .await
}

async fn apply_column_add_if_missing(
    conn: &mut MySqlConnection,
    script_path: &Path,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<()> {
    if column_exists(conn, table_name, column_name).await? {
        println!("Column '{}.{}' already exists", table_name, column_name);
        return Ok(());
    }

    if !script_path.exists() {
        println!(
            "Skipping missing Tanahpedia upgrade script at {:?}",
            script_path
        );
        return Ok(());
    }

    let sql = format!(
        "ALTER TABLE `{}` ADD COLUMN `{}` {}",
        quote_mysql_identifier_part(table_name),
        quote_mysql_identifier_part(column_name),
        column_definition
    );
    raw_sql(AssertSqlSafe(sql))
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to add column '{}.{}'", table_name, column_name))?;

    println!("Column '{}.{}' added successfully", table_name, column_name);
    Ok(())
}

async fn column_exists(
    conn: &mut MySqlConnection,
    table_name: &str,
    column_name: &str,
) -> Result<bool> {
    let count: i64 = query_scalar::<MySql, i64>(
        "SELECT COUNT(*) \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = DATABASE() \
           AND TABLE_NAME = ? \
           AND COLUMN_NAME = ?",
    )
    .bind(table_name)
    .bind(column_name)
    .fetch_one(&mut *conn)
    .await
    .with_context(|| format!("Failed to check column '{}.{}'", table_name, column_name))?;

    Ok(count > 0)
}

async fn tanahpedia_has_entries(conn: &mut MySqlConnection) -> Result<bool> {
    table_count(conn, "tanahpedia_entry")
        .await
        .map(|count| count > 0)
}

async fn tanahpedia_entry_exists(conn: &mut MySqlConnection, unique_name: &str) -> Result<bool> {
    let count: i64 =
        query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanahpedia_entry WHERE unique_name = ?")
            .bind(unique_name)
            .fetch_one(&mut *conn)
            .await
            .with_context(|| format!("Failed to check Tanahpedia entry '{}'", unique_name))?;
    Ok(count > 0)
}

async fn tanahpedia_person_exists(conn: &mut MySqlConnection, name: &str) -> Result<bool> {
    let count: i64 = query_scalar::<MySql, i64>(
        "SELECT COUNT(*) \
         FROM tanahpedia_person p \
         INNER JOIN tanahpedia_entity e ON e.id = p.entity_id \
         WHERE e.name = ?",
    )
    .bind(name)
    .fetch_one(&mut *conn)
    .await
    .with_context(|| format!("Failed to check Tanahpedia person '{}'", name))?;
    Ok(count > 0)
}

async fn table_count(conn: &mut MySqlConnection, table_name: &str) -> Result<i64> {
    let sql = format!(
        "SELECT COUNT(*) FROM `{}`",
        quote_mysql_identifier_part(table_name)
    );
    query_scalar::<MySql, i64>(AssertSqlSafe(sql))
        .fetch_one(&mut *conn)
        .await
        .with_context(|| format!("Failed to count table '{}'", table_name))
}

fn quote_mysql_identifier_part(identifier: &str) -> String {
    identifier.replace('`', "``")
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
    raw_sql(AssertSqlSafe(script))
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to execute {} script", script_type))?;

    println!("{} script executed successfully", script_type);
    Ok(())
}

async fn execute_optional_script(
    conn: &mut MySqlConnection,
    script_path: &Path,
    script_type: &str,
) -> Result<()> {
    if !script_path.exists() {
        println!(
            "Skipping missing {} script at {:?}",
            script_type, script_path
        );
        return Ok(());
    }

    execute_script(conn, script_path, script_type).await
}

async fn execute_optional_transformed_script(
    conn: &mut MySqlConnection,
    script_path: &Path,
    script_type: &str,
    transform: fn(String) -> String,
) -> Result<()> {
    if !script_path.exists() {
        println!(
            "Skipping missing {} script at {:?}",
            script_type, script_path
        );
        return Ok(());
    }

    println!("Executing {} script from {:?}...", script_type, script_path);

    let script = std::fs::read_to_string(script_path)
        .with_context(|| format!("Failed to read {} script: {:?}", script_type, script_path))?;
    let script = transform(filter_use_statements(&script));

    raw_sql(AssertSqlSafe(script))
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to execute {} script", script_type))?;

    println!("{} script executed successfully", script_type);
    Ok(())
}

fn make_structure_sql_safe(sql: String) -> String {
    sql.lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("DROP TABLE IF EXISTS") {
                None
            } else if trimmed.starts_with("CREATE TABLE IF NOT EXISTS ") {
                Some(line.to_string())
            } else if trimmed.starts_with("CREATE TABLE ") {
                Some(line.replacen("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1))
            } else {
                Some(line.to_string())
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn make_insert_sql_ignore_duplicates(sql: String) -> String {
    sql.replace("INSERT INTO ", "INSERT IGNORE INTO ")
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
    let statements = split_sql_script_statements(&script);

    for (index, statement) in statements.iter().enumerate() {
        raw_sql(AssertSqlSafe(statement.as_str()))
            .execute(&mut *conn)
            .await
            .with_context(|| {
                format!("Failed to execute {} statement #{}", script_type, index + 1)
            })?;
    }

    println!(
        "{} script executed successfully ({} statements)",
        script_type,
        statements.len()
    );
    Ok(())
}

fn split_sql_script_statements(script: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut buf = String::new();

    for line in script.lines() {
        let trimmed = line.trim();
        if trimmed == ");" {
            buf.push_str(line);
            buf.push('\n');
            if !buf.trim().is_empty() {
                statements.push(buf.trim().to_string());
            }
            buf.clear();
            continue;
        }
        if trimmed.ends_with(';') && trimmed != ");" {
            buf.push_str(line);
            buf.push('\n');
            if !buf.trim().is_empty() {
                statements.push(buf.trim().to_string());
            }
            buf.clear();
            continue;
        }
        buf.push_str(line);
        buf.push('\n');
    }

    if !buf.trim().is_empty() {
        statements.push(buf.trim().to_string());
    }

    statements
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

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use sqlx_core::raw_sql::raw_sql;
    use std::env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn cli_from(args: &[&str]) -> Cli {
        let mut argv = vec!["db-populator", "--db-url", "mysql://u:p@localhost/test"];
        argv.extend_from_slice(args);
        Cli::parse_from(argv)
    }

    #[test]
    fn filter_use_statements_removes_database_selection() {
        let sql = "USE `tanah`;\nSELECT 1;\n  use tanah_test;\nINSERT INTO t VALUES (1);";

        assert_eq!(
            filter_use_statements(sql),
            "SELECT 1;\nINSERT INTO t VALUES (1);",
        );
    }

    #[test]
    fn safe_structure_transform_removes_drops_and_makes_creates_idempotent() {
        let sql = r#"
-- comment
DROP TABLE IF EXISTS `tanahpedia_entry`;
CREATE TABLE `tanahpedia_entry` (
    `id` char(36) NOT NULL
);
  DROP TABLE IF EXISTS `tanahpedia_person`;
CREATE TABLE `tanahpedia_person` (
    `id` char(36) NOT NULL
);
"#;

        let transformed = make_structure_sql_safe(sql.to_string());

        assert!(!transformed.contains("DROP TABLE IF EXISTS"));
        assert!(transformed.contains("CREATE TABLE IF NOT EXISTS `tanahpedia_entry`"));
        assert!(transformed.contains("CREATE TABLE IF NOT EXISTS `tanahpedia_person`"));
        assert!(transformed.contains("-- comment"));
    }

    #[test]
    fn safe_structure_transform_leaves_existing_idempotent_creates_alone() {
        let sql = "CREATE TABLE IF NOT EXISTS `already_safe` (`id` int);";

        assert_eq!(make_structure_sql_safe(sql.to_string()), sql);
    }

    #[test]
    fn insert_transform_makes_plain_inserts_ignore_duplicates() {
        let sql = "INSERT INTO a VALUES (1);\nINSERT INTO b VALUES (2);";

        assert_eq!(
            make_insert_sql_ignore_duplicates(sql.to_string()),
            "INSERT IGNORE INTO a VALUES (1);\nINSERT IGNORE INTO b VALUES (2);",
        );
    }

    #[test]
    fn insert_transform_does_not_change_lowercase_inserts() {
        let sql = "insert into a values (1);";

        assert_eq!(make_insert_sql_ignore_duplicates(sql.to_string()), sql);
    }

    #[test]
    fn split_sql_script_statements_handles_single_multiline_and_final_statements() {
        let sql = "\
USE `tanah`;
SET FOREIGN_KEY_CHECKS = 0;
INSERT INTO note (id, body) VALUES
  (1, 'first'),
  (2, 'second')
);
INSERT INTO parshan VALUES (1, 'Rashi');
SELECT 1";

        let statements = split_sql_script_statements(&filter_use_statements(sql));

        assert_eq!(
            statements,
            vec![
                "SET FOREIGN_KEY_CHECKS = 0;",
                "INSERT INTO note (id, body) VALUES\n  (1, 'first'),\n  (2, 'second')\n);",
                "INSERT INTO parshan VALUES (1, 'Rashi');",
                "SELECT 1",
            ]
        );
    }

    #[test]
    fn mysql_identifier_quoting_escapes_backticks() {
        assert_eq!(quote_mysql_identifier_part("plain"), "plain");
        assert_eq!(quote_mysql_identifier_part("tan`ah"), "tan``ah");
    }

    #[test]
    fn cli_defaults_point_to_expected_tanahpedia_scripts() {
        let cli = cli_from(&[]);
        let scripts = TanahpediaScripts::from_cli(Path::new("/repo/data/mysql/db-populator"), &cli);

        assert_eq!(
            scripts.structure,
            PathBuf::from("/repo/data/mysql/db-populator/../tanahpedia_structure.sql"),
        );
        assert_eq!(
            scripts.source_citation_upgrade,
            PathBuf::from("/repo/data/mysql/db-populator/../tanahpedia_alter_source_citation.sql",),
        );
        assert_eq!(
            scripts.person_source_citation_upgrade,
            PathBuf::from(
                "/repo/data/mysql/db-populator/../tanahpedia_alter_person_source_citation.sql",
            ),
        );
        assert_eq!(
            scripts.incremental_lookups,
            PathBuf::from("/repo/data/mysql/db-populator/../tanahpedia_incremental_lookups.sql"),
        );
        assert_eq!(
            scripts.family_jacob,
            PathBuf::from("/repo/data/mysql/db-populator/../tanahpedia_family_jacob_data.sql"),
        );
        assert_eq!(
            scripts.place_eretz_yisrael,
            PathBuf::from(
                "/repo/data/mysql/db-populator/../tanahpedia_place_eretz_yisrael_data.sql",
            ),
        );
    }

    #[test]
    fn cli_accepts_tanahpedia_safe_mode_flags() {
        let cli = cli_from(&[
            "--tanahpedia-baseline-only",
            "--ensure-tanahpedia-seed",
            "--skip-tanah-test-data",
        ]);

        assert!(cli.tanahpedia_baseline_only);
        assert!(cli.ensure_tanahpedia_seed);
        assert!(cli.skip_tanah_test_data);
        assert!(!cli.tanahpedia_structure_only);
        assert!(!cli.tanahpedia_families_only);
        assert!(!cli.tanahpedia_edge_lab_only);
    }

    #[test]
    fn cli_accepts_targeted_tanahpedia_content_flags() {
        let family_cli = cli_from(&["--tanahpedia-families-only"]);
        let edge_lab_cli = cli_from(&["--tanahpedia-edge-lab-only"]);

        assert!(family_cli.tanahpedia_families_only);
        assert!(!family_cli.tanahpedia_edge_lab_only);
        assert!(edge_lab_cli.tanahpedia_edge_lab_only);
        assert!(!edge_lab_cli.tanahpedia_families_only);
    }

    #[test]
    fn cli_allows_overriding_tanahpedia_script_paths() {
        let cli = cli_from(&[
            "--tanahpedia-structure-script",
            "custom/structure.sql",
            "--tanahpedia-seed-script",
            "custom/seed.sql",
            "--tanahpedia-family-jacob-script",
            "custom/jacob.sql",
        ]);
        let scripts = TanahpediaScripts::from_cli(Path::new("/base"), &cli);

        assert_eq!(
            scripts.structure,
            PathBuf::from("/base/custom/structure.sql")
        );
        assert_eq!(scripts.seed, PathBuf::from("/base/custom/seed.sql"));
        assert_eq!(
            scripts.family_jacob,
            PathBuf::from("/base/custom/jacob.sql")
        );
    }

    #[tokio::test]
    async fn safe_tanahpedia_paths_are_idempotent_against_mysql() -> Result<()> {
        let Ok(server_url) = env::var("DB_POPULATOR_TEST_DB_URL") else {
            eprintln!("Skipping MySQL-backed db-populator test; DB_POPULATOR_TEST_DB_URL is unset");
            return Ok(());
        };

        let base_options = MySqlConnectOptions::from_str(&server_url)
            .context("Failed to parse DB_POPULATOR_TEST_DB_URL")?
            .disable_statement_logging();
        let database_name = format!(
            "tanah_db_populator_test_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .context("System time is before UNIX_EPOCH")?
                .as_millis()
        );
        let database_ident = quote_mysql_identifier_part(&database_name);

        let mut server_conn = MySqlConnection::connect_with(&base_options.clone().database(""))
            .await
            .context("Failed to connect to MySQL test server")?;
        raw_sql(AssertSqlSafe(format!(
            "CREATE DATABASE `{}` CHARACTER SET utf8mb3",
            database_ident
        )))
        .execute(&mut server_conn)
        .await
        .with_context(|| format!("Failed to create test database '{}'", database_name))?;
        server_conn.close().await.ok();

        let test_result = async {
            let mut conn =
                MySqlConnection::connect_with(&base_options.clone().database(&database_name))
                    .await
                    .with_context(|| {
                        format!("Failed to connect to test database '{}'", database_name)
                    })?;
            let base_path = Path::new(env!("CARGO_MANIFEST_DIR"));
            let cli = cli_from(&[]);
            let scripts = TanahpediaScripts::from_cli(base_path, &cli);

            execute_script(
                &mut conn,
                &base_path.join(&cli.static_structure_script),
                "test-static-structure",
            )
            .await?;
            execute_script(
                &mut conn,
                &base_path.join(&cli.dynamic_structure_script),
                "test-dynamic-structure",
            )
            .await?;
            execute_script(
                &mut conn,
                &base_path.join(&cli.perushim_structure_script),
                "test-perushim-structure",
            )
            .await?;

            apply_tanahpedia_rebuild_structure(&mut conn, &scripts).await?;
            apply_tanahpedia_safe_baseline(&mut conn, &scripts, true).await?;
            apply_tanahpedia_safe_baseline(&mut conn, &scripts, true).await?;

            assert!(column_exists(&mut conn, "tanahpedia_person_union", "source_citation").await?);
            assert!(
                column_exists(
                    &mut conn,
                    "tanahpedia_person_parent_child",
                    "source_citation"
                )
                .await?
            );
            assert_eq!(table_count(&mut conn, "tanahpedia_god").await?, 1);
            assert_eq!(
                table_count(&mut conn, "tanahpedia_lookup_union_type").await?,
                5
            );

            raw_sql("CREATE TABLE column_add_test (id INT NOT NULL)")
                .execute(&mut conn)
                .await
                .context("Failed to create column-add test table")?;
            apply_column_add_if_missing(
                &mut conn,
                &scripts.source_citation_upgrade,
                "column_add_test",
                "added_col",
                "VARCHAR(10) NULL",
            )
            .await?;
            assert!(column_exists(&mut conn, "column_add_test", "added_col").await?);

            raw_sql(
                "INSERT INTO tanahpedia_entity (id, entity_type, name) \
                 VALUES ('e9000000-0000-4000-8000-000000000001', 'PERSON', 'שמשון')",
            )
            .execute(&mut conn)
            .await
            .context("Failed to insert Shimshon test entity")?;
            raw_sql(
                "INSERT INTO tanahpedia_person (id, entity_id) \
                 VALUES ('p9000000-0000-4000-8000-000000000001', \
                         'e9000000-0000-4000-8000-000000000001')",
            )
            .execute(&mut conn)
            .await
            .context("Failed to insert Shimshon test person")?;
            apply_tanahpedia_family_and_place_content(&mut conn, &scripts, true).await?;
            assert!(tanahpedia_person_exists(&mut conn, "שמשון").await?);

            raw_sql(
                "INSERT INTO tanahpedia_entry (id, unique_name, title) \
                 VALUES ('entry-test-marker-000000000000000001', 'test-marker', 'test-marker')",
            )
            .execute(&mut conn)
            .await
            .context("Failed to insert test marker Tanahpedia entry")?;

            apply_tanahpedia_full_seed(&mut conn, &scripts).await?;
            apply_tanahpedia_full_seed(&mut conn, &scripts).await?;

            assert!(tanahpedia_entry_exists(&mut conn, "יעקב").await?);
            assert!(tanahpedia_entry_exists(&mut conn, "eretz-yisrael").await?);

            conn.close().await.ok();
            Ok::<(), anyhow::Error>(())
        }
        .await;

        let mut cleanup_conn = MySqlConnection::connect_with(&base_options.database(""))
            .await
            .context("Failed to reconnect to MySQL test server for cleanup")?;
        raw_sql(AssertSqlSafe(format!(
            "DROP DATABASE IF EXISTS `{}`",
            database_ident
        )))
        .execute(&mut cleanup_conn)
        .await
        .with_context(|| format!("Failed to drop test database '{}'", database_name))?;
        cleanup_conn.close().await.ok();

        test_result
    }
}
