//! MySQL Database Populator
//!
//! Populates a MySQL database with Tanah structure and test data.
//! This is a Rust port of the legacy TypeScript populate-test-db.mts script.

use anyhow::{Context, Result};
use clap::Parser;
use sqlx_core::connection::{ConnectOptions, Connection};
use sqlx_core::raw_sql::raw_sql;
use sqlx_mysql::{MySqlConnectOptions, MySqlConnection};
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

    /// Path to tanahpedia structure SQL file; skipped if missing
    #[arg(long, default_value = "../tanahpedia_structure.sql")]
    tanahpedia_structure_script: String,

    /// Path to tanahpedia seed data SQL file; skipped if missing
    #[arg(long, default_value = "../tanahpedia_seed_data.sql")]
    tanahpedia_seed_data_script: String,

    /// Path to tanahpedia legacy migration SQL file; skipped if missing
    #[arg(long, default_value = "../tanahpedia_legacy_migration.sql")]
    tanahpedia_legacy_migration_script: String,

    /// Optional demo family SQL (שמשון parents & wives); runs after legacy migration
    #[arg(long, default_value = "../tanahpedia_family_shimshon_data.sql")]
    tanahpedia_family_shimshon_script: String,

    /// Optional demo family SQL (יעקב entry + full household); runs after שמשון script when present
    #[arg(long, default_value = "../tanahpedia_family_jacob_data.sql")]
    tanahpedia_family_jacob_script: String,

    /// INSERT IGNORE lookup patches (e.g. new union types); runs before family demo scripts
    #[arg(long, default_value = "../tanahpedia_incremental_lookups.sql")]
    tanahpedia_incremental_lookups_script: String,

    /// Production database URL (for checking if tanahpedia data exists in prod)
    /// Can also be set via PROD_DB_URL environment variable
    #[arg(long, env = "PROD_DB_URL")]
    prod_db_url: Option<String>,

    /// Skip structure script execution
    #[arg(long, default_value = "false")]
    skip_structure: bool,

    /// Skip data script execution
    #[arg(long, default_value = "false")]
    skip_data: bool,

    /// Skip tanah_test_data.sql (bundled demo authors/articles). Static sefarim/perakim,
    /// perushim, and tanahpedia seeds still run when applicable.
    #[arg(long, default_value_t = false)]
    skip_tanah_test_data: bool,

    /// Only run תנכפדיה family demo SQL (שמשון if person exists, then יעקב).
    /// Use with existing DB and `--skip-structure` to refresh demo rows without full populate.
    #[arg(long, default_value_t = false)]
    tanahpedia_families_only: bool,

    /// With `--tanahpedia-families-only`, run `tanahpedia_seed_data.sql` first (lookup tables).
    /// Fails if seed rows already exist — use only on a DB missing Tanahpedia seed.
    #[arg(long, default_value_t = false)]
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
        raw_sql(&drop_db_sql)
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
    raw_sql(&create_db_sql)
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

        let tanahpedia_structure_path = base_path.join(&cli.tanahpedia_structure_script);
        if tanahpedia_structure_path.exists() {
            execute_script(
                &mut conn,
                &tanahpedia_structure_path,
                "tanahpedia-structure",
            )
            .await?;
        }
    }

    if cli.tanahpedia_families_only {
        apply_tanahpedia_family_demonstrations(
            &mut conn,
            base_path,
            &cli,
            cli.ensure_tanahpedia_seed,
        )
        .await?;
        conn.close().await.context("Failed to close connection")?;
        println!("Tanahpedia family demo scripts finished");
        return Ok(());
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

        let tanahpedia_seed_data_path = base_path.join(&cli.tanahpedia_seed_data_script);
        if tanahpedia_seed_data_path.exists() {
            execute_script(
                &mut conn,
                &tanahpedia_seed_data_path,
                "tanahpedia-seed-data",
            )
            .await?;
        }

        // Check if production has tanahpedia data; if not, run legacy migration
        let should_run_legacy_migration =
            check_if_should_run_legacy_migration(&cli.prod_db_url).await;
        if should_run_legacy_migration {
            let tanahpedia_legacy_migration_path =
                base_path.join(&cli.tanahpedia_legacy_migration_script);
            if tanahpedia_legacy_migration_path.exists() {
                println!("Production database has no tanahpedia data; running legacy migration...");
                execute_script(
                    &mut conn,
                    &tanahpedia_legacy_migration_path,
                    "tanahpedia-legacy-migration",
                )
                .await?;
            } else {
                println!(
                    "Warning: tanahpedia_legacy_migration.sql not found, but production has no data"
                );
            }
        } else {
            println!(
                "Production database has tanahpedia data; skipping legacy migration (data will come from sync-from-prod)"
            );
        }

        apply_tanahpedia_family_demonstrations(&mut conn, base_path, &cli, false).await?;
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
    raw_sql(&script)
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
                raw_sql(buf.trim())
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
                raw_sql(buf.trim())
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
        raw_sql(buf.trim())
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

/// שמשון (אם קיים) ואז יעקב — סקריפטים קבועים; לא נוגעים בישויות אחרות.
async fn apply_tanahpedia_family_demonstrations(
    conn: &mut MySqlConnection,
    base_path: &Path,
    cli: &Cli,
    include_tanahpedia_seed: bool,
) -> Result<()> {
    let incremental_path = base_path.join(&cli.tanahpedia_incremental_lookups_script);
    if incremental_path.exists() {
        println!("Applying tanahpedia incremental lookups (idempotent)...");
        execute_script(
            conn,
            &incremental_path,
            "tanahpedia-incremental-lookups",
        )
        .await?;
    }

    if include_tanahpedia_seed {
        let tanahpedia_seed_data_path = base_path.join(&cli.tanahpedia_seed_data_script);
        if tanahpedia_seed_data_path.exists() {
            println!("Applying tanahpedia seed data (ensure)...");
            execute_script(
                conn,
                &tanahpedia_seed_data_path,
                "tanahpedia-seed-data",
            )
            .await?;
        }
    }

    let tanahpedia_family_path = base_path.join(&cli.tanahpedia_family_shimshon_script);
    if tanahpedia_family_path.exists() {
        match tanahpedia_shimshon_person_exists(conn).await {
            Ok(true) => {
                println!("Applying tanahpedia family demo (שמשון)...");
                execute_script(
                    conn,
                    &tanahpedia_family_path,
                    "tanahpedia-family-shimshon",
                )
                .await?;
            }
            Ok(false) => println!(
                "Skipping tanahpedia family demo: no tanahpedia_person row for entity name «שמשון»"
            ),
            Err(e) => println!(
                "Skipping tanahpedia family demo (could not check for שמשון): {}",
                e
            ),
        }
    }

    let tanahpedia_family_jacob_path = base_path.join(&cli.tanahpedia_family_jacob_script);
    if tanahpedia_family_jacob_path.exists() {
        println!("Applying tanahpedia family demo (יעקב)...");
        execute_script(
            conn,
            &tanahpedia_family_jacob_path,
            "tanahpedia-family-jacob",
        )
        .await?;
    }

    Ok(())
}

/// True when the target DB has a Tanahpedia person linked to entity name שמשון (legacy or prod sync).
async fn tanahpedia_shimshon_person_exists(conn: &mut MySqlConnection) -> Result<bool> {
	let n: i64 = sqlx::query_scalar(
		"SELECT COUNT(*) FROM tanahpedia_person p \
		 INNER JOIN tanahpedia_entity e ON e.id = p.entity_id \
		 WHERE e.name = 'שמשון'",
	)
	.fetch_one(&mut *conn)
	.await
	.context("Failed to check for שמשון in tanahpedia_person")?;
	Ok(n > 0)
}

/// Checks if legacy migration should be run.
/// Returns true if production database has no tanahpedia data (never deployed).
/// Returns false if production has data or if prod DB URL is not available.
async fn check_if_should_run_legacy_migration(prod_db_url: &Option<String>) -> bool {
    let Some(prod_db_url) = prod_db_url else {
        // No prod DB URL provided - assume we should run legacy migration
        println!("No PROD_DB_URL provided; will run legacy migration");
        return true;
    };

    let prod_options = match MySqlConnectOptions::from_str(prod_db_url) {
        Ok(opts) => opts.disable_statement_logging(),
        Err(e) => {
            println!(
                "Warning: Failed to parse PROD_DB_URL: {}. Will run legacy migration.",
                e
            );
            return true;
        }
    };

    // Try to connect and check if tanahpedia_entry table exists and has data
    match MySqlConnection::connect_with(&prod_options).await {
        Ok(mut conn) => {
            // Try to query the table - if it fails, table doesn't exist
            // If it succeeds, we assume production has data (from sync-from-prod)
            let check_query = "SELECT 1 FROM tanahpedia_entry LIMIT 1";
            match raw_sql(check_query).execute(&mut conn).await {
                Ok(_) => {
                    // Table exists - assume it has data (will be populated by sync-from-prod)
                    println!(
                        "tanahpedia_entry table exists in production; skipping legacy migration (data will come from sync-from-prod)"
                    );
                    conn.close().await.ok();
                    false
                }
                Err(e) => {
                    // Table doesn't exist or query failed - run legacy migration
                    println!(
                        "tanahpedia_entry table does not exist or is inaccessible in production: {}. Will run legacy migration.",
                        e
                    );
                    conn.close().await.ok();
                    true
                }
            }
        }
        Err(e) => {
            println!(
                "Warning: Failed to connect to production database: {}. Will run legacy migration.",
                e
            );
            true
        }
    }
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
