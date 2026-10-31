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

    /// Path to Tanahpedia child birth order upgrade SQL file
    #[arg(long, default_value = "../tanahpedia_alter_child_birth_order.sql")]
    tanahpedia_child_birth_order_upgrade_script: String,

    /// Path to Tanahpedia entry-revision history upgrade SQL file
    #[arg(long, default_value = "../tanahpedia_alter_entry_revision_history.sql")]
    tanahpedia_entry_revision_history_upgrade_script: String,

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

    #[arg(long, default_value = "../tanahpedia_entry_synonym_data.sql")]
    tanahpedia_entry_synonym_script: String,

    /// Path to Tanahpedia edge-case lab SQL file
    #[arg(long, default_value = "../tanahpedia_family_edge_lab_data.sql")]
    tanahpedia_edge_lab_script: String,

    /// Path to mention-decoration e2e fixture SQL file. Must run after the
    /// Tanahpedia seed chain — it inserts tanahpedia_entry rows, which would
    /// satisfy the legacy-migration "empty table" gate if loaded earlier.
    #[arg(long, default_value = "../tanah_mention_test_data.sql")]
    tanah_mention_test_data_script: String,

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

        apply_daily_bulletin_upgrades(&mut conn, base_path).await?;

        apply_article_covering_source_upgrade(&mut conn, base_path).await?;

        apply_perek_pasuk_count_upgrade(&mut conn, base_path).await?;

        let perek_images_path = base_path.join("../tanah_perek_images_structure.sql");
        execute_script(&mut conn, &perek_images_path, "perek-images-structure").await?;

        let perushim_structure_path = base_path.join(&cli.perushim_structure_script);
        if perushim_structure_path.exists() {
            execute_script(&mut conn, &perushim_structure_path, "perushim-structure").await?;
        }

        apply_tanahpedia_rebuild_structure(&mut conn, &tanahpedia_scripts).await?;

        // Reading-metrics tables last: their FKs reference tanah_article and
        // tanahpedia_entry, which exist only after the structures above ran.
        apply_reading_metrics_upgrade(&mut conn, base_path).await?;

        // Dedication expansion (#2731): upgrades the preserved dedication
        // tables and adds the scope link tables; runs after the Tanahpedia
        // structure so the entry link FK resolves.
        apply_dedication_upgrade(&mut conn, base_path).await?;
    }

    if !cli.skip_data {
        let tanah_view_data_path = base_path.join(&cli.tanah_view_data_script);
        execute_script(&mut conn, &tanah_view_data_path, "tanah-view-data").await?;

        // tanah_perek rows now exist, so the canonical counts and any
        // covering-source fixtures whose perek FK they back may load.
        // The upgrade is re-applied here so `mysql-populate-data-only`
        // upgrades databases whose structure predates the column.
        apply_perek_pasuk_count_data(&mut conn, base_path).await?;

        if !cli.skip_tanah_test_data {
            let data_path = base_path.join(&cli.data_script);
            execute_script(&mut conn, &data_path, "data").await?;
        }

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

        apply_mention_test_data(&mut conn, base_path, &cli).await?;

        // Re-applied here so `mysql-populate-data-only` still creates the
        // reading-metrics tables on databases populated before this schema.
        apply_reading_metrics_upgrade(&mut conn, base_path).await?;

        // Same for the dedication scope/expiry upgrade (#2731).
        apply_dedication_upgrade(&mut conn, base_path).await?;
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
    child_birth_order_upgrade: std::path::PathBuf,
    entry_revision_history_upgrade: std::path::PathBuf,
    seed: std::path::PathBuf,
    incremental_lookups: std::path::PathBuf,
    legacy: std::path::PathBuf,
    family_shimshon: std::path::PathBuf,
    family_jacob: std::path::PathBuf,
    place_eretz_yisrael: std::path::PathBuf,
    entry_synonym: std::path::PathBuf,
    edge_lab: std::path::PathBuf,
}

impl TanahpediaScripts {
    fn from_cli(base_path: &Path, cli: &Cli) -> Self {
        Self {
            structure: base_path.join(&cli.tanahpedia_structure_script),
            source_citation_upgrade: base_path.join(&cli.tanahpedia_source_citation_upgrade_script),
            person_source_citation_upgrade: base_path
                .join(&cli.tanahpedia_person_source_citation_upgrade_script),
            child_birth_order_upgrade: base_path
                .join(&cli.tanahpedia_child_birth_order_upgrade_script),
            entry_revision_history_upgrade: base_path
                .join(&cli.tanahpedia_entry_revision_history_upgrade_script),
            seed: base_path.join(&cli.tanahpedia_seed_script),
            incremental_lookups: base_path.join(&cli.tanahpedia_incremental_lookups_script),
            legacy: base_path.join(&cli.tanahpedia_legacy_script),
            family_shimshon: base_path.join(&cli.tanahpedia_family_shimshon_script),
            family_jacob: base_path.join(&cli.tanahpedia_family_jacob_script),
            place_eretz_yisrael: base_path.join(&cli.tanahpedia_place_eretz_yisrael_script),
            entry_synonym: base_path.join(&cli.tanahpedia_entry_synonym_script),
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
    apply_person_source_citation_upgrade(conn, &scripts.person_source_citation_upgrade).await?;
    apply_child_birth_order_upgrade(conn, &scripts.child_birth_order_upgrade).await?;
    apply_entry_revision_history_upgrade(conn, &scripts.entry_revision_history_upgrade).await
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

/// Loads the mention-decoration e2e fixture. Must run after the Tanahpedia
/// seed chain — the fixture inserts `tanahpedia_entry` rows, which would
/// satisfy the legacy migration's empty-table gate if loaded earlier.
async fn apply_mention_test_data(
    conn: &mut MySqlConnection,
    base_path: &Path,
    cli: &Cli,
) -> Result<()> {
    if cli.skip_tanah_test_data {
        return Ok(());
    }
    let mention_test_data_path = base_path.join(&cli.tanah_mention_test_data_script);
    execute_optional_script(conn, &mention_test_data_path, "mention-test-data").await
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

    /* Idempotent, so it always runs and picks up freshly created entries. */
    execute_optional_script(conn, &scripts.entry_synonym, "tanahpedia-entry-synonym").await?;

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

async fn apply_article_covering_source_upgrade(
    conn: &mut MySqlConnection,
    base_path: &Path,
) -> Result<()> {
    execute_script(
        conn,
        &base_path.join("../tanah_article_covering_source_upgrade.sql"),
        "article-covering-source-upgrade",
    )
    .await
}

async fn apply_perek_pasuk_count_upgrade(
    conn: &mut MySqlConnection,
    base_path: &Path,
) -> Result<()> {
    execute_script(
        conn,
        &base_path.join("../tanah_perek_pasuk_count_upgrade.sql"),
        "perek-pasuk-count-upgrade",
    )
    .await
}

/// Bulletin channel tables depend on the immutable bulletin snapshot table.
/// Keep both additive upgrades together for fresh and repeated bootstrap runs.
async fn apply_daily_bulletin_upgrades(conn: &mut MySqlConnection, base_path: &Path) -> Result<()> {
    for (filename, label) in [
        ("tanah_daily_bulletin_upgrade.sql", "daily-bulletin-upgrade"),
        (
            "tanah_daily_bulletin_telegram_upgrade.sql",
            "daily-bulletin-telegram-upgrade",
        ),
        (
            "tanah_daily_bulletin_whatsapp_upgrade.sql",
            "daily-bulletin-whatsapp-upgrade",
        ),
    ] {
        execute_script(conn, &base_path.join("..").join(filename), label).await?;
    }
    Ok(())
}

/// Applies the dedication expansion upgrade (#2731): expiry columns on the
/// preserved dedication tables plus the expanded-scope link tables (sefer,
/// helek, weekly parasha, Tanahpedia entry, whole-masora feature).
/// Idempotent and non-destructive, so it runs in both phases.
async fn apply_dedication_upgrade(conn: &mut MySqlConnection, base_path: &Path) -> Result<()> {
    execute_script(
        conn,
        &base_path.join("../tanah_dedication_upgrade.sql"),
        "dedication-upgrade",
    )
    .await
}

/// Creates the shared reading-metrics tables (#2607). Runs last: the metric
/// tables hold FKs to tanah_article and tanahpedia_entry.
async fn apply_reading_metrics_upgrade(conn: &mut MySqlConnection, base_path: &Path) -> Result<()> {
    execute_script(
        conn,
        &base_path.join("../tanah_reading_metrics_upgrade.sql"),
        "reading-metrics-upgrade",
    )
    .await
}

/// Re-applies the idempotent pasuk_count upgrade and loads the generated
/// canonical counts; requires tanah_perek rows to already exist.
async fn apply_perek_pasuk_count_data(conn: &mut MySqlConnection, base_path: &Path) -> Result<()> {
    apply_perek_pasuk_count_upgrade(conn, base_path).await?;
    execute_script(
        conn,
        &base_path.join("../tanah_perek_pasuk_count_data.sql"),
        "perek-pasuk-count-data",
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

async fn apply_child_birth_order_upgrade(
    conn: &mut MySqlConnection,
    script_path: &Path,
) -> Result<()> {
    apply_column_add_if_missing(
        conn,
        script_path,
        "tanahpedia_person_parent_child",
        "birth_order",
        "INT NULL",
    )
    .await
}

async fn apply_entry_revision_history_upgrade(
    conn: &mut MySqlConnection,
    script_path: &Path,
) -> Result<()> {
    apply_column_add_if_missing(
        conn,
        script_path,
        "tanahpedia_entry_revision",
        "base_revision_id",
        "CHAR(36) NULL COMMENT 'APPLIED head this change was based on'",
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
            scripts.child_birth_order_upgrade,
            PathBuf::from(
                "/repo/data/mysql/db-populator/../tanahpedia_alter_child_birth_order.sql"
            ),
        );
        assert_eq!(
            scripts.entry_revision_history_upgrade,
            PathBuf::from(
                "/repo/data/mysql/db-populator/../tanahpedia_alter_entry_revision_history.sql"
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
                &base_path.join("../tanah_perek_images_structure.sql"),
                "test-perek-images-structure",
            )
            .await?;

            // Simulate the pre-bulletin dynamic schema and upgrade it repeatedly.
            raw_sql("ALTER TABLE tanah_article DROP COLUMN distributable")
                .execute(&mut conn).await?;
            apply_daily_bulletin_upgrades(&mut conn, base_path).await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_settings WHERE id = 1 AND audience = 'test' AND revision = 0 AND next_send_at IS NULL").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 AND audience = 'test' AND revision = 0 AND group_lookup_token IS NULL AND next_group_lookup_at IS NULL AND message_checks_used = 0").fetch_one(&mut conn).await?, 1);
            raw_sql("INSERT INTO tanah_article (id, perek_id, author_id, name, priority, content, distributable) VALUES (42, 1, 1, 'Retained article', 1, 'Retained content', TRUE);
                INSERT INTO tanah_daily_bulletin (bulletin_date, perek_id, input_json, subject, source, email_html, pdf_data, filename)
                    VALUES ('2026-10-08', 1, '{}', 'Retained subject', 'Retained source', 'Retained HTML', 'Retained PDF', 'retained.pdf');
                INSERT INTO tanah_daily_bulletin_delivery (bulletin_date, channel, status, provider_message_id)
                    VALUES ('2026-10-08', 'email', 'sent', 'campaign-42');
                UPDATE tanah_daily_bulletin_email_settings SET audience = 'real', revision = 7, next_send_at = '2026-10-08 12:00:01.123' WHERE id = 1;
                INSERT INTO tanah_daily_bulletin_subscriber (id, email, audience, consent_status, consent_source, consented_at, last_event_at) VALUES
                    (101, 'test@example.com', 'test', 'confirmed', 'Explicit test consent', '2026-10-08 11:00:00.123', '2026-10-08 11:00:00.123'),
                    (102, 'test@example.com', 'real', 'confirmed', 'Explicit real consent', '2026-10-08 11:01:00.123', '2026-10-08 11:01:00.123'),
                    (104, 'unsubscribed@example.com', 'real', 'unsubscribed', 'Legacy consent', '2026-10-08 11:00:00.123', '2026-10-08 12:00:00.123'),
                    (105, 'bounced@example.com', 'real', 'bounced', 'Legacy consent', '2026-10-08 11:00:00.123', '2026-10-08 12:00:00.123'),
                    (106, 'complained@example.com', 'real', 'complained', 'Legacy consent', '2026-10-08 11:00:00.123', '2026-10-08 12:00:00.123');
                INSERT INTO tanah_daily_bulletin_subscriber (id, email, audience) VALUES (103, 'pending@example.com', 'real');
                INSERT INTO tanah_daily_bulletin_email_job (id, bulletin_date, audience, idempotency_key, settings_revision, status, last_error) VALUES
                    ('11111111-1111-4111-8111-111111111111', '2026-10-08', 'test', 'retained-test-request', 6, 'uncertain', 'Check provider before retrying'),
                    ('22222222-2222-4222-8222-222222222222', '2026-10-08', 'real', 'production', 7, 'failed', 'Recipient complained');
                INSERT INTO tanah_daily_bulletin_email_recipient (id, job_id, subscriber_id, email, status, attempt_token, message_id, started_at, event_at, last_error) VALUES
                    (201, '11111111-1111-4111-8111-111111111111', 101, 'test@example.com', 'uncertain', '33333333-3333-4333-8333-333333333333', 'ses-retained-test-message', '2026-10-08 12:00:00.123', '2026-10-08 12:02:03.456', 'Do not resend automatically'),
                    (202, '22222222-2222-4222-8222-222222222222', 106, 'complained@example.com', 'complained', '44444444-4444-4444-8444-444444444444', 'ses-retained-complaint', '2026-10-08 12:00:00.123', '2026-10-08 12:03:04.567', 'Recipient complained');")
                .execute(&mut conn).await?;
            raw_sql("UPDATE tanah_daily_bulletin_whatsapp_settings SET audience = 'real', revision = 8,
                    group_lookup_token = '55555555-5555-4555-8555-555555555555', group_lookup_until = '2026-10-08 12:00:20.123',
                    next_group_lookup_at = '2026-10-08 12:00:01.123', message_check_month = '2026-10', message_checks_used = 1000,
                    next_message_check_at = '2026-10-08 12:00:02.123' WHERE id = 1;
                INSERT INTO tanah_daily_bulletin_whatsapp_verification
                    (audience, config_sha256, verified, connection_state, group_id, title, member_count, sender_id, sender_phone, participant_digest, checked_at, expires_at)
                    VALUES ('test', REPEAT('a', 64), TRUE, 'authorized', '111111111111111111@g.us', 'Retained test target', 2,
                        '222222222222222@lid', '15550000001', CONCAT('sha256:', REPEAT('b', 64)), '2026-10-08 12:00:00.123', '2026-10-08 12:10:00.123');
                INSERT INTO tanah_daily_bulletin_whatsapp_job
                    (id, bulletin_date, audience, idempotency_key, settings_revision, instance_id, target_group_id, sender_id, sender_phone,
                     participant_digest, config_sha256, pdf_sha256, filename, caption, status, attempt_token, started_at, upload_started_at,
                     provider_message_id, provider_status, reconcile_attempts, reconcile_token, reconcile_until, next_reconcile_at, last_error)
                    VALUES ('66666666-6666-4666-8666-666666666666', '2026-10-08', 'test', 'retained-whatsapp-request', 7,
                        '111111111111', '111111111111111111@g.us', '222222222222222@lid', '15550000001', CONCAT('sha256:', REPEAT('b',64)),
                        REPEAT('a',64), REPEAT('c',64), 'retained.pdf', 'Retained caption', 'accepted', '77777777-7777-4777-8777-777777777777',
                        '2026-10-08 12:00:00.123', '2026-10-08 12:00:01.123', 'retained-whatsapp-message', 'pending', 2,
                        '88888888-8888-4888-8888-888888888888', '2026-10-08 12:05:30.123', '2026-10-08 12:05:00.123', 'Retain acknowledgement');
                INSERT INTO tanah_daily_bulletin_delivery (bulletin_date, channel, status, attempt_count, provider_message_id, sent_at)
                    VALUES ('2026-10-08', 'whatsapp', 'sent', 1, 'legacy-whatsapp-message', '2026-10-08 11:00:00');")
                .execute(&mut conn).await?;
            apply_daily_bulletin_upgrades(&mut conn, base_path).await?;
            apply_daily_bulletin_upgrades(&mut conn, base_path).await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_article WHERE id = 42 AND distributable = TRUE AND content = 'Retained content'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, String>("SELECT email_html FROM tanah_daily_bulletin WHERE bulletin_date = '2026-10-08'").fetch_one(&mut conn).await?, "Retained HTML");
            assert_eq!(query_scalar::<MySql, String>("SELECT provider_message_id FROM tanah_daily_bulletin_delivery WHERE bulletin_date = '2026-10-08' AND channel = 'email' AND status = 'sent'").fetch_one(&mut conn).await?, "campaign-42");
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 AND audience = 'real' AND revision = 8 AND group_lookup_token = '55555555-5555-4555-8555-555555555555' AND group_lookup_until = '2026-10-08 12:00:20.123' AND next_group_lookup_at = '2026-10-08 12:00:01.123' AND message_check_month = '2026-10' AND message_checks_used = 1000 AND next_message_check_at = '2026-10-08 12:00:02.123'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_whatsapp_settings").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_whatsapp_verification WHERE audience = 'test' AND config_sha256 = REPEAT('a',64) AND verified = TRUE AND connection_state = 'authorized' AND group_id = '111111111111111111@g.us' AND title = 'Retained test target' AND member_count = 2 AND sender_id = '222222222222222@lid' AND sender_phone = '15550000001' AND participant_digest = CONCAT('sha256:',REPEAT('b',64)) AND checked_at = '2026-10-08 12:00:00.123' AND expires_at = '2026-10-08 12:10:00.123'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_whatsapp_job WHERE id = '66666666-6666-4666-8666-666666666666' AND bulletin_date = '2026-10-08' AND audience = 'test' AND idempotency_key = 'retained-whatsapp-request' AND settings_revision = 7 AND instance_id = '111111111111' AND target_group_id = '111111111111111111@g.us' AND sender_id = '222222222222222@lid' AND sender_phone = '15550000001' AND participant_digest = CONCAT('sha256:',REPEAT('b',64)) AND config_sha256 = REPEAT('a',64) AND pdf_sha256 = REPEAT('c',64) AND filename = 'retained.pdf' AND caption = 'Retained caption' AND status = 'accepted' AND attempt_token = '77777777-7777-4777-8777-777777777777' AND started_at = '2026-10-08 12:00:00.123' AND upload_started_at = '2026-10-08 12:00:01.123' AND provider_message_id = 'retained-whatsapp-message' AND provider_status = 'pending' AND reconcile_attempts = 2 AND reconcile_token = '88888888-8888-4888-8888-888888888888' AND reconcile_until = '2026-10-08 12:05:30.123' AND next_reconcile_at = '2026-10-08 12:05:00.123' AND last_error = 'Retain acknowledgement'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_delivery WHERE bulletin_date = '2026-10-08' AND channel = 'whatsapp' AND status = 'sent' AND attempt_count = 1 AND provider_message_id = 'legacy-whatsapp-message' AND sent_at = '2026-10-08 11:00:00'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, Vec<u8>>("SELECT pdf_data FROM tanah_daily_bulletin WHERE bulletin_date = '2026-10-08'").fetch_one(&mut conn).await?, b"Retained PDF");
            // Re-running the upgrade must retain the selected audience, explicit consent,
            // global suppression history, and IDs that prevent an uncertain send retry.
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_settings WHERE id = 1 AND audience = 'real' AND revision = 7 AND next_send_at = '2026-10-08 12:00:01.123'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_settings").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, String>("SELECT GROUP_CONCAT(CONCAT(id, ':', audience, ':', consent_status) ORDER BY id SEPARATOR ',') FROM tanah_daily_bulletin_subscriber").fetch_one(&mut conn).await?, "101:test:confirmed,102:real:confirmed,103:real:pending,104:real:unsubscribed,105:real:bounced,106:real:complained");
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_subscriber WHERE id = 101 AND consent_source = 'Explicit test consent' AND consented_at = '2026-10-08 11:00:00.123' AND last_event_at = '2026-10-08 11:00:00.123'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_subscriber WHERE id = 103 AND consented_at IS NULL AND last_event_at IS NULL").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_job WHERE id = '11111111-1111-4111-8111-111111111111' AND bulletin_date = '2026-10-08' AND audience = 'test' AND idempotency_key = 'retained-test-request' AND settings_revision = 6 AND status = 'uncertain' AND last_error = 'Check provider before retrying'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_job WHERE id = '22222222-2222-4222-8222-222222222222' AND audience = 'real' AND idempotency_key = 'production' AND settings_revision = 7 AND status = 'failed'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_recipient WHERE id = 201 AND job_id = '11111111-1111-4111-8111-111111111111' AND subscriber_id = 101 AND email = 'test@example.com' AND status = 'uncertain' AND attempt_token = '33333333-3333-4333-8333-333333333333' AND message_id = 'ses-retained-test-message' AND started_at = '2026-10-08 12:00:00.123' AND event_at = '2026-10-08 12:02:03.456' AND last_error = 'Do not resend automatically'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_recipient WHERE id = 202 AND subscriber_id = 106 AND status = 'complained' AND message_id = 'ses-retained-complaint' AND event_at = '2026-10-08 12:03:04.567'").fetch_one(&mut conn).await?, 1);

            // A new Telegram migration must not reset either channel's history.
            let telegram_upgrade = base_path.join("../tanah_daily_bulletin_telegram_upgrade.sql");
            execute_script(&mut conn, &telegram_upgrade, "test-telegram-upgrade").await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_settings WHERE id = 1 AND audience = 'test' AND revision = 0 AND next_send_at IS NULL").fetch_one(&mut conn).await?, 1);
            raw_sql("UPDATE tanah_daily_bulletin_telegram_settings SET audience = 'real', revision = 9, next_send_at = '2026-10-08 12:00:02.345' WHERE id = 1;
                INSERT INTO tanah_daily_bulletin_telegram_job
                    (id, bulletin_date, audience, idempotency_key, settings_revision, bot_id, target_chat_id, pdf_sha256, filename, caption, status, attempt_token, started_at, provider_message_id, provider_file_id, last_error, sent_at) VALUES
                    ('55555555-5555-4555-8555-555555555555', '2026-10-08', 'test', 'retained-telegram-test', 8, 987654321, -1001234567890, REPEAT('a', 64), 'retained-test.pdf', 'Retained test caption', 'uncertain', '77777777-7777-4777-8777-777777777777', '2026-10-08 12:01:02.345', NULL, NULL, 'Do not repost automatically', NULL),
                    ('66666666-6666-4666-8666-666666666666', '2026-10-08', 'real', 'production', 9, 987654321, -1009876543210, REPEAT('b', 64), 'retained-real.pdf', 'Retained real caption', 'sent', '88888888-8888-4888-8888-888888888888', '2026-10-08 12:02:03.456', 123456, 'telegram-retained-file', NULL, '2026-10-08 12:02:04.567');")
                .execute(&mut conn).await?;
            execute_script(&mut conn, &telegram_upgrade, "test-telegram-upgrade-repeat").await?;
            apply_daily_bulletin_upgrades(&mut conn, base_path).await?;
            execute_script(&mut conn, &telegram_upgrade, "test-telegram-upgrade-third").await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_settings").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_settings WHERE id = 1 AND audience = 'real' AND revision = 9 AND next_send_at = '2026-10-08 12:00:02.345'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_job WHERE id = '55555555-5555-4555-8555-555555555555' AND bulletin_date = '2026-10-08' AND audience = 'test' AND idempotency_key = 'retained-telegram-test' AND settings_revision = 8 AND bot_id = 987654321 AND target_chat_id = -1001234567890 AND pdf_sha256 = REPEAT('a', 64) AND filename = 'retained-test.pdf' AND caption = 'Retained test caption' AND status = 'uncertain' AND attempt_token = '77777777-7777-4777-8777-777777777777' AND started_at = '2026-10-08 12:01:02.345' AND provider_message_id IS NULL AND provider_file_id IS NULL AND last_error = 'Do not repost automatically' AND sent_at IS NULL").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_job WHERE id = '66666666-6666-4666-8666-666666666666' AND audience = 'real' AND idempotency_key = 'production' AND settings_revision = 9 AND bot_id = 987654321 AND target_chat_id = -1009876543210 AND pdf_sha256 = REPEAT('b', 64) AND filename = 'retained-real.pdf' AND caption = 'Retained real caption' AND status = 'sent' AND attempt_token = '88888888-8888-4888-8888-888888888888' AND provider_message_id = 123456 AND provider_file_id = 'telegram-retained-file' AND sent_at = '2026-10-08 12:02:04.567'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_settings WHERE id = 1 AND audience = 'real' AND revision = 7 AND next_send_at = '2026-10-08 12:00:01.123'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_recipient WHERE id = 201 AND status = 'uncertain' AND message_id = 'ses-retained-test-message'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_email_recipient WHERE id = 202 AND status = 'complained' AND message_id = 'ses-retained-complaint'").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, String>("SELECT email_html FROM tanah_daily_bulletin WHERE bulletin_date = '2026-10-08'").fetch_one(&mut conn).await?, "Retained HTML");
            assert_eq!(query_scalar::<MySql, String>("SELECT provider_message_id FROM tanah_daily_bulletin_delivery WHERE bulletin_date = '2026-10-08' AND channel = 'email'").fetch_one(&mut conn).await?, "campaign-42");
            let duplicate_real = raw_sql("INSERT INTO tanah_daily_bulletin_telegram_job (id, bulletin_date, audience, idempotency_key, settings_revision, bot_id, target_chat_id, pdf_sha256, filename, caption) VALUES ('99999999-9999-4999-8999-999999999999', '2026-10-08', 'real', 'production', 9, 987654321, -1009876543210, REPEAT('b', 64), 'duplicate.pdf', 'Duplicate')").execute(&mut conn).await;
            assert!(duplicate_real.is_err(), "one real job per date must survive migration");
            let duplicate_message = raw_sql("INSERT INTO tanah_daily_bulletin_telegram_job (id, bulletin_date, audience, idempotency_key, settings_revision, bot_id, target_chat_id, pdf_sha256, filename, caption, provider_message_id) VALUES ('99999999-9999-4999-8999-999999999999', '2026-10-08', 'test', 'different-request', 9, 987654321, -1009876543210, REPEAT('b', 64), 'duplicate.pdf', 'Duplicate', 123456)").execute(&mut conn).await;
            assert!(duplicate_message.is_err(), "a provider message cannot bind to two jobs");
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_daily_bulletin_telegram_job").fetch_one(&mut conn).await?, 2);

            // Simulate the pre-covering-source schema and upgrade it repeatedly.
            raw_sql("DROP TABLE IF EXISTS tanah_article_covering_source;
                ALTER TABLE tanah_article DROP COLUMN coverage_verified;")
                .execute(&mut conn).await?;
            apply_article_covering_source_upgrade(&mut conn, base_path).await?;
            raw_sql("INSERT INTO tanah_perek (id) VALUES (1);
                INSERT INTO tanah_article_covering_source (article_id, perek_id, pasuk) VALUES (42, 1, 3);
                UPDATE tanah_article SET coverage_verified = TRUE WHERE id = 42;")
                .execute(&mut conn).await?;
            apply_article_covering_source_upgrade(&mut conn, base_path).await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_article_covering_source WHERE article_id = 42 AND perek_id = 1 AND pasuk = 3").fetch_one(&mut conn).await?, 1);
            assert_eq!(query_scalar::<MySql, i64>("SELECT COUNT(*) FROM tanah_article WHERE id = 42 AND coverage_verified = TRUE").fetch_one(&mut conn).await?, 1);

            // Simulate the pre-pasuk-count schema and upgrade it repeatedly;
            // the generated data file then fills the canonical bound for the
            // retained perek row (בראשית א has 31 pesukim).
            raw_sql("ALTER TABLE tanah_perek DROP COLUMN pasuk_count;")
                .execute(&mut conn).await?;
            apply_perek_pasuk_count_data(&mut conn, base_path).await?;
            apply_perek_pasuk_count_data(&mut conn, base_path).await?;
            assert_eq!(query_scalar::<MySql, i64>("SELECT pasuk_count FROM tanah_perek WHERE id = 1").fetch_one(&mut conn).await?, 31);
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
            assert!(
                column_exists(&mut conn, "tanahpedia_person_parent_child", "birth_order").await?
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
            let jacob_birth_orders: Vec<i32> = query_scalar(
                "SELECT birth_order FROM tanahpedia_person_parent_child \
                 WHERE parent_id = 'p2000000-0000-4000-8000-000000000001' \
                 ORDER BY birth_order",
            )
            .fetch_all(&mut conn)
            .await?;
            assert_eq!(jacob_birth_orders, (1..=13).collect::<Vec<_>>());

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

            // Article row so the fixture's article-side decorations land;
            // perek 1 already exists from the covering-source step above.
            raw_sql(
                "INSERT INTO tanah_article (id, perek_id, author_id, name, priority, content) \
                 VALUES (1, 1, 1, 'mention fixture article', 1, '<p>ישראל ויצחק</p>')",
            )
            .execute(&mut conn)
            .await
            .context("Failed to insert mention-fixture article")?;

            apply_mention_test_data(&mut conn, base_path, &cli).await?;
            assert!(tanahpedia_entry_exists(&mut conn, "ישראל").await?);
            assert_eq!(
                table_count(&mut conn, "tanahpedia_mention_decoration").await?,
                3
            );

            // The skip flag must short-circuit before touching the database.
            apply_mention_test_data(
                &mut conn,
                base_path,
                &cli_from(&["--skip-tanah-test-data"]),
            )
            .await?;
            assert_eq!(
                table_count(&mut conn, "tanahpedia_mention_decoration").await?,
                3
            );

            // The reading-metrics upgrade is idempotent and must survive
            // re-application on a database that already has it (#2607).
            apply_reading_metrics_upgrade(&mut conn, base_path).await?;
            apply_reading_metrics_upgrade(&mut conn, base_path).await?;
            for table in [
                "tanah_perek_metric",
                "tanah_perek_pasuk_metric",
                "tanah_article_metric",
                "tanah_article_metric_block",
                "tanah_note_metric",
                "tanah_perush_metric",
                "tanahpedia_entry_metric",
                "tanahpedia_entry_metric_block",
            ] {
                assert_eq!(table_count(&mut conn, table).await?, 0, "{table}");
            }

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
