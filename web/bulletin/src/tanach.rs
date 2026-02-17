//! Embedded Tanach text data — extracted from the Sefaria dump at build time.
//!
//! The JSON file `data/tanach-text.json` is embedded into the binary via
//! `include_str!`. It maps perekId (1-929) → { seferName, perekInSefer, header, pesukim }.
//!
//! To regenerate: `node scripts/extract-tanach-text.mjs`

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

/// Lazily parsed lookup: perekId → PerekData.
static PERAKIM: LazyLock<HashMap<i32, PerekData>> = LazyLock::new(|| {
    serde_json::from_str::<HashMap<String, PerekData>>(TANACH_JSON)
        .expect("Failed to parse embedded tanach-text.json")
        .into_iter()
        .map(|(k, v)| {
            let id: i32 = k.parse().expect("Non-numeric perekId in tanach-text.json");
            (id, v)
        })
        .collect()
});

/// Look up a perek by its global ID (1-929).
pub fn get_perek(perek_id: i32) -> Option<&'static PerekData> {
    PERAKIM.get(&perek_id)
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
