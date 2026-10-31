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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fixtures::{temp_dir, v2_notes_db};

    fn note(perush_id: i64, perek_id: i64, pasuk: i64, note_idx: i64, content: &str) -> Note {
        Note {
            perush_id,
            perek_id,
            pasuk,
            note_idx,
            note_content: content.to_string(),
        }
    }

    fn metric_counts(conn: &Connection) -> (i64, i64) {
        (
            conn.query_row("SELECT COUNT(*) FROM tanah_note_metric", [], |r| r.get(0))
                .unwrap(),
            conn.query_row("SELECT COUNT(*) FROM tanah_perush_metric", [], |r| r.get(0))
                .unwrap(),
        )
    }

    #[test]
    fn apply_backfills_metrics_from_the_packs_own_blobs() {
        let dir = temp_dir("note_metrics_apply");
        let path = dir.join("notes.sqlite");
        // A pre-#2607 pack: blobs + metadata but no metric tables.
        v2_notes_db(
            &path,
            Some(note_blob::SCHEMA_VERSION),
            None,
            &[
                (
                    1,
                    vec![
                        note(1, 1, 1, 0, "בראשית - בשביל התורה"),
                        note(1, 1, 2, 0, "והארץ היתה תהו"),
                        note(2, 1, 1, 0, "בראשית ברא - הפועל"),
                    ],
                ),
                (2, vec![note(1, 2, 1, 0, "next perek note")]),
            ],
            &[],
        );

        apply(&path).unwrap();

        let conn = Connection::open(&path).unwrap();
        // Same contract create_notes_db emits: 3 words per fixture note,
        // cumulative inside each (perush, perek) scope.
        let note_metrics: Vec<(i64, i64, i64)> = conn
            .prepare(
                "SELECT pasuk, word_count, cumulative_words FROM tanah_note_metric
                 WHERE perush_id = 1 AND perek_id = 1 ORDER BY pasuk, note_idx",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(note_metrics, vec![(1, 3, 3), (2, 3, 6)]);
        let perush_metric: (i64, i64) = conn
            .query_row(
                "SELECT word_count, estimated_seconds FROM tanah_perush_metric
                 WHERE perush_id = 1 AND perek_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(perush_metric, (6, 2));
        assert_eq!(metric_counts(&conn), (4, 3));
        conn.close().unwrap();

        // Rerunning drops and rewrites the same rows — the backfill is
        // idempotent rather than duplicating.
        apply(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        assert_eq!(metric_counts(&conn), (4, 3));
        conn.close().unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_fails_when_the_input_cannot_be_opened() {
        let dir = temp_dir("note_metrics_missing");
        let missing = dir.join("nope/notes.sqlite");

        let err = apply(&missing).unwrap_err();

        assert!(err.to_string().contains("open notes sqlite"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_rejects_a_pack_without_schema_version() {
        let dir = temp_dir("note_metrics_no_version");
        let path = dir.join("notes.sqlite");
        v2_notes_db(&path, None, None, &[], &[]);

        let err = apply(&path).unwrap_err();

        assert!(err.to_string().contains("not a v2 notes sqlite"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_rejects_a_mismatched_schema_version() {
        let dir = temp_dir("note_metrics_bad_version");
        let path = dir.join("notes.sqlite");
        v2_notes_db(&path, Some("99"), None, &[], &[]);

        let err = apply(&path).unwrap_err();

        assert!(
            err.to_string()
                .contains("unsupported notes schema_version '99'"),
            "{err}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_fails_when_a_blob_cannot_be_decoded() {
        let dir = temp_dir("note_metrics_corrupt");
        let path = dir.join("notes.sqlite");
        // A corrupt blob must fail the backfill, not write half metrics.
        v2_notes_db(
            &path,
            Some(note_blob::SCHEMA_VERSION),
            None,
            &[],
            &[(1, b"not-a-blob".to_vec())],
        );

        assert!(apply(&path).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
