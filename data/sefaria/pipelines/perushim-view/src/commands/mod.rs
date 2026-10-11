//! CLI command implementations.

pub mod compass_stages;
pub mod convert_notes;
pub mod json;
pub mod mysql;
pub mod note_blob;
pub mod search_index;
pub mod search_text;
pub mod sqlite;

/// Shared fixtures for command tests: temp dirs and minimal content DBs in
/// both the v1 (row-oriented `note`) and v2 (compressed `note_blob`) schemas.
#[cfg(test)]
pub(crate) mod fixtures {
    use rusqlite::Connection;
    use std::path::{Path, PathBuf};

    use crate::commands::note_blob;
    use crate::data::extract::Note;

    /// Unique writable temp directory per test name (tempfile's unique suffix
    /// avoids collisions when the same test runs in parallel test binaries).
    pub(crate) fn temp_dir(name: &str) -> PathBuf {
        tempfile::Builder::new()
            .prefix(&format!("perushim_{name}_"))
            .tempdir()
            .unwrap()
            .keep()
    }

    /// A v1 row-oriented notes DB: `note` rows plus `_metadata` rows, with the
    /// `schema_version` key present only when `schema_version` is provided.
    pub(crate) fn v1_notes_db(
        path: &Path,
        schema_version: Option<&str>,
        rows: &[(i64, i64, i64, i64, &str)],
        metadata: &[(&str, &str)],
    ) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, \
                note_idx INTEGER, note_content TEXT);",
        )
        .unwrap();
        for (key, value) in metadata {
            conn.execute(
                "INSERT INTO _metadata (key, value) VALUES (?1, ?2)",
                rusqlite::params![key, value],
            )
            .unwrap();
        }
        if let Some(version) = schema_version {
            conn.execute(
                "INSERT INTO _metadata (key, value) VALUES ('schema_version', ?1)",
                [version],
            )
            .unwrap();
        }
        for (perush_id, perek_id, pasuk, note_idx, content) in rows {
            conn.execute(
                "INSERT INTO note VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![perush_id, perek_id, pasuk, note_idx, content],
            )
            .unwrap();
        }
        conn.close().unwrap();
    }

    /// A v2 notes DB: `_metadata` keys plus one PNB1 `note_blob` row per
    /// perek and the matching `perek_perush` pairs. `raw_blobs` injects
    /// payloads verbatim (undecodable data for error-path tests).
    pub(crate) fn v2_notes_db(
        path: &Path,
        schema_version: Option<&str>,
        build_timestamp: Option<&str>,
        blobs: &[(i64, Vec<Note>)],
        raw_blobs: &[(i64, Vec<u8>)],
    ) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE note_blob (perek_id INTEGER PRIMARY KEY, data BLOB NOT NULL);
             CREATE TABLE perek_perush (perek_id INTEGER NOT NULL, perush_id INTEGER NOT NULL, \
                PRIMARY KEY (perek_id, perush_id));",
        )
        .unwrap();
        if let Some(version) = schema_version {
            conn.execute(
                "INSERT INTO _metadata (key, value) VALUES ('schema_version', ?1)",
                [version],
            )
            .unwrap();
        }
        if let Some(ts) = build_timestamp {
            conn.execute(
                "INSERT INTO _metadata (key, value) VALUES ('build_timestamp', ?1)",
                [ts],
            )
            .unwrap();
        }
        for (perek_id, notes) in blobs {
            let refs: Vec<&Note> = notes.iter().collect();
            conn.execute(
                "INSERT INTO note_blob VALUES (?1, ?2)",
                rusqlite::params![perek_id, note_blob::encode_perek_blob(&refs).unwrap()],
            )
            .unwrap();
            for perush_id in notes
                .iter()
                .map(|n| n.perush_id)
                .collect::<std::collections::BTreeSet<_>>()
            {
                conn.execute(
                    "INSERT OR IGNORE INTO perek_perush VALUES (?1, ?2)",
                    rusqlite::params![perek_id, perush_id],
                )
                .unwrap();
            }
        }
        for (perek_id, data) in raw_blobs {
            conn.execute(
                "INSERT INTO note_blob VALUES (?1, ?2)",
                rusqlite::params![perek_id, data],
            )
            .unwrap();
        }
        conn.close().unwrap();
    }

    /// A tanah_view DB: `_metadata.generated_at`, `tanah_sefer` perek ranges,
    /// and `tanah_pasuk_segment` + `tanah_pasuk_segment_value` verse rows.
    /// `tables` narrows the schema for missing-table error paths.
    pub(crate) fn tanah_db(
        path: &Path,
        generated_at: Option<&str>,
        sefer_ranges: &[(i64, i64, i64)],
        segments: &[(i64, i64, i64, &str, &str)],
        tables: &[&str],
    ) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        if let Some(at) = generated_at {
            conn.execute(
                "INSERT INTO _metadata (key, value) VALUES ('generated_at', ?1)",
                [at],
            )
            .unwrap();
        }
        if tables.contains(&"tanah_sefer") {
            conn.execute_batch(
                "CREATE TABLE tanah_sefer (id INTEGER NOT NULL, name TEXT, tanach_us_name TEXT, \
                    perek_id_from INTEGER NOT NULL, perek_id_to INTEGER NOT NULL, PRIMARY KEY (id));",
            )
            .unwrap();
            for (from, to, id) in sefer_ranges {
                conn.execute(
                    "INSERT INTO tanah_sefer (id, name, perek_id_from, perek_id_to) \
                        VALUES (?1, 'ספר', ?2, ?3)",
                    rusqlite::params![id, from, to],
                )
                .unwrap();
            }
        }
        if tables.contains(&"tanah_pasuk_segment") {
            conn.execute_batch(
                "CREATE TABLE tanah_pasuk_segment (id INTEGER PRIMARY KEY, perek_id INTEGER, \
                    pasuk_id INTEGER, segment_type TEXT);
                 CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT);",
            )
            .unwrap();
            for (id, perek_id, pasuk_id, segment_type, value) in segments {
                conn.execute(
                    "INSERT INTO tanah_pasuk_segment VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![id, perek_id, pasuk_id, segment_type],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO tanah_pasuk_segment_value VALUES (?1, ?2)",
                    rusqlite::params![id, value],
                )
                .unwrap();
            }
        }
        conn.close().unwrap();
    }
}
