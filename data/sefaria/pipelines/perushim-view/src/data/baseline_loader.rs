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
        let mut input = File::open(&path).unwrap();
        let mut encoder = GzEncoder::new(File::create(&notes).unwrap(), Compression::fast());
        io::copy(&mut input, &mut encoder).unwrap();
        encoder.finish().unwrap();
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
}
