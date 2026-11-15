//! Load the delivered catalog and selectively recover chapters absent upstream.
//! A bundled note is usable only when its embedded catalog exactly matches the
//! web catalog that owns the stable IDs. Refreshed chapters replace cached notes.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use flate2::read::GzDecoder;
use rusqlite::{Connection, OpenFlags, params_from_iter};
use serde::Deserialize;

use super::extract::{Extracted, Note, Parshan, Perush};
use crate::commands::note_blob;

const DUMP: &str = "sefaria-dump-5784-sivan-4";

/// Preserve published IDs and recover commentary chapters absent from the
/// current source. Inputs are opened read-only; decompression uses a TempDir.
pub fn preserve_bundled(extracted: Extracted) -> Result<Extracted> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let web = root.join("web/bible-on-site/src/data/db");
    preserve_from_paths(
        extracted,
        &web.join(format!("{DUMP}.parshanim.json")),
        &web.join(format!("{DUMP}.perushim.json")),
        &root
            .join("app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes")
            .join(format!("{DUMP}.perushim_notes.sqlite.gz")),
    )
}

fn preserve_from_paths(
    extracted: Extracted,
    parshanim: &Path,
    perushim: &Path,
    notes: &Path,
) -> Result<Extracted> {
    let baseline = load_catalog(parshanim, perushim)?;
    let refreshed: HashSet<(i64, i64)> = {
        let baseline_ids: HashMap<&str, i64> = baseline
            .perushim
            .iter()
            .map(|p| (p.name.as_str(), p.id))
            .collect();
        let fresh_names: HashMap<i64, &str> = extracted
            .perushim
            .iter()
            .map(|p| (p.id, p.name.as_str()))
            .collect();
        let mut pairs = HashSet::new();
        for note in &extracted.notes {
            let name = fresh_names.get(&note.perush_id).with_context(|| {
                format!("Fresh note references unknown work ID {}", note.perush_id)
            })?;
            if let Some(&id) = baseline_ids.get(name) {
                pairs.insert((id, note.perek_id));
            }
        }
        pairs
    };
    let fallback = load_missing_notes(notes, &baseline, &refreshed)?;
    super::baseline::preserve(extracted, &baseline, fallback)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledParshan {
    id: i64,
    name: String,
    birth_year: Option<i64>,
    has_pic: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledPerush {
    id: i64,
    name: String,
    parshan_id: i64,
    comp_date: Option<String>,
    pub_date: Option<String>,
    priority: i64,
}

fn load_catalog(parshanim: &Path, perushim: &Path) -> Result<Extracted> {
    let authors: Vec<BundledParshan> = serde_json::from_str(
        &fs::read_to_string(parshanim)
            .with_context(|| format!("Read bundled parshanim JSON {}", parshanim.display()))?,
    )
    .with_context(|| format!("Invalid bundled parshanim JSON {}", parshanim.display()))?;
    let works: Vec<BundledPerush> = serde_json::from_str(
        &fs::read_to_string(perushim)
            .with_context(|| format!("Read bundled perushim JSON {}", perushim.display()))?,
    )
    .with_context(|| format!("Invalid bundled perushim JSON {}", perushim.display()))?;
    Ok(Extracted {
        parshanim: authors
            .into_iter()
            .map(|p| Parshan {
                id: p.id,
                name: p.name,
                birth_year: p.birth_year,
                has_pic: p.has_pic,
            })
            .collect(),
        perushim: works
            .into_iter()
            .map(|p| Perush {
                id: p.id,
                name: p.name,
                parshan_id: p.parshan_id,
                comp_date: p.comp_date,
                pub_date: p.pub_date,
                priority: p.priority,
            })
            .collect(),
        notes: Vec::new(),
    })
}

fn load_missing_notes(
    archive: &Path,
    baseline: &Extracted,
    refreshed: &HashSet<(i64, i64)>,
) -> Result<Vec<Note>> {
    let temp = tempfile::tempdir().context("Create temporary bundled-notes directory")?;
    let path = temp.path().join("notes.sqlite");
    {
        let source = File::open(archive)
            .with_context(|| format!("Open bundled notes gzip {}", archive.display()))?;
        let mut decoder = GzDecoder::new(source);
        let mut destination = File::create(&path).context("Create temporary notes SQLite")?;
        io::copy(&mut decoder, &mut destination)
            .with_context(|| format!("Decompress bundled notes gzip {}", archive.display()))?;
    }
    // The SQLite connection drops before TempDir, including on early errors;
    // Windows can therefore remove the temporary database reliably.
    let source = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .context("Open decompressed bundled notes SQLite")?;
    let schema: String = source
        .query_row(
            "SELECT value FROM _metadata WHERE key='schema_version'",
            [],
            |row| row.get(0),
        )
        .context("Bundled notes lack schema_version metadata")?;
    ensure!(
        schema == note_blob::SCHEMA_VERSION,
        "Bundled notes require schema_version {}, found {schema}",
        note_blob::SCHEMA_VERSION
    );
    let snapshot: String = source
        .query_row(
            "SELECT value FROM _metadata WHERE key='perush_catalog'",
            [],
            |row| row.get(0),
        )
        .context("Bundled notes lack perush_catalog metadata")?;
    let snapshot: BTreeMap<String, String> = serde_json::from_str(&snapshot)
        .context("Bundled notes contain invalid perush_catalog JSON")?;
    let expected: BTreeMap<String, String> = baseline
        .perushim
        .iter()
        .map(|p| (p.id.to_string(), p.name.clone()))
        .collect();
    ensure!(
        snapshot == expected,
        "Bundled notes perush_catalog does not exactly match the baseline web catalog"
    );
    let known_ids: HashSet<i64> = baseline.perushim.iter().map(|p| p.id).collect();
    let needed: HashSet<(i64, i64)> = {
        let mut statement = source.prepare("SELECT perush_id,perek_id FROM perek_perush")?;
        let pairs =
            statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
        let mut needed = HashSet::new();
        for pair in pairs {
            let pair = pair?;
            ensure!(
                known_ids.contains(&pair.0),
                "Bundled perek_perush contains unknown commentary ID {}",
                pair.0
            );
            if !refreshed.contains(&pair) {
                needed.insert(pair);
            }
        }
        needed
    };
    if needed.is_empty() {
        return Ok(Vec::new());
    }

    let chapters: HashSet<i64> = needed.iter().map(|(_, perek)| *perek).collect();
    let placeholders = vec!["?"; chapters.len()].join(",");
    let query = format!(
        "SELECT perek_id,data FROM note_blob WHERE perek_id IN ({placeholders}) ORDER BY perek_id"
    );
    let mut statement = source
        .prepare(&query)
        .context("Query bundled notes for absent commentary chapters")?;
    let mut rows = statement.query(params_from_iter(chapters.iter()))?;
    let mut notes = Vec::new();
    let mut recovered = HashSet::new();
    while let Some(row) = rows.next()? {
        let perek_id: i64 = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        for note in note_blob::decode_perek_blob(&blob)
            .with_context(|| format!("Corrupt bundled note_blob for perek {perek_id}"))?
        {
            ensure!(
                known_ids.contains(&note.perush_id),
                "Bundled perek {perek_id} contains unknown commentary ID {}",
                note.perush_id
            );
            let pair = (note.perush_id, perek_id);
            if needed.contains(&pair) {
                recovered.insert(pair);
                notes.push(Note {
                    perush_id: note.perush_id,
                    perek_id,
                    pasuk: note.pasuk,
                    note_idx: note.note_idx,
                    note_content: note.content,
                });
            }
        }
    }
    ensure!(
        recovered == needed,
        "Bundled perek_perush references commentary chapters absent from note_blob"
    );
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};

    struct Fixture {
        _temp: tempfile::TempDir,
        parshanim: std::path::PathBuf,
        perushim: std::path::PathBuf,
        notes: std::path::PathBuf,
    }

    fn archive_sqlite(path: &Path, archive: &Path) {
        let mut input = File::open(path).unwrap();
        let mut encoder = GzEncoder::new(File::create(archive).unwrap(), Compression::fast());
        io::copy(&mut input, &mut encoder).unwrap();
        encoder.finish().unwrap();
    }

    fn edit_archive(fixture: &Fixture, edit: impl FnOnce(&Connection)) {
        let path = fixture._temp.path().join("source.sqlite");
        let connection = Connection::open(&path).unwrap();
        edit(&connection);
        connection.close().unwrap();
        archive_sqlite(&path, &fixture.notes);
    }

    fn fixture(snapshot: &str, corrupt_present_chapter: bool) -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let parshanim = temp.path().join("parshanim.json");
        let perushim = temp.path().join("perushim.json");
        let notes = temp.path().join("notes.sqlite.gz");
        fs::write(
            &parshanim,
            r#"[{"id":1,"name":"author","birthYear":1089,"hasPic":true}]"#,
        )
        .unwrap();
        fs::write(&perushim, r#"[
            {"id":1,"name":"present","parshanId":1,"priority":100,"compDate":"[1143]","pubDate":"[1878]"},
            {"id":2,"name":"missing","parshanId":1,"priority":200}
        ]"#).unwrap();
        let path = temp.path().join("source.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             INSERT INTO _metadata VALUES('schema_version','2');
             CREATE TABLE note_blob(perek_id INTEGER PRIMARY KEY,data BLOB NOT NULL);
             CREATE TABLE perek_perush(perek_id INTEGER,perush_id INTEGER);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO _metadata VALUES('perush_catalog',?1)",
            [snapshot],
        )
        .unwrap();
        let rows = [note(1, "stale present"), note(2, "preserved absent")];
        let refs: Vec<_> = rows.iter().collect();
        conn.execute(
            "INSERT INTO note_blob VALUES(1,?1)",
            [note_blob::encode_perek_blob(&refs).unwrap()],
        )
        .unwrap();
        conn.execute_batch("INSERT INTO perek_perush VALUES(1,1),(1,2),(2,1);")
            .unwrap();
        let mut second_chapter = note(1, "preserved second chapter");
        second_chapter.perek_id = 2;
        let second_blob = if corrupt_present_chapter {
            vec![0]
        } else {
            note_blob::encode_perek_blob(&[&second_chapter]).unwrap()
        };
        conn.execute("INSERT INTO note_blob VALUES(2,?1)", [second_blob])
            .unwrap();
        conn.close().unwrap();
        archive_sqlite(&path, &notes);
        Fixture {
            _temp: temp,
            parshanim,
            perushim,
            notes,
        }
    }

    fn note(perush_id: i64, content: &str) -> Note {
        Note {
            perush_id,
            perek_id: 1,
            pasuk: 1,
            note_idx: 0,
            note_content: content.into(),
        }
    }

    fn fresh(notes: Vec<Note>) -> Extracted {
        Extracted {
            parshanim: vec![Parshan {
                id: 8,
                name: "author".into(),
                birth_year: None,
                has_pic: false,
            }],
            perushim: vec![Perush {
                id: 9,
                name: "present".into(),
                parshan_id: 8,
                comp_date: None,
                pub_date: None,
                priority: 300,
            }],
            notes,
        }
    }

    #[test]
    fn loads_all_catalog_metadata_and_recovers_only_absent_works() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, true);
        let catalog = load_catalog(&f.parshanim, &f.perushim).unwrap();
        assert_eq!(catalog.parshanim[0].birth_year, Some(1089));
        assert!(catalog.parshanim[0].has_pic);
        assert_eq!(catalog.perushim[0].comp_date.as_deref(), Some("[1143]"));
        assert_eq!(catalog.perushim[0].pub_date.as_deref(), Some("[1878]"));
        assert_eq!(catalog.perushim[1].comp_date, None);
        assert_eq!(catalog.perushim[1].pub_date, None);
        let mut second = note(9, "fresh second chapter");
        second.perek_id = 2;
        let result = preserve_from_paths(
            fresh(vec![note(9, "fresh"), second]),
            &f.parshanim,
            &f.perushim,
            &f.notes,
        )
        .unwrap();
        assert_eq!(result.notes.len(), 3);
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.perush_id == 1 && n.note_content == "fresh")
        );
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.perush_id == 2 && n.note_content == "preserved absent")
        );
        assert!(
            !result
                .notes
                .iter()
                .any(|n| n.note_content == "stale present")
        );
        // The corrupt second perek is skipped because its chapter is refreshed.
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.perek_id == 2 && n.note_content == "fresh second chapter")
        );
    }

    #[test]
    fn restores_missing_chapters_of_a_present_work_without_mixing_refreshed_notes() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        let result = preserve_from_paths(
            fresh(vec![note(9, "fresh first chapter")]),
            &f.parshanim,
            &f.perushim,
            &f.notes,
        )
        .unwrap();
        assert_eq!(result.notes.len(), 3);
        assert!(result.notes.iter().any(|n| n.perush_id == 1
            && n.perek_id == 1
            && n.note_content == "fresh first chapter"));
        assert!(result.notes.iter().any(|n| n.perush_id == 1
            && n.perek_id == 2
            && n.note_content == "preserved second chapter"));
        assert!(
            !result
                .notes
                .iter()
                .any(|n| n.note_content == "stale present")
        );
        // A known work with zero fresh notes retains all delivered chapters.
        let result =
            preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes).unwrap();
        assert_eq!(result.notes.len(), 3);
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.perush_id == 1 && n.perek_id == 1 && n.note_content == "stale present")
        );
    }

    #[test]
    fn rejects_mismatched_catalog_and_corrupt_gzip() {
        let f = fixture(r#"{"1":"wrong name","2":"missing"}"#, false);
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("does not exactly match"));
        fs::write(&f.notes, b"not a gzip").unwrap();
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("Decompress bundled notes gzip"));
    }

    #[test]
    fn rejects_invalid_catalog_json_without_mutating_inputs() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        fs::write(&f.parshanim, "broken JSON").unwrap();
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("Invalid bundled parshanim JSON"));
        assert_eq!(fs::read_to_string(&f.parshanim).unwrap(), "broken JSON");
    }

    #[test]
    fn bundled_entry_point_rejects_a_fresh_note_without_a_work() {
        let result = preserve_bundled(Extracted {
            parshanim: Vec::new(),
            perushim: Vec::new(),
            notes: vec![note(9999, "orphan")],
        });
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Fresh note references unknown work ID 9999")
        );
    }

    #[test]
    fn a_new_work_keeps_its_fresh_notes_while_old_chapters_are_recovered() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        let mut source = fresh(vec![note(10, "new work text")]);
        source.perushim.push(Perush {
            id: 10,
            name: "new work".into(),
            parshan_id: 8,
            comp_date: None,
            pub_date: None,
            priority: 400,
        });
        let result = preserve_from_paths(source, &f.parshanim, &f.perushim, &f.notes).unwrap();
        let work = result
            .perushim
            .iter()
            .find(|p| p.name == "new work")
            .unwrap();
        assert_eq!(work.id, 3);
        assert_eq!(result.notes.len(), 4);
        assert!(
            result
                .notes
                .iter()
                .any(|n| n.perush_id == work.id && n.note_content == "new work text")
        );
    }

    #[test]
    fn fully_refreshed_chapters_do_not_open_any_cached_blob() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, true);
        edit_archive(&f, |connection| {
            connection
                .execute("UPDATE note_blob SET data=?1", [vec![0_u8]])
                .unwrap();
        });
        let mut second = note(9, "fresh second chapter");
        second.perek_id = 2;
        let mut source = fresh(vec![
            note(9, "fresh present"),
            second,
            note(10, "fresh missing"),
        ]);
        source.perushim.push(Perush {
            id: 10,
            name: "missing".into(),
            parshan_id: 8,
            comp_date: None,
            pub_date: None,
            priority: 200,
        });
        let result = preserve_from_paths(source, &f.parshanim, &f.perushim, &f.notes).unwrap();
        assert_eq!(result.notes.len(), 3);
        assert!(
            result
                .notes
                .iter()
                .all(|n| n.note_content.starts_with("fresh"))
        );
    }

    #[test]
    fn missing_or_malformed_catalog_files_report_the_failed_input() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        let absent = f._temp.path().join("absent.json");
        let error = load_catalog(&absent, &f.perushim).err().unwrap();
        assert!(error.to_string().contains("Read bundled parshanim JSON"));
        let error = load_catalog(&f.parshanim, &absent).err().unwrap();
        assert!(error.to_string().contains("Read bundled perushim JSON"));
        fs::write(&f.perushim, "broken work JSON").unwrap();
        let error = load_catalog(&f.parshanim, &f.perushim).err().unwrap();
        assert!(error.to_string().contains("Invalid bundled perushim JSON"));
    }

    #[test]
    fn absent_archive_and_invalid_pack_metadata_fail_closed() {
        for (sql, expected) in [
            (
                "UPDATE _metadata SET value='1' WHERE key='schema_version'",
                "Bundled notes require schema_version 2, found 1",
            ),
            (
                "DELETE FROM _metadata WHERE key='schema_version'",
                "Bundled notes lack schema_version metadata",
            ),
            (
                "DELETE FROM _metadata WHERE key='perush_catalog'",
                "Bundled notes lack perush_catalog metadata",
            ),
            (
                "UPDATE _metadata SET value='{' WHERE key='perush_catalog'",
                "Bundled notes contain invalid perush_catalog JSON",
            ),
        ] {
            let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
            edit_archive(&f, |connection| connection.execute_batch(sql).unwrap());
            let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
                .err()
                .unwrap();
            assert!(error.to_string().contains(expected));
        }
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        fs::remove_file(&f.notes).unwrap();
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("Open bundled notes gzip"));
    }

    #[test]
    fn untrusted_index_and_blob_work_ids_are_rejected() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        edit_archive(&f, |connection| {
            connection
                .execute_batch("INSERT INTO perek_perush VALUES(1,99)")
                .unwrap();
        });
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("unknown commentary ID 99"));

        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        edit_archive(&f, |connection| {
            let unknown = note(99, "wrong attribution");
            connection
                .execute(
                    "UPDATE note_blob SET data=?1 WHERE perek_id=1",
                    [note_blob::encode_perek_blob(&[&unknown]).unwrap()],
                )
                .unwrap();
        });
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(
            error
                .to_string()
                .contains("Bundled perek 1 contains unknown commentary ID 99")
        );
    }

    #[test]
    fn corrupt_needed_blobs_and_missing_indexed_chapters_are_rejected() {
        let f = fixture(r#"{"1":"present","2":"missing"}"#, true);
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(
            error
                .to_string()
                .contains("Corrupt bundled note_blob for perek 2")
        );

        let f = fixture(r#"{"1":"present","2":"missing"}"#, false);
        edit_archive(&f, |connection| {
            connection
                .execute_batch("DELETE FROM note_blob WHERE perek_id=2")
                .unwrap();
        });
        let error = preserve_from_paths(fresh(Vec::new()), &f.parshanim, &f.perushim, &f.notes)
            .err()
            .unwrap();
        assert!(error.to_string().contains("chapters absent from note_blob"));
    }
}
