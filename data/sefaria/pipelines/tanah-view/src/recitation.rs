//! Merge independently generated recitation data after Sefaria text generation.

use anyhow::{Context, Result, bail, ensure};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path};

use crate::models::{Perek, RecordingTimeFrame, Sefer};

fn spoken_words(perek: &Perek) -> Vec<(usize, usize, String)> {
    perek
        .pesukim
        .iter()
        .enumerate()
        .flat_map(|(p, verse)| {
            verse
                .segments
                .iter()
                .enumerate()
                .filter_map(move |(s, segment)| {
                    let value = segment.value.as_deref()?;
                    (segment.segment_type == "qri"
                        && value.chars().any(|c| ('א'..='ת').contains(&c)))
                    .then(|| (p + 1, s + 1, value.to_owned()))
                })
        })
        .collect()
}

fn text_hash(words: &[(usize, usize, String)]) -> String {
    let text = words
        .iter()
        .map(|(p, s, text)| format!("{p}:{s}:{text}"))
        .collect::<Vec<_>>()
        .join("\n");
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn timestamp(ms: i64) -> String {
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

fn merge_perek(perek: &mut Perek, db: &Connection) -> Result<bool> {
    let mut statement = db.prepare("SELECT audio_url,audio_sha256,text_sha256,duration_ms,alignment_status,provenance_json FROM recitation_track WHERE perek_id=?1")?;
    let mut rows = statement.query([perek.perek_id])?;
    let Some(row) = rows.next()? else {
        return Ok(false);
    };
    let url: String = row.get(0)?;
    let audio_sha: String = row.get(1)?;
    let text_sha: String = row.get(2)?;
    let duration: i64 = row.get(3)?;
    let status: String = row.get(4)?;
    let provenance: String = row.get(5)?;
    ensure!(
        matches!(status.as_str(), "pending" | "needs_review" | "ready"),
        "Invalid recitation status"
    );
    ensure!(duration > 0, "Invalid recording duration");
    let words = spoken_words(perek);
    ensure!(
        text_hash(&words) == text_sha,
        "Perek {}: canonical text changed; realign before publishing recitation",
        perek.perek_id
    );
    let mut query = db.prepare("SELECT pasuk,segment,start_ms,end_ms FROM recitation_word WHERE perek_id=?1 ORDER BY pasuk,segment")?;
    let timings = query
        .query_map([perek.perek_id], |r| {
            Ok((
                r.get::<_, u32>(0)? as usize,
                r.get::<_, u32>(1)? as usize,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if status == "ready" {
        ensure!(
            words.len() == timings.len(),
            "Perek {}: incomplete recitation word coverage",
            perek.perek_id
        );
        let mut previous_end = 0;
        for ((p, s, _), (rp, rs, start, end)) in words.iter().zip(&timings) {
            ensure!(
                (p, s) == (rp, rs) && *start >= previous_end && end > start && *end <= duration,
                "Perek {}: invalid canonical word identity or timing",
                perek.perek_id
            );
            previous_end = *end;
        }
    } else {
        ensure!(
            timings.is_empty(),
            "Unapproved timings must remain in the processing cache"
        );
    }
    let mut metadata: Value = serde_json::from_str(&provenance)?;
    let object = metadata
        .as_object_mut()
        .context("Invalid recitation provenance")?;
    object.extend(
        json!({"version":1,"audioUrl":url,"audioSha256":audio_sha,"textSha256":text_sha,
        "durationMs":duration,"alignmentStatus":status})
        .as_object()
        .unwrap()
        .clone(),
    );
    for (p, s, _) in &words {
        perek.pesukim[p - 1].segments[s - 1].recording_time_frame = Some(RecordingTimeFrame {
            from: "00:00:00".into(),
            to: "00:00:00".into(),
        });
    }
    for (p, s, start, end) in timings {
        perek.pesukim[p - 1].segments[s - 1].recording_time_frame = Some(RecordingTimeFrame {
            from: timestamp(start),
            to: timestamp(end),
        });
    }
    perek.recitation = Some(metadata);
    Ok(true)
}

/// The intermediate DB is independent of Sefaria. A mismatch aborts before any output is written.
pub fn merge(sefarim: &mut [Sefer], path: &Path) -> Result<()> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Cannot read recitation intermediate DB {}", path.display()))?;
    ensure!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))? == 3,
        "Unsupported recitation intermediate DB version"
    );
    let mut seen = HashSet::new();
    for sefer in sefarim {
        let perakim = sefer.perakim.iter_mut().flatten().chain(
            sefer
                .additionals
                .iter_mut()
                .flatten()
                .flat_map(|part| part.perakim.iter_mut()),
        );
        for perek in perakim {
            if merge_perek(perek, &db)? {
                seen.insert(perek.perek_id);
            }
        }
    }
    let mut statement = db.prepare("SELECT perek_id FROM recitation_track")?;
    for row in statement.query_map([], |r| r.get::<_, i32>(0))? {
        let id = row?;
        if !seen.contains(&id) {
            bail!("Recitation chapter {id} is absent from Sefaria output");
        }
    }
    println!(
        "Merged {} recitation tracks into canonical perakim",
        seen.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paths() -> (std::path::PathBuf, std::path::PathBuf) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
        (
            root.join("web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"),
            root.join("data/recitation/recitation.sqlite"),
        )
    }
    #[test]
    fn regeneration_restores_approved_timings_and_metadata_without_changing_text() {
        let (json_path, db_path) = paths();
        let mut books: Vec<Sefer> =
            serde_json::from_str(&std::fs::read_to_string(json_path).unwrap()).unwrap();
        for book in &mut books {
            for perek in book.perakim.iter_mut().flatten().chain(
                book.additionals
                    .iter_mut()
                    .flatten()
                    .flat_map(|p| p.perakim.iter_mut()),
            ) {
                perek.recitation = None;
                for verse in &mut perek.pesukim {
                    for segment in &mut verse.segments {
                        if segment.segment_type == "qri" {
                            segment.recording_time_frame = Some(RecordingTimeFrame {
                                from: "00:00:00".into(),
                                to: "00:00:00".into(),
                            });
                        }
                    }
                }
            }
        }
        merge(&mut books, &db_path).unwrap();
        let esther = books
            .iter()
            .find(|s| s.name == "אסתר")
            .unwrap()
            .perakim
            .as_ref()
            .unwrap()
            .last()
            .unwrap();
        assert_eq!(
            esther.recitation.as_ref().unwrap()["alignmentStatus"],
            "ready"
        );
        assert_eq!(spoken_words(esther).len(), 46);
        assert_eq!(
            esther.pesukim[0].segments[0]
                .recording_time_frame
                .as_ref()
                .unwrap()
                .from,
            "00:00:00.641"
        );
        let first = serde_json::to_string(&books).unwrap();
        merge(&mut books, &db_path).unwrap();
        assert_eq!(first, serde_json::to_string(&books).unwrap());
    }
    #[test]
    fn changed_canonical_word_rejects_stale_alignment() {
        let (json_path, db_path) = paths();
        let mut books: Vec<Sefer> =
            serde_json::from_str(&std::fs::read_to_string(json_path).unwrap()).unwrap();
        books[0].perakim.as_mut().unwrap()[0].pesukim[0].segments[0].value = Some("שונה".into());
        assert!(
            merge(&mut books, &db_path)
                .unwrap_err()
                .to_string()
                .contains("canonical text changed")
        );
    }
}
