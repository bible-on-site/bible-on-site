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

use crate::commands::{note_blob, search_index};
use crate::data::extract::{Extracted, Note, Parshan, Perush};

pub fn generate(
    extracted: &Extracted,
    dump_name: &str,
    output_to_dependant_modules: bool,
    tanah_view: &Path,
) -> Result<()> {
    let now = chrono::Utc::now();
    let build_timestamp = now.timestamp();
    let generated_at = now.format("%Y-%m-%d %H:%M:%S UTC").to_string();

    println!("🕐 Build timestamp: {} ({})", build_timestamp, generated_at);

    let (catalog_path, notes_path, index_path) = if output_to_dependant_modules {
        let app_raw =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../app/BibleOnSite/Resources/Raw");
        (
            app_raw.join(format!("{}.perushim_catalog.sqlite", dump_name)),
            // Notes and its prebuilt search index go to the Android PAD pack
            // (on-demand delivery); ODR uses the same files via the iOS dataset.
            {
                let pad_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(
                    "../../../../app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes",
                );
                fs::create_dir_all(&pad_dir)?;
                pad_dir.join(format!("{}.perushim_notes.sqlite", dump_name))
            },
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../../app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes")
                .join(format!("{}.hebrew_search.sqlite", dump_name)),
        )
    } else {
        let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&outputs_dir)?;
        (
            outputs_dir.join(format!("{}.perushim_catalog.sqlite", dump_name)),
            outputs_dir.join(format!("{}.perushim_notes.sqlite", dump_name)),
            outputs_dir.join(format!("{}.hebrew_search.sqlite", dump_name)),
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

    search_index::build_search_index(&notes_path, tanah_view, &index_path)
        .context("failed to build the delivered search index")?;
    println!("📁 Search index written to: {}", index_path.display());

    // Create a gzip-compressed copy for git tracking (SQLite compresses ~75%).
    // The .sqlite.gz is committed to git; the uncompressed .sqlite is gitignored.
    // Perushim data updates are delivered via Play Asset Delivery (PAD) as part of the AAB —
    // there is no independent data update mechanism. Updating perushim data requires a new
    // app version bump → AAB rebuild → Google Play submission. The build_timestamp in
    // _metadata lets the client detect and apply the newer data on app update.
    compress_gz(&notes_path)?;
    compress_gz(&index_path)?;

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
    tx.execute(
        "INSERT INTO _metadata (key,value) VALUES ('schema_version',?1)",
        [note_blob::SCHEMA_VERSION],
    )?;
    // These IDs are assigned during extraction and may move between generations.
    // Carry their names with the independently delivered notes pack so clients can
    // verify the entire mapping before joining it to a bundled catalog.
    let mapping: std::collections::BTreeMap<String, &str> = extracted
        .perushim
        .iter()
        .map(|p| (p.id.to_string(), p.name.as_str()))
        .collect();
    tx.execute(
        "INSERT INTO _metadata (key,value) VALUES ('perush_catalog',?1)",
        [serde_json::to_string(&mapping)?],
    )?;
    insert_note_blobs(&tx, &extracted.notes)?;
    insert_perek_perush(&tx, &extracted.notes)?;
    insert_note_metrics(&tx, &extracted.notes)?;

    tx.commit()?;
    conn.execute_batch("VACUUM")?;

    Ok(())
}

/// Packs every note of a perek into one compressed blob and inserts it into
/// `note_blob`. Notes are ordered by (pasuk, perush_id, note_idx) inside the
/// blob — the read order every consumer expects.
fn insert_note_blobs(tx: &rusqlite::Transaction, notes: &[Note]) -> Result<()> {
    let mut by_perek: std::collections::BTreeMap<i64, Vec<&Note>> =
        std::collections::BTreeMap::new();
    for n in notes {
        by_perek.entry(n.perek_id).or_default().push(n);
    }

    let mut stmt = tx.prepare("INSERT INTO note_blob (perek_id, data) VALUES (?1, ?2)")?;
    for (perek_id, mut perek_notes) in by_perek {
        perek_notes.sort_by_key(|n| (n.pasuk, n.perush_id, n.note_idx));
        let blob = note_blob::encode_perek_blob(&perek_notes)?;
        stmt.execute(rusqlite::params![perek_id, blob])?;
    }
    Ok(())
}

/// Write the shared reading-metrics rows (#2607) — the identical contract
/// the MySQL backfill produces from the same note bodies: per-note word
/// counts with cumulative_words inside each (perush, perek) scope ordered by
/// (pasuk, note_idx), plus the perush×perek estimate row. source_hash parity
/// lets the app detect a stale pack against the online copy.
pub(crate) fn insert_note_metrics(tx: &rusqlite::Transaction, notes: &[Note]) -> Result<()> {
    use std::collections::BTreeMap;

    // Group by (perush, perek); order members by (pasuk, note_idx) — the
    // canonical scope order the MySQL contract uses.
    let mut groups: BTreeMap<(i64, i64), Vec<&Note>> = BTreeMap::new();
    for note in notes {
        groups
            .entry((note.perush_id, note.perek_id))
            .or_default()
            .push(note);
    }

    let mut note_stmt = tx.prepare(
        "INSERT INTO tanah_note_metric
         (perush_id, perek_id, pasuk, note_idx, word_count, cumulative_words, calc_version, source_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    let mut perush_stmt = tx.prepare(
        "INSERT INTO tanah_perush_metric
         (perush_id, perek_id, word_count, estimated_seconds, words_per_minute, calc_version, source_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;

    for ((perush_id, perek_id), mut group) in groups {
        group.sort_by_key(|n| (n.pasuk, n.note_idx));
        let mut cumulative: i64 = 0;
        let mut hashes: Vec<String> = Vec::with_capacity(group.len());
        for note in group {
            let plain = reading_metrics::html_to_plain_text(&note.note_content);
            let word_count = reading_metrics::count_text_words(&plain);
            let hash = reading_metrics::metric_source_hash(&plain);
            cumulative += word_count;
            note_stmt.execute(rusqlite::params![
                note.perush_id,
                note.perek_id,
                note.pasuk,
                note.note_idx,
                word_count,
                cumulative,
                reading_metrics::READING_METRICS_CALC_VERSION,
                hash,
            ])?;
            hashes.push(hash);
        }
        let group_hash = reading_metrics::metric_source_hash(&hashes.join("\n"));
        perush_stmt.execute(rusqlite::params![
            perush_id,
            perek_id,
            cumulative,
            reading_metrics::estimate_reading_seconds(cumulative),
            reading_metrics::READING_WORDS_PER_MINUTE,
            reading_metrics::READING_METRICS_CALC_VERSION,
            group_hash,
        ])?;
    }
    Ok(())
}

/// One row per (perek, perush) — the picker's "which perushim exist here" table.
fn insert_perek_perush(tx: &rusqlite::Transaction, notes: &[Note]) -> Result<()> {
    let pairs: std::collections::BTreeSet<(i64, i64)> =
        notes.iter().map(|n| (n.perek_id, n.perush_id)).collect();

    let mut stmt = tx.prepare("INSERT INTO perek_perush (perek_id, perush_id) VALUES (?1, ?2)")?;
    for (perek_id, perush_id) in pairs {
        stmt.execute(rusqlite::params![perek_id, perush_id])?;
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
    use crate::commands::fixtures::{tanah_db, temp_dir};
    use crate::data::extract::{Extracted, Note, Parshan, Perush};
    use flate2::read::GzDecoder;
    use std::io::Read as _;
    use std::path::PathBuf;

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
        let dir = temp_dir("compress");
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
        let dir = temp_dir("catalog");
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

    /// Decodes every `note_blob` row into (perek_id, notes) — the v2 read path.
    fn read_all_blobs(conn: &Connection) -> Vec<(i64, Vec<note_blob::DecodedNote>)> {
        conn.prepare("SELECT perek_id, data FROM note_blob ORDER BY perek_id")
            .unwrap()
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    note_blob::decode_perek_blob(&r.get::<_, Vec<u8>>(1)?).unwrap(),
                ))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn create_notes_db_roundtrip() {
        let dir = temp_dir("notes");
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

        // v2 schema: no row-oriented note table
        let legacy_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy_table, 0, "v2 must not create the note table");

        let version: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, note_blob::SCHEMA_VERSION);

        // Check notes survive the blob roundtrip, ordered by (pasuk, perush_id, note_idx)
        let blobs = read_all_blobs(&conn);
        assert_eq!(blobs.len(), 1, "only perek 1 has notes");
        let (perek_id, notes) = &blobs[0];
        assert_eq!(*perek_id, 1);
        assert_eq!(notes.len(), 3);
        let pasuk1: Vec<_> = notes.iter().filter(|n| n.pasuk == 1).collect();
        assert_eq!(
            pasuk1.len(),
            2,
            "pasuk 1 should have notes from both Rashi and Ibn Ezra"
        );

        // perek_perush holds one row per (perek, perush) pair
        let pairs: Vec<(i64, i64)> = conn
            .prepare("SELECT perek_id, perush_id FROM perek_perush ORDER BY perush_id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(pairs, vec![(1, 1), (1, 2)]);

        // Check metadata build_timestamp
        let ts: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'build_timestamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts, "1700000000");

        let snapshot: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'perush_catalog'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let mapping: std::collections::BTreeMap<String, String> =
            serde_json::from_str(&snapshot).unwrap();
        assert_eq!(
            mapping,
            extracted
                .perushim
                .iter()
                .map(|p| (p.id.to_string(), p.name.clone()))
                .collect()
        );

        // Shared reading-metrics rows (#2607): fixture notes count
        // "בראשית - בשביל התורה" → 3 words, "והארץ היתה תהו" → 3 words,
        // "בראשית ברא - הפועל" → 3 words. (perush 1, perek 1) totals 6.
        let note_metric: Vec<(i64, i64, i64)> = conn
            .prepare(
                "SELECT pasuk, word_count, cumulative_words FROM tanah_note_metric
                 WHERE perush_id = 1 AND perek_id = 1 ORDER BY pasuk, note_idx",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(note_metric, vec![(1, 3, 3), (2, 3, 6)]);

        let perush_metric: (i64, i64) = conn
            .query_row(
                "SELECT word_count, estimated_seconds FROM tanah_perush_metric
                 WHERE perush_id = 1 AND perek_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(perush_metric, (6, 2));

        let group_hash: String = conn
            .query_row(
                "SELECT source_hash FROM tanah_perush_metric
                 WHERE perush_id = 2 AND perek_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            group_hash,
            reading_metrics::metric_source_hash(&reading_metrics::metric_source_hash(
                "בראשית ברא - הפועל"
            ))
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn committed_web_and_app_catalogs_use_the_same_id_mapping() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
        let catalog = Connection::open_with_flags(
            root.join(
                "app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
            ),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let web: Vec<serde_json::Value> = serde_json::from_str(
            &fs::read_to_string(
                root.join("web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.perushim.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let app: std::collections::BTreeMap<i64, String> = catalog
            .prepare("SELECT id,name FROM perush")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let web_mapping: std::collections::BTreeMap<i64, String> = web
            .iter()
            .map(|p| {
                (
                    p["id"].as_i64().unwrap(),
                    p["name"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(
            app, web_mapping,
            "Web and app must not assign different names to the same perush ID"
        );
    }

    #[test]
    fn committed_notes_record_the_matching_catalog() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
        let catalog = Connection::open_with_flags(
            root.join(
                "app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
            ),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let archive = fs::File::open(root.join(
            "app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/sefaria-dump-5784-sivan-4.perushim_notes.sqlite.gz"
        )).unwrap();
        let output = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&output).unwrap();
        let path = output.join(format!(
            "perushim-attribution-{}.sqlite",
            std::process::id()
        ));
        {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            std::io::copy(&mut GzDecoder::new(archive), &mut file).unwrap();
        }
        let notes =
            Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let snapshot: Option<String> = notes
            .query_row(
                "SELECT value FROM _metadata WHERE key='perush_catalog'",
                [],
                |r| r.get(0),
            )
            .ok();
        let mapping: std::collections::BTreeMap<String, String> = catalog
            .prepare("SELECT id,name FROM perush")
            .unwrap()
            .query_map([], |r| Ok((r.get::<_, i64>(0)?.to_string(), r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        drop(notes);
        fs::remove_file(path).unwrap();
        assert_eq!(
            snapshot.and_then(|s| {
                serde_json::from_str::<std::collections::BTreeMap<String, String>>(&s).ok()
            }),
            Some(mapping),
            "The delivered notes must prove their complete ID mapping"
        );
    }

    /// Minimal tanah_view the index builder can read verses + sefer ranges from.
    fn index_source_fixture(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("tanah.sqlite");
        tanah_db(
            &path,
            Some("2026-01-03 22:08:48 UTC"),
            &[(1, 50, 1)],
            &[(1, 1, 1, "qri", "בְּרֵאשִׁית בָּרָא")],
            &["tanah_sefer", "tanah_pasuk_segment"],
        );
        path
    }

    /// Removes the files `generate` produces for a dump name in `dir`.
    fn clean_generated(dir: &Path, dump: &str) {
        for suffix in [
            "perushim_catalog.sqlite",
            "perushim_notes.sqlite",
            "hebrew_search.sqlite",
        ] {
            let path = dir.join(format!("{dump}.{suffix}"));
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(path.with_extension("sqlite.gz"));
        }
    }

    /// Deletes generated payloads on drop — a panicking assert must not leak
    /// files into the app resource/asset directories the test writes to.
    struct GeneratedFiles<'a> {
        dirs: &'a [&'a Path],
        dump: &'a str,
    }

    impl Drop for GeneratedFiles<'_> {
        fn drop(&mut self) {
            for dir in self.dirs {
                clean_generated(dir, self.dump);
            }
        }
    }

    /// Asserts the notes + index payloads and their gzip copies exist in `dir`.
    fn assert_notes_pack(dir: &Path, dump: &str) -> (PathBuf, PathBuf) {
        let notes = dir.join(format!("{dump}.perushim_notes.sqlite"));
        let index = dir.join(format!("{dump}.hebrew_search.sqlite"));
        for path in [&notes, &index] {
            assert!(path.exists(), "missing {}", path.display());
            assert!(
                path.with_extension("sqlite.gz").exists(),
                "missing {}.gz",
                path.display()
            );
        }
        (notes, index)
    }

    #[test]
    fn generate_writes_all_payloads_to_the_output_dir() {
        let dir = temp_dir("sqlite_generate");
        let tanah = index_source_fixture(&dir);
        let dump = format!("sqlite-gen-test-{}", std::process::id());
        let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        let _cleanup = GeneratedFiles {
            dirs: &[out_dir.as_path()],
            dump: &dump,
        };
        clean_generated(&out_dir, &dump);

        generate(&sample_extracted(), &dump, false, &tanah).unwrap();

        let catalog = out_dir.join(format!("{dump}.perushim_catalog.sqlite"));
        assert!(catalog.exists(), "missing {}", catalog.display());
        let (notes, index) = assert_notes_pack(&out_dir, &dump);

        // The delivered index is a real queryable FTS5 db fingerprinted to the
        // notes build it was generated from.
        let conn = Connection::open(&index).unwrap();
        let notes_fp: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM search_metadata WHERE name='notes'",
                [],
                |r| r.get(0),
            )
            .ok();
        assert!(
            notes_fp.is_some_and(|fp| fp.starts_with("v4:")),
            "index must publish a content fingerprint"
        );
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE notes MATCH 'בראשית'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(hits > 0);
        conn.close().unwrap();

        // The notes payload carries the compressed blobs the app reads.
        let notes_conn = Connection::open(&notes).unwrap();
        assert_eq!(read_all_blobs(&notes_conn).len(), 1);
        notes_conn.close().unwrap();

        let catalog_conn = Connection::open(&catalog).unwrap();
        let parshanim: i64 = catalog_conn
            .query_row("SELECT COUNT(*) FROM parshan", [], |r| r.get(0))
            .unwrap();
        assert_eq!(parshanim, 2);
        catalog_conn.close().unwrap();

        clean_generated(&out_dir, &dump);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_writes_all_payloads_to_dependant_modules() {
        let dir = temp_dir("sqlite_generate_app");
        let tanah = index_source_fixture(&dir);
        // Unique dump name: the files land next to committed app assets and
        // are removed again at the end of the test.
        let dump = format!("sqlite-gen-app-test-{}", std::process::id());
        let app_raw =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../app/BibleOnSite/Resources/Raw");
        let pad_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes");
        let _cleanup = GeneratedFiles {
            dirs: &[app_raw.as_path(), pad_dir.as_path()],
            dump: &dump,
        };
        clean_generated(&app_raw, &dump);
        clean_generated(&pad_dir, &dump);

        generate(&sample_extracted(), &dump, true, &tanah).unwrap();

        // Catalog ships as an app resource; notes + index ship in the PAD pack.
        let catalog = app_raw.join(format!("{dump}.perushim_catalog.sqlite"));
        assert!(catalog.exists(), "missing {}", catalog.display());
        let (_, index) = assert_notes_pack(&pad_dir, &dump);
        let conn = Connection::open(&index).unwrap();
        let verses_fp: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM search_metadata WHERE name='verses'",
                [],
                |r| r.get(0),
            )
            .ok();
        assert!(verses_fp.is_some());
        conn.close().unwrap();

        clean_generated(&app_raw, &dump);
        clean_generated(&pad_dir, &dump);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn notes_db_overwrite_replaces_old_data() {
        let dir = temp_dir("overwrite");
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
        let note_count: usize = read_all_blobs(&conn)
            .iter()
            .map(|(_, notes)| notes.len())
            .sum();
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
