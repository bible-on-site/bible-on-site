//! Generate SQLite database from MongoDB aggregation.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::models::{Perek, Sefer};

pub fn generate(sefarim: &[Sefer], dump_name: &str, output_to_dependant_modules: bool) -> Result<()> {
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
            let star_rise = perek.star_rise.get(cycle_idx).map(|s| s.as_str()).unwrap_or("");
            tx.execute(
                "INSERT OR IGNORE INTO tanah_perek_date (perek_id, cycle, date, hebdate, star_rise)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                (perek.perek_id, cycle, date_val.to_string(), date_val.to_string(), star_rise),
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
