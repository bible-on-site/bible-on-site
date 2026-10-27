//! Decorate an existing v2 notes SQLite with the shared reading-metrics
//! tables (issue #2607) — `tanah_note_metric` + `tanah_perush_metric`.
//!
//! Fresh generations write the tables through `perushim_notes_structure.sql`
//! + `insert_note_metrics`.
//!
//! This command back-fills a pack that was built before the contract existed
//! by decoding its own `note_blob` rows — the same source content, so the
//! rows match a from-scratch generation exactly. The DDL mirrors the
//! structure file's tables (drop + recreate so stale or half-populated rows
//! can never survive).

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::commands::{note_blob, sqlite};
use crate::data::extract::Note;

const METRICS_DDL: &str = r#"
DROP TABLE IF EXISTS tanah_note_metric;
DROP TABLE IF EXISTS tanah_perush_metric;

CREATE TABLE tanah_note_metric (
  perush_id INTEGER NOT NULL,
  perek_id INTEGER NOT NULL,
  pasuk INTEGER NOT NULL,
  note_idx INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  cumulative_words INTEGER NOT NULL,
  calc_version INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (perush_id, perek_id, pasuk, note_idx)
);

CREATE TABLE tanah_perush_metric (
  perush_id INTEGER NOT NULL,
  perek_id INTEGER NOT NULL,
  word_count INTEGER,
  estimated_seconds INTEGER,
  words_per_minute INTEGER NOT NULL,
  calc_version INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (perush_id, perek_id)
);
"#;

/// Read every note back out of the v2 blob storage — the read shape the
/// metrics computation shares with a fresh generation.
fn read_all_notes(conn: &Connection) -> Result<Vec<Note>> {
    let mut stmt = conn.prepare("SELECT perek_id, data FROM note_blob ORDER BY perek_id")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;
    let mut notes = Vec::new();
    for row in rows {
        let (perek_id, blob) = row?;
        for decoded in note_blob::decode_perek_blob(&blob)? {
            notes.push(Note {
                perush_id: decoded.perush_id,
                perek_id,
                pasuk: decoded.pasuk,
                note_idx: decoded.note_idx,
                note_content: decoded.content,
            });
        }
    }
    Ok(notes)
}

/// Recreate the metric tables inside `input` and fill them from its own
/// note blobs. Idempotent: rerunning drops and rewrites the same rows.
pub fn apply(input: &Path) -> Result<()> {
    let mut conn = Connection::open(input)
        .with_context(|| format!("open notes sqlite {}", input.display()))?;
    let schema_version: String = conn
        .query_row(
            "SELECT value FROM _metadata WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .context("notes pack lacks _metadata.schema_version — not a v2 notes sqlite")?;
    if schema_version != note_blob::SCHEMA_VERSION {
        anyhow::bail!(
            "unsupported notes schema_version '{schema_version}' (expected {})",
            note_blob::SCHEMA_VERSION
        );
    }

    let notes = read_all_notes(&conn)?;
    // DDL + inserts share one transaction: a failed refresh rolls the drops
    // back too, leaving an already-decorated pack's previous metrics intact.
    let tx = conn.transaction()?;
    tx.execute_batch(METRICS_DDL)?;
    sqlite::insert_note_metrics(&tx, &notes)?;
    tx.commit()?;
    conn.execute_batch("VACUUM")?;
    println!(
        "✅ reading metrics applied: {} notes → {}",
        notes.len(),
        input.display()
    );
    Ok(())
}
