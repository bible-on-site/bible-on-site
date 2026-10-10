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
