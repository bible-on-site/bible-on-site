//! Generate SQLite database from MongoDB aggregation.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::models::{Perek, Sefer};

pub fn generate(
    sefarim: &[Sefer],
    dump_name: &str,
    output_to_dependant_modules: bool,
) -> Result<()> {
    let output_path = if output_to_dependant_modules {
        // Output to app/BibleOnSite/Resources/Raw/
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../app/BibleOnSite/Resources/Raw")
            .join(format!("{}.tanah_view.sqlite", dump_name))
    } else {
        let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&outputs_dir)?;
        outputs_dir.join(format!("{}.tanah_view.sqlite", dump_name))
    };

    create_db(&output_path, sefarim, dump_name)?;
    println!("📁 Written to: {}", output_path.display());

    Ok(())
}

fn create_db(path: &Path, sefarim: &[Sefer], dump_name: &str) -> Result<()> {
    // Remove existing file if present
    if path.exists() {
        fs::remove_file(path)?;
    }

    let mut conn = Connection::open(path)?;

    // Read schema from tanah_structure.sql
    let schema_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../sqlite/tanah_structure.sql");
    let schema_sql = fs::read_to_string(&schema_path)
        .with_context(|| format!("Failed to read schema from {}", schema_path.display()))?;

    // Apply performance pragmas and then the schema
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

    // Use a transaction for all inserts (massive speedup)
    let tx = conn.transaction()?;

    insert_metadata(&tx, dump_name)?;
    insert_helek_data(&tx, sefarim)?;
    insert_sefarim(&tx, sefarim)?;

    // Commit transaction
    tx.commit()?;

    // Create indexes after bulk insert (faster)
    conn.execute_batch(
        r#"
        CREATE INDEX idx_additional_sefer ON tanah_additional(sefer_id);
        CREATE INDEX idx_perek_date_perek ON tanah_perek_date(perek_id);
        CREATE INDEX idx_segment_sefer ON tanah_pasuk_segment(sefer_id);
        CREATE INDEX idx_segment_perek ON tanah_pasuk_segment(perek_id);
        CREATE INDEX idx_segment_pasuk ON tanah_pasuk_segment(pasuk_id);
        CREATE INDEX idx_segment_type ON tanah_pasuk_segment(segment_type);
        "#,
    )?;

    Ok(())
}

fn insert_metadata(tx: &rusqlite::Transaction, dump_name: &str) -> Result<()> {
    let generated_at = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S UTC")
        .to_string();
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('generator', 'cd data && cargo make generate-tanah-view-sqlite')",
        [],
    )?;
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('source', ?1)",
        [dump_name],
    )?;
    tx.execute(
        "INSERT INTO _metadata (key, value) VALUES ('generated_at', ?1)",
        [&generated_at],
    )?;
    Ok(())
}

fn insert_helek_data(tx: &rusqlite::Transaction, sefarim: &[Sefer]) -> Result<()> {
    // Build helek mapping and insert helek data
    // The data uses 3 heleks: תורה, נביאים, כתובים
    let helek_map: HashMap<&str, i64> = [("תורה", 1), ("נביאים", 2), ("כתובים", 3)]
        .into_iter()
        .collect();

    // First pass to collect sefer ranges per helek
    let mut helek_ranges: HashMap<i64, (i64, i64)> = HashMap::new();

    for (sefer_idx, sefer) in sefarim.iter().enumerate() {
        let sefer_id = (sefer_idx + 1) as i64;
        let helek_id = helek_map.get(sefer.helek.as_str()).copied().unwrap_or(1);

        helek_ranges
            .entry(helek_id)
            .and_modify(|(from, to)| {
                if sefer_id < *from {
                    *from = sefer_id;
                }
                if sefer_id > *to {
                    *to = sefer_id;
                }
            })
            .or_insert((sefer_id, sefer_id));
    }

    // Insert helek data
    for (name, id) in &helek_map {
        if let Some((from, to)) = helek_ranges.get(id) {
            tx.execute(
                "INSERT INTO tanah_helek (id, name, sefer_id_from, sefer_id_to) VALUES (?1, ?2, ?3, ?4)",
                (id, name, from, to),
            )?;
        }
    }

    Ok(())
}

fn insert_sefarim(tx: &rusqlite::Transaction, sefarim: &[Sefer]) -> Result<()> {
    for (sefer_idx, sefer) in sefarim.iter().enumerate() {
        let sefer_id = (sefer_idx + 1) as i64;

        tx.execute(
            "INSERT INTO tanah_sefer (id, name, tanach_us_name, perek_id_from, perek_id_to)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                sefer_id,
                &sefer.name,
                &sefer.tanach_us_name,
                sefer.perek_from,
                sefer.perek_to,
            ),
        )?;

        // Insert perakim directly under sefer
        if let Some(perakim) = &sefer.perakim {
            insert_perakim(tx, sefer_id, perakim)?;
        }

        // Insert additionals
        if let Some(additionals) = &sefer.additionals {
            for additional in additionals {
                tx.execute(
                    "INSERT INTO tanah_additional (sefer_id, letter, tanach_us_name, perek_from, perek_to)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    (
                        sefer_id,
                        &additional.letter,
                        additional.tanach_us_name.as_deref().unwrap_or(""),
                        additional.perek_from,
                        additional.perek_to,
                    ),
                )?;

                insert_perakim(tx, sefer_id, &additional.perakim)?;
            }
        }
    }

    Ok(())
}

fn insert_perakim(tx: &rusqlite::Transaction, sefer_id: i64, perakim: &[Perek]) -> Result<()> {
    for perek in perakim {
        // Insert perek
        tx.execute(
            "INSERT INTO tanah_perek (id, perek, header) VALUES (?1, ?2, ?3)",
            (perek.perek_id, perek.perek_id, &perek.header),
        )?;

        // Insert perek dates (one per cycle)
        for (cycle_idx, date_val) in perek.date.iter().enumerate() {
            let cycle = (cycle_idx + 1) as i64;
            // date_val is Hebrew date in YYYYMMDD format (e.g., 57750329)
            // star_rise is in HH:MM format
            let star_rise = perek
                .star_rise
                .get(cycle_idx)
                .map(|s| s.as_str())
                .unwrap_or("");
            tx.execute(
                "INSERT OR IGNORE INTO tanah_perek_date (perek_id, cycle, date, hebdate, star_rise)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    perek.perek_id,
                    cycle,
                    date_val.to_string(),
                    date_val.to_string(),
                    star_rise,
                ),
            )?;
        }

        for (pasuk_idx, pasuk) in perek.pesukim.iter().enumerate() {
            let pasuk_id = (pasuk_idx + 1) as i64;

            for segment in pasuk.segments.iter() {
                let seg_type = &segment.segment_type;

                // Insert into base segment table (no offset here - it goes to subtable)
                tx.execute(
                    "INSERT INTO tanah_pasuk_segment (sefer_id, perek_id, pasuk_id, segment_type)
                     VALUES (?1, ?2, ?3, ?4)",
                    (sefer_id, perek.perek_id, pasuk_id, seg_type),
                )?;

                let segment_id = tx.last_insert_rowid();

                // ktiv and qri segments have value
                if (seg_type == "ktiv" || seg_type == "qri")
                    && let Some(value) = &segment.value
                {
                    tx.execute(
                        "INSERT INTO tanah_pasuk_segment_value (id, value) VALUES (?1, ?2)",
                        (segment_id, value),
                    )?;
                }

                // ktiv and qri segments may have offset to paired segment
                if let Some(offset) = segment.qri_ktiv_offset() {
                    tx.execute(
                        "INSERT INTO tanah_pasuk_segment_qri_ktiv_offset (id, qri_ktiv_offset) VALUES (?1, ?2)",
                        (segment_id, offset),
                    )?;
                }

                // qri segments have recording time frame
                if seg_type == "qri"
                    && let Some(tf) = &segment.recording_time_frame
                {
                    tx.execute(
                        "INSERT INTO tanah_pasuk_segment_recording_time_frame (id, recording_time_frame_from, recording_time_frame_to)
                             VALUES (?1, ?2, ?3)",
                        (segment_id, &tf.from, &tf.to),
                    )?;
                }

                // ptuha and stuma have no subtables - only the base segment
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Additional, Pasuk, RecordingTimeFrame, Segment};

    fn segment(segment_type: &str, value: Option<&str>) -> Segment {
        Segment {
            value: value.map(str::to_string),
            segment_type: segment_type.to_string(),
            recording_time_frame: None,
            ktiv_offset: None,
            qri_offset: None,
        }
    }

    fn perek(perek_id: i32, star_rise: Vec<&str>) -> Perek {
        Perek {
            perek_id,
            header: format!("Header {perek_id}"),
            date: vec![57750329, 57750330],
            star_rise: star_rise.into_iter().map(str::to_string).collect(),
            pesukim: vec![Pasuk {
                segments: vec![
                    Segment {
                        value: Some("written".to_string()),
                        segment_type: "ktiv".to_string(),
                        recording_time_frame: None,
                        ktiv_offset: None,
                        qri_offset: Some(1),
                    },
                    Segment {
                        value: Some("read".to_string()),
                        segment_type: "qri".to_string(),
                        recording_time_frame: Some(RecordingTimeFrame {
                            from: "00:01".to_string(),
                            to: "00:02".to_string(),
                        }),
                        ktiv_offset: Some(-1),
                        qri_offset: None,
                    },
                    segment("stuma", None),
                ],
            }],
        }
    }

    fn sample_sefarim() -> Vec<Sefer> {
        vec![
            Sefer {
                id: "book-a".to_string(),
                name: "Book A".to_string(),
                tanach_us_name: Some("BookA".to_string()),
                helek: "Torah".to_string(),
                pesukim_count: 3,
                perek_from: 1,
                perek_to: 1,
                additionals: None,
                perakim: Some(vec![perek(1, vec!["05:30"])]),
            },
            Sefer {
                id: "book-b".to_string(),
                name: "Book B".to_string(),
                tanach_us_name: None,
                helek: "Torah".to_string(),
                pesukim_count: 3,
                perek_from: 2,
                perek_to: 2,
                additionals: Some(vec![Additional {
                    letter: "B".to_string(),
                    name: "Book B II".to_string(),
                    tanach_us_name: None,
                    helek: "Torah".to_string(),
                    order: 2,
                    pesukim_count: 3,
                    perek_from: 2,
                    perek_to: 2,
                    perakim: vec![perek(2, vec!["06:15", "06:16"])],
                }]),
                perakim: None,
            },
        ]
    }

    #[test]
    fn insert_metadata_writes_generator_source_and_timestamp() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();

        let tx = conn.transaction().unwrap();
        insert_metadata(&tx, "dump-name").unwrap();
        tx.commit().unwrap();

        let rows: Vec<(String, String)> = conn
            .prepare("SELECT key, value FROM _metadata ORDER BY key")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        assert_eq!(rows.len(), 3);
        assert!(rows.iter().any(|(key, _)| key == "generated_at"));
        assert!(
            rows.iter()
                .any(|(key, value)| key == "source" && value == "dump-name")
        );
        assert!(
            rows.iter()
                .any(|(key, value)| key == "generator" && value.contains("generate-tanah-view"))
        );
    }

    #[test]
    fn create_db_roundtrips_sefarim_additionals_dates_and_segments() {
        let dir =
            std::env::temp_dir().join(format!("tanah_view_sqlite_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tanah.sqlite");

        create_db(&path, &sample_sefarim(), "dump-name").unwrap();

        let conn = Connection::open(&path).unwrap();
        let sefer_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_sefer", [], |row| row.get(0))
            .unwrap();
        assert_eq!(sefer_count, 2);

        let additional_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_additional", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(additional_count, 1);

        let perek_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_perek", [], |row| row.get(0))
            .unwrap();
        assert_eq!(perek_count, 2);

        let date_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_perek_date", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(date_count, 4);

        let fallback_star_rise: String = conn
            .query_row(
                "SELECT star_rise FROM tanah_perek_date WHERE perek_id = 1 AND cycle = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fallback_star_rise, "");

        let segment_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_pasuk_segment", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(segment_count, 6);

        let value_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_pasuk_segment_value",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value_count, 4);

        let offsets: Vec<i64> = conn
            .prepare("SELECT qri_ktiv_offset FROM tanah_pasuk_segment_qri_ktiv_offset ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(offsets, vec![1, -1, 1, -1]);

        let recording_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_pasuk_segment_recording_time_frame",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recording_count, 2);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_db_overwrites_existing_file() {
        let dir = std::env::temp_dir().join(format!(
            "tanah_view_sqlite_overwrite_test_{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tanah.sqlite");
        fs::write(&path, b"old file").unwrap();

        create_db(&path, &sample_sefarim()[..1], "dump-v1").unwrap();

        let conn = Connection::open(&path).unwrap();
        let source: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key = 'source'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source, "dump-v1");

        fs::remove_dir_all(&dir).ok();
    }
}
