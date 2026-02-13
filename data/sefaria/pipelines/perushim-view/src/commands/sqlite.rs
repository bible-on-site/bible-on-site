//! Generate SQLite databases from pipeline output.
//!
//! Produces TWO SQLite files:
//! 1. **Catalog** (`perushim_catalog.sqlite`) — Small, bundled with the app.
//!    Contains parshan and perush metadata only.
//! 2. **Notes** (`perushim_notes.sqlite`) — Large, delivered via PAD or on-demand download.
//!    Contains individual commentary notes per pasuk.

use anyhow::{Context, Result};
use flate2::Compression;
use flate2::write::GzEncoder;
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

    println!("🕐 Build timestamp: {} ({})", build_timestamp, generated_at);

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

    create_catalog_db(
        &catalog_path,
        extracted,
        dump_name,
        build_timestamp,
        &generated_at,
    )?;
    println!("📁 Catalog written to: {}", catalog_path.display());

    create_notes_db(
        &notes_path,
        extracted,
        dump_name,
        build_timestamp,
        &generated_at,
    )?;
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

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::extract::{Extracted, Note, Parshan, Perush};
    use flate2::read::GzDecoder;
    use std::io::Read as _;

    fn sample_extracted() -> Extracted {
        Extracted {
            parshanim: vec![
                Parshan {
                    id: 1,
                    name: "רש\"י".into(),
                    birth_year: Some(1040),
                    has_pic: true,
                },
                Parshan {
                    id: 2,
                    name: "אבן עזרא".into(),
                    birth_year: Some(1089),
                    has_pic: false,
                },
            ],
            perushim: vec![
                Perush {
                    id: 1,
                    name: "רש\"י על התורה".into(),
                    parshan_id: 1,
                    comp_date: Some("1100".into()),
                    pub_date: None,
                    priority: 100,
                },
                Perush {
                    id: 2,
                    name: "אבן עזרא על התורה".into(),
                    parshan_id: 2,
                    comp_date: Some("1150".into()),
                    pub_date: None,
                    priority: 200,
                },
            ],
            notes: vec![
                Note {
                    perush_id: 1,
                    perek_id: 1,
                    pasuk: 1,
                    note_idx: 0,
                    note_content: "בראשית - בשביל התורה".into(),
                },
                Note {
                    perush_id: 1,
                    perek_id: 1,
                    pasuk: 2,
                    note_idx: 0,
                    note_content: "והארץ היתה תהו".into(),
                },
                Note {
                    perush_id: 2,
                    perek_id: 1,
                    pasuk: 1,
                    note_idx: 0,
                    note_content: "בראשית ברא - הפועל".into(),
                },
            ],
        }
    }

    #[test]
    fn compress_gz_creates_decompressible_copy() {
        let dir = std::env::temp_dir().join("perushim_test_compress");
        fs::create_dir_all(&dir).unwrap();
        let original_path = dir.join("test.sqlite");

        // Write enough content for gzip to actually compress (small inputs grow due to header)
        let content: Vec<u8> = "hello world - test content for compression\n"
            .bytes()
            .cycle()
            .take(4096)
            .collect();
        fs::write(&original_path, &content).unwrap();

        // Compress
        compress_gz(&original_path).unwrap();

        // Verify .gz exists
        let gz_path = original_path.with_extension("sqlite.gz");
        assert!(gz_path.exists(), ".gz file should exist");

        // Decompress and verify roundtrip
        let gz_data = fs::read(&gz_path).unwrap();
        let mut decoder = GzDecoder::new(&gz_data[..]);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed).unwrap();
        assert_eq!(
            decompressed, content,
            "roundtrip should produce identical content"
        );

        // Compressed should be smaller for repetitive content
        assert!(
            gz_data.len() < content.len(),
            "compressed ({}) should be smaller than original ({})",
            gz_data.len(),
            content.len()
        );

        // Cleanup
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn insert_metadata_writes_all_keys() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();

        let tx = conn.transaction().unwrap();
        insert_metadata(&tx, "test-dump", 1700000000, "2023-11-14 12:00:00 UTC").unwrap();
        tx.commit().unwrap();

        let rows: Vec<(String, String)> = conn
            .prepare("SELECT key, value FROM _metadata ORDER BY key")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        let keys: Vec<&str> = rows.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            keys,
            vec!["build_timestamp", "generated_at", "generator", "source"]
        );

        // Verify specific values
        let get_val = |key: &str| rows.iter().find(|(k, _)| k == key).unwrap().1.clone();
        assert_eq!(get_val("build_timestamp"), "1700000000");
        assert_eq!(get_val("source"), "test-dump");
        assert_eq!(get_val("generated_at"), "2023-11-14 12:00:00 UTC");
        assert!(get_val("generator").contains("cargo make"));
    }

    #[test]
    fn create_catalog_db_roundtrip() {
        let dir = std::env::temp_dir().join("perushim_test_catalog");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.perushim_catalog.sqlite");

        let extracted = sample_extracted();
        create_catalog_db(
            &path,
            &extracted,
            "test-dump",
            1700000000,
            "2023-11-14 12:00:00 UTC",
        )
        .unwrap();

        // Verify the DB is readable
        let conn = Connection::open(&path).unwrap();

        // Check parshanim
        let parshan_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM parshan", [], |r| r.get(0))
            .unwrap();
        assert_eq!(parshan_count, 2);

        // Check perushim
        let perush_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM perush", [], |r| r.get(0))
            .unwrap();
        assert_eq!(perush_count, 2);

        // Check metadata has build_timestamp
        let ts: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'build_timestamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts, "1700000000");

        // Check parshan foreign key is valid
        let fk_check: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM perush p JOIN parshan a ON p.parshan_id = a.id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fk_check, 2);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_notes_db_roundtrip() {
        let dir = std::env::temp_dir().join("perushim_test_notes");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.perushim_notes.sqlite");

        let extracted = sample_extracted();
        create_notes_db(
            &path,
            &extracted,
            "test-dump",
            1700000000,
            "2023-11-14 12:00:00 UTC",
        )
        .unwrap();

        let conn = Connection::open(&path).unwrap();

        // Check note count
        let note_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note_count, 3);

        // Check notes for perek 1, pasuk 1
        let pasuk1_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note WHERE perek_id = 1 AND pasuk = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            pasuk1_count, 2,
            "pasuk 1 should have notes from both Rashi and Ibn Ezra"
        );

        // Check indexes exist
        let idx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_note%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 3, "should have 3 note indexes");

        // Check metadata build_timestamp
        let ts: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'build_timestamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts, "1700000000");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn notes_db_overwrite_replaces_old_data() {
        let dir = std::env::temp_dir().join("perushim_test_overwrite");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.perushim_notes.sqlite");

        // First generation
        let mut extracted = sample_extracted();
        create_notes_db(&path, &extracted, "dump-v1", 1000, "old").unwrap();

        // Second generation with different data
        extracted.notes.push(Note {
            perush_id: 2,
            perek_id: 2,
            pasuk: 1,
            note_idx: 0,
            note_content: "new note".into(),
        });
        create_notes_db(&path, &extracted, "dump-v2", 2000, "new").unwrap();

        let conn = Connection::open(&path).unwrap();
        let note_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM note", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            note_count, 4,
            "re-export should contain all notes from second run"
        );

        let ts: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'build_timestamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            ts, "2000",
            "build_timestamp should reflect the second generation"
        );

        fs::remove_dir_all(&dir).ok();
    }
}
