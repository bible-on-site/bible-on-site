//! Preserve published commentary identities when a refreshed source changes.
//!
//! Sefaria's available works and their alphabetical order can change between
//! dumps. Public commentary URLs and stored preferences use the published
//! catalog's IDs, so a new extraction must retain those identities. Missing
//! works and chapters retain their supplied baseline notes.

use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, ensure};

use super::extract::{Extracted, Note};

/// Apply a published catalog's identities to a fresh extraction.
///
/// `baseline_catalog.notes` is intentionally ignored: the caller supplies
/// fallback notes separately, normally decoding only absent work/chapter pairs from the
/// delivered notes pack. Those notes use the baseline catalog's IDs; fresh
/// notes use the fresh extraction's IDs. Fresh notes replace a baseline
/// work's chapter completely when at least one fresh note exists there;
/// fallback notes retain every other published work/chapter pair.
///
/// Existing rows are returned in ID order. New authors and works receive IDs
/// after the respective baseline maximum, in their fresh extraction order.
/// A new work needs at least one fresh note before publication; its otherwise
/// unused new author is omitted too. Published works remain in the catalog
/// even when the current extraction supplies no notes for them, retaining
/// their baseline chapters in that case.
pub fn preserve(
    fresh: Extracted,
    baseline_catalog: &Extracted,
    fallback_notes: Vec<Note>,
) -> Result<Extracted> {
    validate_catalog(baseline_catalog, "baseline")?;
    validate_catalog(&fresh, "fresh")?;

    let published_work_names: HashSet<&str> = baseline_catalog
        .perushim
        .iter()
        .map(|work| work.name.as_str())
        .collect();
    let works_with_fresh_notes: HashSet<i64> =
        fresh.notes.iter().map(|note| note.perush_id).collect();
    let needed_fresh_authors: HashSet<i64> = fresh
        .perushim
        .iter()
        .filter(|work| {
            published_work_names.contains(work.name.as_str())
                || works_with_fresh_notes.contains(&work.id)
        })
        .map(|work| work.parshan_id)
        .collect();

    let mut parshanim = baseline_catalog.parshanim.clone();
    parshanim.sort_by_key(|author| author.id);
    let mut author_positions: HashMap<String, usize> = parshanim
        .iter()
        .enumerate()
        .map(|(index, author)| (author.name.clone(), index))
        .collect();
    let mut next_author_id = parshanim.last().map_or(0, |author| author.id);
    let mut fresh_author_ids = HashMap::new();
    for mut author in fresh.parshanim {
        let source_id = author.id;
        if let Some(&index) = author_positions.get(&author.name) {
            author.id = parshanim[index].id;
            fresh_author_ids.insert(source_id, author.id);
            parshanim[index] = author;
        } else if needed_fresh_authors.contains(&source_id) {
            next_author_id = next_author_id
                .checked_add(1)
                .context("baseline author IDs cannot accommodate another author")?;
            author.id = next_author_id;
            fresh_author_ids.insert(source_id, author.id);
            author_positions.insert(author.name.clone(), parshanim.len());
            parshanim.push(author);
        }
    }

    let mut perushim = baseline_catalog.perushim.clone();
    perushim.sort_by_key(|work| work.id);
    let mut work_positions: HashMap<String, usize> = perushim
        .iter()
        .enumerate()
        .map(|(index, work)| (work.name.clone(), index))
        .collect();
    let mut next_work_id = perushim.last().map_or(0, |work| work.id);
    let mut fresh_work_ids = HashMap::new();
    for mut work in fresh.perushim {
        let source_id = work.id;
        if !published_work_names.contains(work.name.as_str())
            && !works_with_fresh_notes.contains(&source_id)
        {
            continue;
        }
        work.parshan_id = *fresh_author_ids
            .get(&work.parshan_id)
            .with_context(|| format!("fresh work {} has an unmapped author", work.name))?;
        if let Some(&index) = work_positions.get(&work.name) {
            work.id = perushim[index].id;
            fresh_work_ids.insert(source_id, work.id);
            perushim[index] = work;
        } else {
            next_work_id = next_work_id
                .checked_add(1)
                .context("baseline work IDs cannot accommodate another work")?;
            work.id = next_work_id;
            fresh_work_ids.insert(source_id, work.id);
            work_positions.insert(work.name.clone(), perushim.len());
            perushim.push(work);
        }
    }

    let baseline_work_names: HashMap<i64, &str> = baseline_catalog
        .perushim
        .iter()
        .map(|work| (work.id, work.name.as_str()))
        .collect();
    let mut notes = Vec::with_capacity(fresh.notes.len() + fallback_notes.len());
    let mut note_keys = HashSet::new();
    let mut fresh_chapters = HashSet::new();
    for mut note in fresh.notes {
        note.perush_id = *fresh_work_ids
            .get(&note.perush_id)
            .with_context(|| format!("fresh note refers to unknown work ID {}", note.perush_id))?;
        fresh_chapters.insert((note.perush_id, note.perek_id));
        append_note(&mut notes, &mut note_keys, note, "fresh")?;
    }
    for note in fallback_notes {
        baseline_work_names.get(&note.perush_id).with_context(|| {
            format!(
                "fallback note refers to unknown baseline work ID {}",
                note.perush_id
            )
        })?;
        if !fresh_chapters.contains(&(note.perush_id, note.perek_id)) {
            append_note(&mut notes, &mut note_keys, note, "fallback")?;
        }
    }

    Ok(Extracted {
        parshanim,
        perushim,
        notes,
    })
}

/// Validate catalog identities before matching names or following foreign keys.
fn validate_catalog(catalog: &Extracted, label: &str) -> Result<()> {
    let mut author_ids = HashSet::new();
    let mut author_names = HashSet::new();
    for author in &catalog.parshanim {
        ensure!(author.id > 0, "{label} author ID must be positive");
        ensure!(
            !author.name.trim().is_empty(),
            "{label} author name must not be empty"
        );
        ensure!(
            author_ids.insert(author.id),
            "{label} has duplicate author ID {}",
            author.id
        );
        ensure!(
            author_names.insert(author.name.as_str()),
            "{label} has duplicate author name {}",
            author.name
        );
    }
    let mut work_ids = HashSet::new();
    let mut work_names = HashSet::new();
    for work in &catalog.perushim {
        ensure!(work.id > 0, "{label} work ID must be positive");
        ensure!(
            !work.name.trim().is_empty(),
            "{label} work name must not be empty"
        );
        ensure!(
            work_ids.insert(work.id),
            "{label} has duplicate work ID {}",
            work.id
        );
        ensure!(
            work_names.insert(work.name.as_str()),
            "{label} has duplicate work name {}",
            work.name
        );
        ensure!(
            author_ids.contains(&work.parshan_id),
            "{label} work {} refers to unknown author ID {}",
            work.name,
            work.parshan_id
        );
    }
    Ok(())
}

fn append_note(
    notes: &mut Vec<Note>,
    keys: &mut HashSet<(i64, i64, i64, i64)>,
    note: Note,
    source: &str,
) -> Result<()> {
    ensure!(
        (1..=929).contains(&note.perek_id) && note.pasuk > 0 && note.note_idx >= 0,
        "{source} note has invalid chapter, verse, or note index"
    );
    let key = (note.perush_id, note.perek_id, note.pasuk, note.note_idx);
    ensure!(
        keys.insert(key),
        "{source} contains duplicate note identity {key:?}"
    );
    notes.push(note);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::extract::{Parshan, Perush};

    fn author(id: i64, name: &str) -> Parshan {
        Parshan {
            id,
            name: name.into(),
            birth_year: None,
            has_pic: false,
        }
    }

    fn work(id: i64, name: &str, parshan_id: i64) -> Perush {
        Perush {
            id,
            name: name.into(),
            parshan_id,
            comp_date: None,
            pub_date: None,
            priority: 0,
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

    fn baseline() -> Extracted {
        Extracted {
            // Deliberately noncontiguous and out of order: IDs, rather than
            // array positions or row counts, determine the published mapping.
            parshanim: vec![author(9, "absent author"), author(2, "known author")],
            perushim: vec![work(20, "absent work", 9), work(4, "known work", 2)],
            notes: vec![],
        }
    }

    #[test]
    fn preserves_published_ids_across_source_reordering_and_appends_after_maxima() {
        let mut fresh_author = author(7, "known author");
        fresh_author.birth_year = Some(1200);
        fresh_author.has_pic = true;
        let mut fresh_work = work(3, "known work", 7);
        fresh_work.comp_date = Some("1300".into());
        fresh_work.pub_date = Some("1500".into());
        fresh_work.priority = 1500;
        let fresh = Extracted {
            parshanim: vec![author(1, "new author"), fresh_author],
            perushim: vec![work(8, "new work", 1), fresh_work],
            notes: vec![note(8, "new commentary"), note(3, "fresh known commentary")],
        };
        let result = preserve(fresh, &baseline(), vec![note(20, "retained commentary")]).unwrap();

        assert_eq!(
            result
                .parshanim
                .iter()
                .map(|p| (p.id, p.name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (2, "known author"),
                (9, "absent author"),
                (10, "new author")
            ]
        );
        assert_eq!(result.parshanim[0].birth_year, Some(1200));
        assert!(result.parshanim[0].has_pic);
        assert_eq!(
            result
                .perushim
                .iter()
                .map(|p| (p.id, p.name.as_str(), p.parshan_id))
                .collect::<Vec<_>>(),
            vec![
                (4, "known work", 2),
                (20, "absent work", 9),
                (21, "new work", 10)
            ]
        );
        assert_eq!(result.perushim[0].comp_date.as_deref(), Some("1300"));
        assert_eq!(result.perushim[0].pub_date.as_deref(), Some("1500"));
        assert_eq!(result.perushim[0].priority, 1500);
        assert_eq!(
            result
                .notes
                .iter()
                .map(|n| (n.perush_id, n.note_content.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (21, "new commentary"),
                (4, "fresh known commentary"),
                (20, "retained commentary")
            ]
        );
    }

    #[test]
    fn fresh_chapters_replace_all_fallback_notes_including_stale_or_duplicate_rows() {
        let fresh = Extracted {
            parshanim: vec![author(1, "known author")],
            perushim: vec![work(1, "known work", 1)],
            notes: vec![note(1, "replacement")],
        };
        let result = preserve(
            fresh,
            &baseline(),
            vec![
                note(4, "old"),
                note(4, "duplicate old"),
                note(20, "missing work"),
            ],
        )
        .unwrap();
        assert_eq!(result.notes.len(), 2);
        assert_eq!(result.notes[0].perush_id, 4);
        assert_eq!(result.notes[0].note_content, "replacement");
        assert_eq!(result.notes[1].perush_id, 20);
    }

    #[test]
    fn published_work_without_fresh_notes_keeps_its_baseline_chapters() {
        let fresh = Extracted {
            parshanim: vec![author(1, "known author")],
            perushim: vec![work(1, "known work", 1)],
            notes: vec![],
        };
        let result = preserve(fresh, &baseline(), vec![note(4, "old")]).unwrap();
        assert_eq!(result.notes.len(), 1);
        assert_eq!(result.notes[0].perush_id, 4);
        assert_eq!(result.notes[0].note_content, "old");
        assert_eq!(result.perushim.len(), 2);
    }

    #[test]
    fn fresh_chapter_replaces_old_notes_while_another_published_chapter_survives() {
        let mut fresh_note = note(1, "fresh chapter two");
        fresh_note.perek_id = 2;
        let fresh = Extracted {
            parshanim: vec![author(1, "known author")],
            perushim: vec![work(1, "known work", 1)],
            notes: vec![fresh_note],
        };
        let mut old_chapter_two = note(4, "old chapter two");
        old_chapter_two.perek_id = 2;
        let mut another_old_note = old_chapter_two.clone();
        another_old_note.pasuk = 2;
        let result = preserve(
            fresh,
            &baseline(),
            vec![
                note(4, "retained chapter one"),
                old_chapter_two,
                another_old_note,
            ],
        )
        .unwrap();
        assert_eq!(
            result
                .notes
                .iter()
                .map(|n| (n.perush_id, n.perek_id, n.note_content.as_str()))
                .collect::<Vec<_>>(),
            vec![(4, 2, "fresh chapter two"), (4, 1, "retained chapter one"),]
        );
    }

    #[test]
    fn known_work_keeps_its_id_when_fresh_author_changes() {
        let fresh = Extracted {
            parshanim: vec![author(1, "new attribution")],
            perushim: vec![work(1, "known work", 1)],
            notes: vec![note(1, "fresh")],
        };
        let result = preserve(fresh, &baseline(), vec![]).unwrap();
        assert_eq!(result.perushim[0].id, 4);
        assert_eq!(result.perushim[0].parshan_id, 10);
        assert_eq!(result.parshanim[0].name, "known author");
        assert_eq!(result.parshanim[2].name, "new attribution");
    }

    #[test]
    fn empty_baseline_uses_fresh_order_without_reusing_arbitrary_source_ids() {
        let empty = Extracted {
            parshanim: vec![],
            perushim: vec![],
            notes: vec![],
        };
        let fresh = Extracted {
            parshanim: vec![author(90, "first"), author(4, "second")],
            perushim: vec![work(80, "first work", 4), work(3, "second work", 90)],
            notes: vec![note(3, "second work note"), note(80, "first work note")],
        };
        let result = preserve(fresh, &empty, vec![]).unwrap();
        assert_eq!(
            result
                .perushim
                .iter()
                .map(|p| (p.id, p.parshan_id))
                .collect::<Vec<_>>(),
            vec![(1, 2), (2, 1)]
        );
        assert_eq!(result.notes[0].perush_id, 2);
    }

    #[test]
    fn empty_new_work_and_its_orphan_author_do_not_receive_published_ids() {
        let fresh = Extracted {
            parshanim: vec![
                author(77, "empty new author"),
                author(4, "known author"),
                author(88, "included new author"),
            ],
            perushim: vec![
                work(1, "empty new work", 77),
                work(2, "known work", 4),
                work(3, "included new work", 88),
            ],
            notes: vec![note(3, "new commentary")],
        };
        let result = preserve(
            fresh,
            &baseline(),
            vec![
                note(4, "retained known work"),
                note(20, "retained absent work"),
            ],
        )
        .unwrap();
        assert_eq!(
            result
                .perushim
                .iter()
                .map(|p| (p.id, p.name.as_str(), p.parshan_id))
                .collect::<Vec<_>>(),
            vec![
                (4, "known work", 2),
                (20, "absent work", 9),
                (21, "included new work", 10),
            ]
        );
        assert_eq!(
            result
                .parshanim
                .iter()
                .map(|p| (p.id, p.name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (2, "known author"),
                (9, "absent author"),
                (10, "included new author"),
            ]
        );
        assert_eq!(
            result
                .notes
                .iter()
                .map(|n| (n.perush_id, n.note_content.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (21, "new commentary"),
                (4, "retained known work"),
                (20, "retained absent work"),
            ]
        );
    }

    #[test]
    fn duplicate_ids_and_names_in_either_catalog_are_ambiguous() {
        for baseline_is_invalid in [false, true] {
            for kind in 0..4 {
                let mut invalid = baseline();
                match kind {
                    0 => invalid.parshanim[1].id = invalid.parshanim[0].id,
                    1 => invalid.parshanim[1].name = invalid.parshanim[0].name.clone(),
                    2 => invalid.perushim[1].id = invalid.perushim[0].id,
                    _ => invalid.perushim[1].name = invalid.perushim[0].name.clone(),
                }
                let result = if baseline_is_invalid {
                    preserve(baseline(), &invalid, vec![])
                } else {
                    preserve(invalid, &baseline(), vec![])
                };
                assert!(
                    result.is_err(),
                    "baseline={baseline_is_invalid}, kind={kind}"
                );
            }
        }
    }

    #[test]
    fn unknown_author_or_note_work_mapping_is_rejected() {
        let mut fresh = baseline();
        fresh.perushim[0].parshan_id = 999;
        assert!(preserve(fresh, &baseline(), vec![]).is_err());

        let mut fresh = baseline();
        fresh.notes.push(note(999, "unknown fresh work"));
        assert!(preserve(fresh, &baseline(), vec![]).is_err());
        assert!(
            preserve(
                baseline(),
                &baseline(),
                vec![note(999, "unknown fallback work")]
            )
            .is_err()
        );
    }

    #[test]
    fn duplicate_selected_notes_are_rejected_instead_of_silently_discarded() {
        let mut fresh = baseline();
        fresh.notes = vec![note(4, "first"), note(4, "second")];
        assert!(preserve(fresh, &baseline(), vec![]).is_err());

        let empty = Extracted {
            parshanim: vec![],
            perushim: vec![],
            notes: vec![],
        };
        assert!(
            preserve(
                empty,
                &baseline(),
                vec![note(20, "first"), note(20, "second")]
            )
            .is_err()
        );
    }
}
