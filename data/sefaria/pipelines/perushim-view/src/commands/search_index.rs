//! Builds the ready-to-query offline search database delivered with the notes
//! pack, replacing the app's per-device decompression of every commentary blob.
//!
//! The file mirrors the schema `SearchIndexService` produces on-device:
//! `{verses,notes}_documents` + matching external-content FTS5 tables + an
//! `fts5vocab` per table + `search_metadata` content fingerprints. Verses come
//! from the committed `tanah_view` SQLite; commentary comes from the generated
//! notes DB. Fingerprints (`v4:{content-id}:n{norm}`) bind the index to the
//! exact content generation and normalization rules — the app compares them
//! instead of file timestamps.

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::Path;

use crate::commands::note_blob;
use crate::commands::search_text;

/// Stable content identity the app derives for each indexed table: the
/// `_metadata` key read from the content DB (notes → build_timestamp,
/// tanah_view → generated_at) folded into a fingerprint with NORM_VERSION.
const NOTES_CONTENT_KEY: &str = "build_timestamp";
const VERSES_CONTENT_KEY: &str = "generated_at";

/// `v4:{content-id}:n{norm}` — bump `search_text::NORM_VERSION` when the
/// normalization/token rules change; both sides then regenerate the index.
pub fn fingerprint(content_id: &str) -> String {
    format!("v4:{content_id}:n{}", search_text::NORM_VERSION)
}

/// Builds `<dump>.hebrew_search.sqlite` from a v2 notes DB + the tanah_view DB.
/// Identity (build_timestamp / generated_at) is read from the sources, so the
/// index always fingerprints the exact generation it was built against.
pub fn build_search_index(notes_db: &Path, tanah_view: &Path, out: &Path) -> Result<()> {
    let notes = Connection::open_with_flags(notes_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open notes DB {}", notes_db.display()))?;
    ensure_v2_notes(&notes)?;
    let tanah = Connection::open_with_flags(tanah_view, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open tanah_view {}", tanah_view.display()))?;

    let notes_id = metadata_value(&notes, NOTES_CONTENT_KEY)
        .context("notes DB lacks _metadata.build_timestamp")?;
    let verses_id = metadata_value(&tanah, VERSES_CONTENT_KEY)
        .context("tanah_view lacks _metadata.generated_at")?;
    let sefer_of = SeferRanges::load(&tanah)?;

    if out.exists() {
        fs::remove_file(out)?;
    }
    let mut index = Connection::open(out)?;
    index.execute_batch(
        "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA cache_size = 1000000; \
         PRAGMA locking_mode = EXCLUSIVE; PRAGMA temp_store = MEMORY;",
    )?;
    index.execute_batch(
        "CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT);
         CREATE TABLE verses_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER);
         CREATE VIRTUAL TABLE verses USING fts5(Text, content='verses_documents', content_rowid='rowid');
         CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY, Text TEXT, PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER);
         CREATE VIRTUAL TABLE notes USING fts5(Text, content='notes_documents', content_rowid='rowid');",
    )?;

    insert_verses(&mut index, &tanah, &sefer_of)?;
    insert_notes(&mut index, &notes, &sefer_of)?;

    index.execute_batch(
        "CREATE VIRTUAL TABLE verses_vocab USING fts5vocab(verses, 'row');
         CREATE VIRTUAL TABLE notes_vocab USING fts5vocab(notes, 'row');
         INSERT INTO verses(verses) VALUES ('optimize');
         INSERT INTO notes(notes) VALUES ('optimize');",
    )?;
    // The fingerprint publishes only after every table is complete — the app's
    // own build uses the same contract to distinguish finished indexes.
    index.execute(
        "INSERT INTO search_metadata VALUES ('verses', ?1)",
        [fingerprint(&verses_id)],
    )?;
    index.execute(
        "INSERT INTO search_metadata VALUES ('notes', ?1)",
        [fingerprint(&notes_id)],
    )?;
    index.execute_batch("VACUUM")?;
    index.close().map_err(|(_, e)| e)?;
    Ok(())
}

fn metadata_value(conn: &Connection, key: &str) -> Result<String> {
    conn.query_row("SELECT value FROM _metadata WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .with_context(|| format!("_metadata key '{key}' missing"))
}

/// perek_id → sefer_id lookup built from tanah_sefer ranges, the same way the
/// app resolves `Perek.SeferId` (`p.id BETWEEN s.perek_id_from AND s.perek_id_to`).
struct SeferRanges(Vec<(i64, i64, i64)>);

impl SeferRanges {
    fn load(tanah: &Connection) -> Result<Self> {
        let mut stmt = tanah.prepare(
            "SELECT perek_id_from, perek_id_to, id FROM tanah_sefer ORDER BY perek_id_from",
        )?;
        let ranges = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(ranges))
    }

    fn sefer(&self, perek_id: i64) -> Option<i64> {
        self.0
            .iter()
            .find(|(from, to, _)| perek_id >= *from && perek_id <= *to)
            .map(|(_, _, id)| *id)
    }
}

/// Verses: the exact SQL the app runs so the indexed bodies match.
fn insert_verses(index: &mut Connection, tanah: &Connection, sefer_of: &SeferRanges) -> Result<()> {
    let mut rows = tanah.prepare(
        "SELECT perek_id, pasuk_id, group_concat(value, ' ') FROM (SELECT s.perek_id, s.pasuk_id, v.value \
         FROM tanah_pasuk_segment s JOIN tanah_pasuk_segment_value v ON v.id = s.id \
         WHERE s.segment_type IN ('qri','ktiv') ORDER BY s.perek_id, s.pasuk_id, s.id) \
         GROUP BY perek_id, pasuk_id",
    )?;
    let mut query = rows.query([])?;

    let tx = index.transaction()?;
    {
        let mut doc = tx.prepare(
            "INSERT INTO verses_documents (Text, PerekId, PasukNum, PerushId, SeferId) \
             VALUES (?1, ?2, ?3, 0, ?4)",
        )?;
        let mut fts = tx.prepare("INSERT INTO verses (rowid, Text) VALUES (?1, ?2)")?;
        while let Some(row) = query.next()? {
            let perek_id: i64 = row.get(0)?;
            let Some(sefer_id) = sefer_of.sefer(perek_id) else {
                continue;
            };
            let pasuk: i64 = row.get(1)?;
            let body: String = row.get(2)?;
            let plain = search_text::plain_text(&body);
            let normalized = search_text::normalize(&plain);
            doc.execute(rusqlite::params![plain, perek_id, pasuk, sefer_id])?;
            fts.execute(rusqlite::params![tx.last_insert_rowid(), normalized])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Commentary: decode every perek blob, flatten to plain text, and index the
/// normalized tokens — the same transform `SearchIndexService` applies.
fn insert_notes(index: &mut Connection, notes: &Connection, sefer_of: &SeferRanges) -> Result<()> {
    let mut rows = notes.prepare("SELECT perek_id, data FROM note_blob ORDER BY perek_id")?;
    let mut query = rows.query([])?;

    let tx = index.transaction()?;
    {
        let mut doc = tx.prepare(
            "INSERT INTO notes_documents (Text, PerekId, PasukNum, PerushId, SeferId) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut fts = tx.prepare("INSERT INTO notes (rowid, Text) VALUES (?1, ?2)")?;
        while let Some(row) = query.next()? {
            let perek_id: i64 = row.get(0)?;
            let Some(sefer_id) = sefer_of.sefer(perek_id) else {
                continue;
            };
            let blob: Vec<u8> = row.get(1)?;
            for note in note_blob::decode_perek_blob(&blob)? {
                let plain = search_text::plain_text(&note.content);
                let normalized = search_text::normalize(&plain);
                doc.execute(rusqlite::params![
                    plain,
                    perek_id,
                    note.pasuk,
                    note.perush_id,
                    sefer_id
                ])?;
                fts.execute(rusqlite::params![tx.last_insert_rowid(), normalized])?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Validates that a notes DB is the v2 blob schema before indexing it.
pub fn ensure_v2_notes(notes: &Connection) -> Result<()> {
    let version: Option<String> = notes
        .query_row(
            "SELECT value FROM _metadata WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    if version.as_deref() != Some(note_blob::SCHEMA_VERSION) {
        bail!(
            "search index requires a v2 notes DB (schema_version {})",
            note_blob::SCHEMA_VERSION
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::note_blob::encode_perek_blob;
    use crate::data::extract::Note;

    fn notes_fixture(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("notes.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE note_blob (perek_id INTEGER PRIMARY KEY, data BLOB NOT NULL);
             CREATE TABLE perek_perush (perek_id INTEGER NOT NULL, perush_id INTEGER NOT NULL, PRIMARY KEY (perek_id, perush_id));",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO _metadata VALUES ('build_timestamp','4242')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO _metadata VALUES ('schema_version','2')", [])
            .unwrap();
        let notes = [
            Note {
                perush_id: 7,
                perek_id: 1,
                pasuk: 1,
                note_idx: 0,
                note_content: "<b>בְּרֵאשִׁית</b> בשביל התורה".into(),
            },
            Note {
                perush_id: 7,
                perek_id: 1,
                pasuk: 1,
                note_idx: 1,
                note_content: "שני - עולם &amp; סוף".into(),
            },
            Note {
                perush_id: 9,
                perek_id: 1,
                pasuk: 2,
                note_idx: 0,
                note_content: "והארץ היתה תהו<br>ובהו".into(),
            },
        ];
        let refs: Vec<&Note> = notes.iter().collect();
        let blob = encode_perek_blob(&refs).unwrap();
        conn.execute("INSERT INTO note_blob VALUES (1, ?1)", [blob])
            .unwrap();
        conn.execute("INSERT INTO perek_perush VALUES (1, 7)", [])
            .unwrap();
        conn.execute("INSERT INTO perek_perush VALUES (1, 9)", [])
            .unwrap();
        conn.close().unwrap();
        path
    }

    fn tanah_fixture(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("tanah.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE tanah_sefer (id INTEGER NOT NULL, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER NOT NULL, perek_id_to INTEGER NOT NULL, PRIMARY KEY (id));
             CREATE TABLE tanah_pasuk_segment (id INTEGER PRIMARY KEY, perek_id INTEGER, pasuk_id INTEGER, segment_type TEXT);
             CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO _metadata VALUES ('generated_at','2026-01-03 22:08:48 UTC')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tanah_sefer VALUES (1, 'בראשית', 'genesis', 1, 50)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tanah_pasuk_segment VALUES (1, 1, 1, 'qri')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tanah_pasuk_segment_value VALUES (1, 'בְּרֵאשִׁית בָּרָא')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tanah_pasuk_segment VALUES (2, 1, 2, 'ktiv')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tanah_pasuk_segment_value VALUES (2, 'אֱלֹהִים')",
            [],
        )
        .unwrap();
        conn.close().unwrap();
        path
    }

    #[test]
    fn build_index_is_queryable_and_fingerprinted() {
        let dir = std::env::temp_dir().join(format!("perushim_idx_test_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let notes = notes_fixture(&dir);
        let tanah = tanah_fixture(&dir);
        let out = dir.join("hebrew_search.sqlite");

        build_search_index(&notes, &tanah, &out).unwrap();

        let index = Connection::open(&out).unwrap();
        let notes_fp: String = index
            .query_row(
                "SELECT fingerprint FROM search_metadata WHERE name='notes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(notes_fp, "v4:4242:n1");
        let verses_fp: String = index
            .query_row(
                "SELECT fingerprint FROM search_metadata WHERE name='verses'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(verses_fp, "v4:2026-01-03 22:08:48 UTC:n1");

        // Notes FTS finds the nikud-stripped token.
        let hits: i64 = index
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE notes MATCH '\"בראשית\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);

        // Documents carry the fields the app queries.
        let (sefer, perush, text): (i64, i64, String) = index
            .query_row(
                "SELECT SeferId, PerushId, Text FROM notes_documents LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(sefer, 1);
        assert_eq!(perush, 7);
        assert_eq!(text, "בְּרֵאשִׁית בשביל התורה");

        // Verses indexed with concatenated segments.
        let vhits: i64 = index
            .query_row(
                "SELECT COUNT(*) FROM verses WHERE verses MATCH 'אלהים'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(vhits, 1);

        // Vocab virtual tables exist.
        let vocab: i64 = index
            .query_row(
                "SELECT COUNT(*) FROM notes_vocab WHERE term='בראשית'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(vocab > 0);

        index.close().unwrap();
        fs::remove_dir_all(&dir).ok();
    }
}
