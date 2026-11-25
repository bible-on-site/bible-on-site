//! Embedded Tanach text data — generated from the pinned Sefaria dump at
//! build time (#3709).
//!
//! `build.rs` runs `scripts/extract-tanach-text.mjs` whenever the canonical
//! website corpus is on disk, so the generated `data/tanach-text.json` always
//! tracks it and never needs committing. The file is embedded via
//! `include_str!` as `{ corpus, perakim }`: `corpus` is the shared dump
//! version the website JSON and the bundled native SQLite are named after,
//! and `perakim` maps perekId (1-929) → { seferName, perekInSefer, header,
//! pesukim }.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

static TANACH_JSON: &str = include_str!("../data/tanach-text.json");

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerekData {
    pub sefer_name: String,
    pub perek_in_sefer: u32,
    pub header: String,
    pub pesukim: Vec<String>,
}

#[derive(Deserialize)]
struct TanachText {
    corpus: String,
    perakim: HashMap<String, PerekData>,
}

struct TanachData {
    corpus: String,
    perakim: HashMap<i32, PerekData>,
}

/// Lazily parsed embedded corpus and lookup table.
static TANACH: LazyLock<TanachData> = LazyLock::new(|| {
    let text: TanachText =
        serde_json::from_str(TANACH_JSON).expect("Failed to parse embedded tanach-text.json");
    let perakim = text
        .perakim
        .into_iter()
        .map(|(k, v)| {
            let id: i32 = k.parse().expect("Non-numeric perekId in tanach-text.json");
            (id, v)
        })
        .collect();
    TanachData {
        corpus: text.corpus,
        perakim,
    }
});

/// The shared corpus version stamp — the same `sefaria-dump-*` name stem the
/// website JSON and the app's bundled SQLite carry (#3709).
pub fn corpus_version() -> &'static str {
    &TANACH.corpus
}

/// Look up a perek by its global ID (1-929).
pub fn get_perek(perek_id: i32) -> Option<&'static PerekData> {
    TANACH.perakim.get(&perek_id)
}

/// Convert a 1-based perek number to Hebrew letters.
pub fn perek_to_hebrew(n: u32) -> String {
    if n == 0 {
        return String::new();
    }

    let hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
    let tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    let ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];

    let mut result = String::new();
    let mut remaining = n as usize;

    if remaining >= 100 {
        result.push_str(hundreds[remaining / 100]);
        remaining %= 100;
    }

    if remaining == 15 {
        result.push_str("טו");
    } else if remaining == 16 {
        result.push_str("טז");
    } else {
        if remaining >= 10 {
            result.push_str(tens[remaining / 10]);
            remaining %= 10;
        }
        if remaining > 0 {
            result.push_str(ones[remaining]);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpus_version_matches_native_bundle() {
        // The stamp must equal the app SQLite's name stem — both artifacts
        // derive from the same pinned dump (#3709).
        let raw = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../app/BibleOnSite/Resources/Raw");
        let stems: Vec<String> = std::fs::read_dir(&raw)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| {
                name.starts_with("sefaria-dump-") && name.ends_with(".tanah_view.sqlite")
            })
            .collect();
        assert_eq!(stems.len(), 1, "expected one bundled tanah_view SQLite");
        assert_eq!(
            corpus_version(),
            stems[0].trim_end_matches(".tanah_view.sqlite")
        );
    }

    #[test]
    fn repeat_verses_close_aicha_and_kohelet() {
        // איכה ה and קהלת יב end harshly; the penultimate pasuk repeats in
        // brackets, unpointed — replacing the hand-edited <small> markup that
        // renderers used to emit literally (#3709).
        let aicha = get_perek(807).expect("איכה ה must exist");
        let last = aicha.pesukim.last().unwrap();
        assert!(last.ends_with("עַד־מְאֹֽד׃ [השיבנו יהוה אליך ונשובה חדש ימינו כקדם]"));
        let kohelet = get_perek(819).expect("קהלת יב must exist");
        let last = kohelet.pesukim.last().unwrap();
        assert!(
            last.ends_with(
                "וְאִם־רָֽע׃ [סוף דבר הכל נשמע את־האלהים ירא ואת־מצותיו שמור כי־זה כל־האדם]"
            )
        );
        assert!(!last.contains('<'), "repeat note carries no markup");
    }

    #[test]
    fn lookup_bereshit_1() {
        let p = get_perek(1).expect("perek 1 must exist");
        assert_eq!(p.sefer_name, "בראשית");
        assert_eq!(p.perek_in_sefer, 1);
        assert_eq!(p.pesukim.len(), 31);
    }

    #[test]
    fn lookup_last_perek() {
        let p = get_perek(929).expect("perek 929 must exist");
        assert_eq!(p.sefer_name, "דברי הימים ב");
        assert_eq!(p.perek_in_sefer, 36);
    }

    #[test]
    fn lookup_out_of_range() {
        assert!(get_perek(0).is_none());
        assert!(get_perek(930).is_none());
    }

    #[test]
    fn hebrew_letters() {
        assert_eq!(perek_to_hebrew(1), "א");
        assert_eq!(perek_to_hebrew(15), "טו");
        assert_eq!(perek_to_hebrew(16), "טז");
        assert_eq!(perek_to_hebrew(119), "קיט");
    }
}
