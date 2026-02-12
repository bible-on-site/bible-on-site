//! Generate SQLite databases from pipeline output.
//!
//! Produces TWO SQLite files:
//! 1. **Catalog** (`perushim_catalog.sqlite`) — Small, bundled with the app.
//!    Contains parshan and perush metadata only.
//! 2. **Notes** (`perushim_notes.sqlite`) — Large, delivered via PAD or on-demand download.
//!    Contains individual commentary notes per pasuk.

use anyhow::{Context, Result};
use flate2::write::GzEncoder;
use flate2::Compression;
use rusqlite::Connection;
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::data::extract::{Extracted, Note, Parshan, Perush};

pub fn generate(
    extracted: &Extracted,
    dump_name: &str,
    output_to_dependant_modules: bool,
) -> Result<()> {
    let now = chrono::Utc::now();
    let build_timestamp = now.timestamp();
    let generated_at = now.format("%Y-%m-%d %H:%M:%S UTC").to_string();

    println!(
        "🕐 Build timestamp: {} ({})",
        build_timestamp, generated_at
    );

    let (catalog_path, notes_path) = if output_to_dependant_modules {
        let app_raw =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../app/BibleOnSite/Resources/Raw");
        (
            app_raw.join(format!("{}.perushim_catalog.sqlite", dump_name)),
            // Notes go to Android PAD asset pack (on-demand delivery)
            {
                let pad_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(
                    "../../../../app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes",
                );
                fs::create_dir_all(&pad_dir)?;
                pad_dir.join(format!("{}.perushim_notes.sqlite", dump_name))
            },
        )
    } else {
        let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&outputs_dir)?;
        (
            outputs_dir.join(format!("{}.perushim_catalog.sqlite", dump_name)),
            outputs_dir.join(format!("{}.perushim_notes.sqlite", dump_name)),
        )
    };

    create_catalog_db(&catalog_path, extracted, dump_name, build_timestamp, &generated_at)?;
    println!("📁 Catalog written to: {}", catalog_path.display());

    create_notes_db(&notes_path, extracted, dump_name, build_timestamp, &generated_at)?;
    println!("📁 Notes written to: {}", notes_path.display());

    // Create a gzip-compressed copy for git tracking (SQLite compresses ~75%).
    // The .sqlite.gz is committed to git; the uncompressed .sqlite is gitignored.
    // Perushim data updates are delivered via Play Asset Delivery (PAD) as part of the AAB —
    // there is no independent data update mechanism. Updating perushim data requires a new
    // app version bump → AAB rebuild → Google Play submission. The build_timestamp in
    // _metadata lets the client detect and apply the newer data on app update.
    compress_gz(&notes_path)?;

    Ok(())
}

// ─── Catalog DB (parshan + perush) ──────────────────────────────────────────

fn create_catalog_db(
    path: &Path,
    extracted: &Extracted,
    dump_name: &str,
    build_timestamp: i64,
    generated_at: &str,
) -> Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }

    let mut conn = Connection::open(path)?;

    let schema_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../sqlite/perushim_catalog_structure.sql");
    let schema_sql = fs::read_to_string(&schema_path)
        .with_context(|| format!("Failed to read schema from {}", schema_path.display()))?;

    conn.execute_batch(
        "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;",
    )?;
    conn.execute_batch(&schema_sql)?;

    let tx = conn.transaction()?;

    insert_metadata(&tx, dump_name, build_timestamp, generated_at)?;
    insert_parshanim(&tx, &extracted.parshanim)?;
    insert_perushim(&tx, &extracted.perushim)?;

    tx.commit()?;

    Ok(())
}

/// Shared metadata insertion for both catalog and notes DBs.
fn insert_metadata(
    tx: &rusqlite::Transaction,
    dump_name: &str,
    build_timestamp: i64,
    generated_at: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('generator', 'cd data && cargo make generate-perushim-view-sqlite')",
        [],
    )?;
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('source', ?1)",
        [dump_name],
    )?;
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('generated_at', ?1)",
        [generated_at],
    )?;
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('build_timestamp', ?1)",
        [&build_timestamp.to_string()],
    )?;
    Ok(())
}

fn insert_parshanim(tx: &rusqlite::Transaction, parshanim: &[Parshan]) -> Result<()> {
    let mut stmt =
        tx.prepare("INSERT INTO parshan (id, name, birth_year, has_pic) VALUES (?1, ?2, ?3, ?4)")?;
    for p in parshanim {
        stmt.execute(rusqlite::params![
            p.id,
            p.name,
            p.birth_year,
            if p.has_pic { 1 } else { 0 },
        ])?;
    }
    Ok(())
}

fn insert_perushim(tx: &rusqlite::Transaction, perushim: &[Perush]) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO perush (id, name, parshan_id, comp_date, pub_date, priority) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for p in perushim {
        stmt.execute(rusqlite::params![
            p.id,
            p.name,
            p.parshan_id,
            p.comp_date,
            p.pub_date,
            p.priority,
        ])?;
    }
    Ok(())
}

// ─── Notes DB ───────────────────────────────────────────────────────────────

fn create_notes_db(
    path: &Path,
    extracted: &Extracted,
    dump_name: &str,
    build_timestamp: i64,
    generated_at: &str,
) -> Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }

    let mut conn = Connection::open(path)?;

    let schema_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../sqlite/perushim_notes_structure.sql");
    let schema_sql = fs::read_to_string(&schema_path)
        .with_context(|| format!("Failed to read schema from {}", schema_path.display()))?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA cache_size = 1000000;
        PRAGMA locking_mode = EXCLUSIVE;
        PRAGMA temp_store = MEMORY;
        "#,
    )?;
    conn.execute_batch(&schema_sql)?;

    let tx = conn.transaction()?;

    insert_metadata(&tx, dump_name, build_timestamp, generated_at)?;
    insert_notes(&tx, &extracted.notes)?;

    tx.commit()?;

    // Create indexes after bulk insert
    conn.execute_batch(
        r#"
        CREATE INDEX idx_note_perush ON note(perush_id);
        CREATE INDEX idx_note_perek ON note(perek_id);
        CREATE INDEX idx_note_perek_pasuk ON note(perek_id, pasuk);
        "#,
    )?;

    Ok(())
}

fn insert_notes(tx: &rusqlite::Transaction, notes: &[Note]) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT OR IGNORE INTO note (perush_id, perek_id, pasuk, note_idx, note_content) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for n in notes {
        stmt.execute(rusqlite::params![
            n.perush_id,
            n.perek_id,
            n.pasuk,
            n.note_idx,
            n.note_content
        ])?;
    }
    Ok(())
}

// ─── Compression ─────────────────────────────────────────────────────────────

/// Create a gzip-compressed copy of a file (for git tracking).
fn compress_gz(path: &Path) -> Result<()> {
    let gz_path = path.with_extension("sqlite.gz");
    let input = fs::read(path)?;
    let original_size = input.len() as u64;

    let file = fs::File::create(&gz_path)?;
    let mut encoder = GzEncoder::new(file, Compression::best());
    encoder.write_all(&input)?;
    encoder.finish()?;

    let compressed_size = fs::metadata(&gz_path)?.len();
    let ratio = (compressed_size as f64 / original_size as f64) * 100.0;

    println!(
        "📦 Compressed: {:.1} MB → {:.1} MB ({:.0}%) → {}",
        original_size as f64 / 1_048_576.0,
        compressed_size as f64 / 1_048_576.0,
        ratio,
        gz_path.display()
    );

    Ok(())
}
