//! Convert a v1 row-based perushim notes SQLite to the v2 blob schema.
//!
//! Used to re-generate the committed `.sqlite.gz` fallback artifact without a
//! MongoDB dump: `--format convert-notes --input <v1.sqlite> --output <v2.sqlite>`.
//! Carries `_metadata` forward (fresh `schema_version`), then verifies the
//! output by decoding every blob and comparing against the source rows.

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::Path;

use crate::commands::note_blob;
use crate::data::extract::Note;

pub fn generate(input: &Path, output: &Path) -> Result<()> {
    let source = Connection::open_with_flags(input, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open {}", input.display()))?;
    ensure_v1(&source)?;

    if output.exists() {
        fs::remove_file(output)?;
    }
    let mut target = Connection::open(output)?;
    let schema_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../sqlite/perushim_notes_structure.sql");
    target.execute_batch(&fs::read_to_string(&schema_path)?)?;

    copy_metadata(&source, &target)?;
    convert_notes(&source, &mut target)?;
    verify_roundtrip(&source, &target)?;

    target.execute_batch("VACUUM")?;
    target.close().map_err(|(_, e)| e)?;

    let in_mb = fs::metadata(input)?.len() as f64 / 1_048_576.0;
    let out_mb = fs::metadata(output)?.len() as f64 / 1_048_576.0;
    println!("✅ {input:?} ({in_mb:.1} MB) → {output:?} ({out_mb:.1} MB)");
    Ok(())
}

fn ensure_v1(source: &Connection) -> Result<()> {
    let has_note_table: bool = source.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='note'",
        [],
        |r| r.get(0),
    )?;
    let version: Option<String> = source
        .query_row(
            "SELECT value FROM _metadata WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    match (has_note_table, version.as_deref()) {
        (true, None) | (true, Some("1")) => Ok(()),
        _ => bail!(
            "expected a v1 notes DB (row-oriented `note` table, no schema_version); \
             check the input file"
        ),
    }
}

/// Copies `_metadata` as-is, then stamps the new schema version.
fn copy_metadata(source: &Connection, target: &Connection) -> Result<()> {
    let mut read = source.prepare("SELECT key, value FROM _metadata")?;
    let mut write = target.prepare("INSERT INTO _metadata (key, value) VALUES (?1, ?2)")?;
    let rows = read.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (key, value) = row?;
        write.execute(rusqlite::params![key, value])?;
    }
    drop(write);
    drop(read);
    target.execute(
        "INSERT OR REPLACE INTO _metadata (key, value) VALUES ('schema_version', ?1)",
        [note_blob::SCHEMA_VERSION],
    )?;
    Ok(())
}

/// Streams source rows ordered by perek, packing each perek's notes into a blob.
fn convert_notes(source: &Connection, target: &mut Connection) -> Result<()> {
    let tx = target.transaction()?;

    let mut seen: std::collections::BTreeSet<(i64, i64)> = std::collections::BTreeSet::new();
    {
        let mut read = source.prepare(
            "SELECT perek_id, pasuk, perush_id, note_idx, note_content \
             FROM note ORDER BY perek_id, pasuk, perush_id, note_idx",
        )?;
        let mut write_blob =
            tx.prepare("INSERT INTO note_blob (perek_id, data) VALUES (?1, ?2)")?;
        let mut write_pp =
            tx.prepare("INSERT INTO perek_perush (perek_id, perush_id) VALUES (?1, ?2)")?;

        let mut rows = read.query([])?;
        let mut perek_id: Option<i64> = None;
        let mut buffer: Vec<Note> = Vec::new();
        while let Some(row) = rows.next()? {
            let note = Note {
                perek_id: row.get(0)?,
                pasuk: row.get(1)?,
                perush_id: row.get(2)?,
                note_idx: row.get(3)?,
                note_content: row.get(4)?,
            };
            if perek_id.is_some_and(|id| id != note.perek_id) {
                flush(perek_id.unwrap(), &mut buffer, &mut write_blob)?;
            }
            perek_id = Some(note.perek_id);
            seen.insert((note.perek_id, note.perush_id));
            buffer.push(note);
        }
        if let Some(id) = perek_id {
            flush(id, &mut buffer, &mut write_blob)?;
        }
        drop(rows);
        drop(read);
        drop(write_blob);

        for (perek, perush) in &seen {
            write_pp.execute(rusqlite::params![perek, perush])?;
        }
    }

    tx.commit()?;
    Ok(())
}

fn flush(
    perek_id: i64,
    buffer: &mut Vec<Note>,
    write_blob: &mut rusqlite::Statement,
) -> Result<()> {
    let refs: Vec<&Note> = buffer.iter().collect();
    let blob = note_blob::encode_perek_blob(&refs)?;
    write_blob.execute(rusqlite::params![perek_id, blob])?;
    buffer.clear();
    Ok(())
}

/// Decodes every written blob and compares it to the source rows, in order.
fn verify_roundtrip(source: &Connection, target: &Connection) -> Result<()> {
    let mut read_source = source.prepare(
        "SELECT perek_id, pasuk, perush_id, note_idx, note_content \
         FROM note ORDER BY perek_id, pasuk, perush_id, note_idx",
    )?;
    let expected: Vec<(i64, i64, i64, i64, String)> = read_source
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<Result<_, _>>()?;

    let mut read_blobs =
        target.prepare("SELECT perek_id, data FROM note_blob ORDER BY perek_id")?;
    let mut actual: Vec<(i64, i64, i64, i64, String)> = Vec::with_capacity(expected.len());
    let mut rows = read_blobs.query([])?;
    while let Some(row) = rows.next()? {
        let perek_id: i64 = row.get(0)?;
        for n in note_blob::decode_perek_blob(&row.get::<_, Vec<u8>>(1)?)? {
            actual.push((perek_id, n.pasuk, n.perush_id, n.note_idx, n.content));
        }
    }

    anyhow::ensure!(
        actual == expected,
        "blob verification failed: {} decoded records vs {} source rows",
        actual.len(),
        expected.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fixtures::{temp_dir, v1_notes_db};

    /// One decoded v2 note row: (perek, pasuk, perush, idx, content).
    type DecodedRow = (i64, i64, i64, i64, String);

    /// Decoded v2 contents: ordered note rows plus the (perek, perush)
    /// picker pairs.
    fn v2_rows(path: &Path) -> (Vec<DecodedRow>, Vec<(i64, i64)>) {
        let conn = Connection::open(path).unwrap();
        let mut decoded = Vec::new();
        let mut stmt = conn
            .prepare("SELECT perek_id, data FROM note_blob ORDER BY perek_id")
            .unwrap();
        let mut rows = stmt.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            let perek_id: i64 = row.get(0).unwrap();
            for n in note_blob::decode_perek_blob(&row.get::<_, Vec<u8>>(1).unwrap()).unwrap() {
                decoded.push((perek_id, n.pasuk, n.perush_id, n.note_idx, n.content));
            }
        }
        drop(rows);
        drop(stmt);
        let pairs = conn
            .prepare("SELECT perek_id, perush_id FROM perek_perush ORDER BY perek_id, perush_id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        conn.close().unwrap();
        (decoded, pairs)
    }

    #[test]
    fn generate_converts_v1_rows_into_per_perek_blobs() {
        let dir = temp_dir("roundtrip");
        let input = dir.join("v1.perushim_notes.sqlite");
        v1_notes_db(
            &input,
            None,
            &[
                (7, 1, 1, 0, "<b>בראשית</b> בשביל התורה"),
                (9, 1, 1, 0, "שני פרוש על אותו פסוק"),
                (7, 1, 2, 0, "והארץ היתה תהו"),
                (7, 1, 2, 1, "note idx one"),
                (7, 2, 1, 0, "perek two note"),
            ],
            &[("build_timestamp", "1700000000"), ("source", "test-dump")],
        );
        let output = dir.join("v2.perushim_notes.sqlite");

        generate(&input, &output).unwrap();

        let conn = Connection::open(&output).unwrap();
        let version: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, note_blob::SCHEMA_VERSION);
        // Metadata is carried forward alongside the fresh schema stamp.
        let ts: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key='build_timestamp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts, "1700000000");
        let source: String = conn
            .query_row("SELECT value FROM _metadata WHERE key='source'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(source, "test-dump");
        // v1 table must not exist in the converted DB.
        let legacy: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy, 0);
        conn.close().unwrap();

        // One blob per perek — perek 1 holds 4 notes, perek 2 holds 1.
        let (decoded, pairs) = v2_rows(&output);
        assert_eq!(
            decoded,
            vec![
                (1, 1, 7, 0, "<b>בראשית</b> בשביל התורה".to_string()),
                (1, 1, 9, 0, "שני פרוש על אותו פסוק".to_string()),
                (1, 2, 7, 0, "והארץ היתה תהו".to_string()),
                (1, 2, 7, 1, "note idx one".to_string()),
                (2, 1, 7, 0, "perek two note".to_string()),
            ]
        );
        assert_eq!(pairs, vec![(1, 7), (1, 9), (2, 7)]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_accepts_explicit_v1_schema_version() {
        let dir = temp_dir("v1-stamped");
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, Some("1"), &[(1, 1, 1, 0, "note")], &[]);
        let output = dir.join("out.sqlite");

        generate(&input, &output).unwrap();

        let conn = Connection::open(&output).unwrap();
        let version: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "2", "conversion restamps v1 metadata as v2");
        conn.close().unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_with_empty_note_table_produces_valid_empty_v2() {
        let dir = temp_dir("empty");
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, None, &[], &[("build_timestamp", "42")]);
        let output = dir.join("out.sqlite");

        generate(&input, &output).unwrap();

        let (decoded, pairs) = v2_rows(&output);
        assert!(decoded.is_empty());
        assert!(pairs.is_empty());
        let conn = Connection::open(&output).unwrap();
        let version: String = conn
            .query_row(
                "SELECT value FROM _metadata WHERE key='schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, note_blob::SCHEMA_VERSION);
        conn.close().unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_overwrites_existing_output_file() {
        let dir = temp_dir("overwrite");
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, None, &[(3, 5, 7, 0, "fresh")], &[]);
        let output = dir.join("out.sqlite");
        fs::write(&output, b"stale contents").unwrap();

        generate(&input, &output).unwrap();

        let (decoded, _) = v2_rows(&output);
        assert_eq!(decoded, vec![(5, 7, 3, 0, "fresh".to_string())]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_rejects_v2_input() {
        let dir = temp_dir("reject-v2");
        // A v2-shaped DB: schema_version 2 and no `note` table.
        let input = dir.join("v2.sqlite");
        let conn = Connection::open(&input).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO _metadata VALUES ('schema_version','2');",
        )
        .unwrap();
        conn.close().unwrap();

        let err = generate(&input, &dir.join("out.sqlite")).unwrap_err();
        assert!(
            err.to_string().contains("expected a v1 notes DB"),
            "unexpected error: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_rejects_note_table_with_newer_schema() {
        let dir = temp_dir("reject-v3");
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, Some("3"), &[(1, 1, 1, 0, "n")], &[]);

        let err = generate(&input, &dir.join("out.sqlite")).unwrap_err();
        assert!(err.to_string().contains("expected a v1 notes DB"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_rejects_note_table_with_unknown_version_and_missing_input() {
        let dir = temp_dir("reject-misc");
        // Note table exists but carries a foreign schema marker.
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, Some("custom"), &[(1, 1, 1, 0, "n")], &[]);
        assert!(
            generate(&input, &dir.join("out.sqlite"))
                .unwrap_err()
                .to_string()
                .contains("expected a v1 notes DB")
        );

        // A missing file surfaces the open-error context.
        let missing = dir.join("does-not-exist.sqlite");
        let err = generate(&missing, &dir.join("out.sqlite")).unwrap_err();
        assert!(
            err.to_string().contains("failed to open"),
            "unexpected error: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_errors_when_output_directory_is_missing() {
        let dir = temp_dir("bad-output");
        let input = dir.join("v1.sqlite");
        v1_notes_db(&input, None, &[(1, 1, 1, 0, "n")], &[]);
        let output = dir.join("no-such-dir").join("out.sqlite");

        assert!(generate(&input, &output).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_errors_on_a_non_sqlite_input_file() {
        let dir = temp_dir("garbage-input");
        let input = dir.join("garbage.sqlite");
        fs::write(&input, b"this is not a sqlite database at all").unwrap();

        assert!(generate(&input, &dir.join("out.sqlite")).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
