//! Mapping from (sefer, additional) to the 929 global perek_id numbering.
//!
//! The 929 project numbers every perek in Tanakh sequentially (1–929).
//! This module provides the mapping from the pipeline's (sefer, additional)
//! to the first perek_id for that sefer/split.
//!
//! For split books (שמואל, מלכים, עזרא/נחמיה, דברי הימים), the `additional`
//! field distinguishes the parts. When `additional` is None, the perek_id
//! starts at the first part.

/// Returns the first perek_id (929 global) for a given (sefer, additional) pair.
///
/// # Arguments
/// * `sefer` — Canonical sefer number (1–35)
/// * `additional` — Split book part indicator, or None for unsplit books
///
/// # Returns
/// The first perek_id for this sefer/part, or 0 if sefer is unknown.
pub fn first_perek_id(sefer: i64, additional: Option<i64>) -> i64 {
    match (sefer, additional) {
        // Torah
        (1, _) => 1,   // בראשית: 50 chapters
        (2, _) => 51,  // שמות: 40
        (3, _) => 91,  // ויקרא: 27
        (4, _) => 118, // במדבר: 36
        (5, _) => 154, // דברים: 34
        // Nevi'im Rishonim
        (6, _) => 188,       // יהושע: 24
        (7, _) => 212,       // שופטים: 21
        (8, Some(2)) => 264, // שמואל ב: 24 chapters
        (8, _) => 233,       // שמואל א (or all of שמואל): 31 chapters
        (9, Some(2)) => 310, // מלכים ב: 25 chapters
        (9, _) => 288,       // מלכים א (or all of מלכים): 22 chapters
        // Nevi'im Acharonim
        (10, _) => 335, // ישעיהו: 66
        (11, _) => 401, // ירמיהו: 52
        (12, _) => 453, // יחזקאל: 48
        // Trei Asar
        (13, _) => 501, // הושע: 14
        (14, _) => 515, // יואל: 4
        (15, _) => 519, // עמוס: 9
        (16, _) => 528, // עובדיה: 1
        (17, _) => 529, // יונה: 4
        (18, _) => 533, // מיכה: 7
        (19, _) => 540, // נחום: 3
        (20, _) => 543, // חבקוק: 3
        (21, _) => 546, // צפניה: 3
        (22, _) => 549, // חגי: 2
        (23, _) => 551, // זכריה: 14
        (24, _) => 565, // מלאכי: 3
        // Ketuvim
        (25, _) => 568, // תהילים: 150
        (26, _) => 718, // משלי: 31
        (27, _) => 749, // איוב: 42
        // Megillot
        (28, _) => 791, // שיר השירים: 8
        (29, _) => 799, // רות: 4
        (30, _) => 803, // איכה: 5
        (31, _) => 808, // קהלת: 12
        (32, _) => 820, // אסתר: 10
        // Late Ketuvim
        (33, _) => 830,        // דניאל: 12
        (34, Some(50)) => 852, // נחמיה: 13 chapters
        (34, _) => 842,        // עזרא (or all of עזרא/נחמיה): 10 chapters
        (35, Some(2)) => 894,  // דברי הימים ב: 36 chapters
        (35, _) => 865,        // דברי הימים א (or all): 29 chapters
        _ => 0,
    }
}

/// Maps an English Sefaria node key (e.g., "Genesis") to a (sefer, additional) pair.
///
/// Used for multi-book complex schemas where each book is a separate node
/// in a single index entry (e.g., HaKtav VeHaKabalah).
pub fn english_node_key_to_sefer(key: &str) -> Option<(i64, Option<i64>)> {
    match key {
        // Torah — standard English names
        "Genesis" | "Bereshit" => Some((1, None)),
        "Exodus" | "Shemot" => Some((2, None)),
        "Leviticus" | "Vayikra" => Some((3, None)),
        "Numbers" | "Bamidbar" => Some((4, None)),
        "Deuteronomy" | "Devarim" => Some((5, None)),
        // Nevi'im Rishonim
        "Joshua" => Some((6, None)),
        "Judges" => Some((7, None)),
        "I Samuel" => Some((8, Some(1))),
        "II Samuel" => Some((8, Some(2))),
        "I Kings" => Some((9, Some(1))),
        "II Kings" => Some((9, Some(2))),
        // Nevi'im Acharonim
        "Isaiah" => Some((10, None)),
        "Jeremiah" => Some((11, None)),
        "Ezekiel" => Some((12, None)),
        // Trei Asar
        "Hosea" => Some((13, None)),
        "Joel" => Some((14, None)),
        "Amos" => Some((15, None)),
        "Obadiah" => Some((16, None)),
        "Jonah" => Some((17, None)),
        "Micah" => Some((18, None)),
        "Nahum" => Some((19, None)),
        "Habakkuk" => Some((20, None)),
        "Zephaniah" => Some((21, None)),
        "Haggai" => Some((22, None)),
        "Zechariah" => Some((23, None)),
        "Malachi" => Some((24, None)),
        // Ketuvim
        "Psalms" => Some((25, None)),
        "Proverbs" => Some((26, None)),
        "Job" => Some((27, None)),
        // Megillot — includes "Book of X" variants (e.g. Tzafnat Pa'neach)
        "Song of Songs" => Some((28, None)),
        "Ruth" | "Book of Ruth" => Some((29, None)),
        "Lamentations" => Some((30, None)),
        "Ecclesiastes" => Some((31, None)),
        "Esther" => Some((32, None)),
        // Late Ketuvim
        "Daniel" => Some((33, None)),
        "Ezra" => Some((34, Some(70))),
        "Nehemiah" => Some((34, Some(50))),
        "I Chronicles" => Some((35, Some(1))),
        "II Chronicles" => Some((35, Some(2))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_total_929() {
        // Chapter counts per sefer/split
        let sefer_chapters: &[(i64, Option<i64>, i64)] = &[
            (1, None, 50),
            (2, None, 40),
            (3, None, 27),
            (4, None, 36),
            (5, None, 34),
            (6, None, 24),
            (7, None, 21),
            (8, Some(1), 31),
            (8, Some(2), 24),
            (9, Some(1), 22),
            (9, Some(2), 25),
            (10, None, 66),
            (11, None, 52),
            (12, None, 48),
            (13, None, 14),
            (14, None, 4),
            (15, None, 9),
            (16, None, 1),
            (17, None, 4),
            (18, None, 7),
            (19, None, 3),
            (20, None, 3),
            (21, None, 3),
            (22, None, 2),
            (23, None, 14),
            (24, None, 3),
            (25, None, 150),
            (26, None, 31),
            (27, None, 42),
            (28, None, 8),
            (29, None, 4),
            (30, None, 5),
            (31, None, 12),
            (32, None, 10),
            (33, None, 12),
            (34, Some(70), 10),
            (34, Some(50), 13),
            (35, Some(1), 29),
            (35, Some(2), 36),
        ];

        // Verify each sefer's first perek_id is correct
        let mut expected_start = 1i64;
        for &(sefer, additional, chapters) in sefer_chapters {
            let actual_start = first_perek_id(sefer, additional);
            assert_eq!(
                actual_start, expected_start,
                "sefer={}, additional={:?}: expected start={}, got={}",
                sefer, additional, expected_start, actual_start
            );
            expected_start += chapters;
        }

        // Total should be 929
        assert_eq!(expected_start - 1, 929);
    }

    #[test]
    fn test_english_node_key_maps_all_standard_books() {
        // All standard English keys should map to valid (sefer, additional)
        let standard_keys = vec![
            ("Genesis", 1),
            ("Exodus", 2),
            ("Leviticus", 3),
            ("Numbers", 4),
            ("Deuteronomy", 5),
            ("Joshua", 6),
            ("Judges", 7),
            ("Isaiah", 10),
            ("Jeremiah", 11),
            ("Ezekiel", 12),
            ("Psalms", 25),
            ("Proverbs", 26),
            ("Job", 27),
            ("Song of Songs", 28),
            ("Ruth", 29),
            ("Lamentations", 30),
            ("Ecclesiastes", 31),
            ("Esther", 32),
            ("Daniel", 33),
        ];

        for (key, expected_sefer) in standard_keys {
            let result = english_node_key_to_sefer(key);
            assert!(result.is_some(), "Key '{}' should map to a sefer", key);
            let (sefer, _) = result.unwrap();
            assert_eq!(
                sefer, expected_sefer,
                "Key '{}' should map to sefer {}",
                key, expected_sefer
            );
        }
    }

    #[test]
    fn test_english_node_key_transliterated_variants() {
        // Rabbeinu Bahya uses transliterated Hebrew names
        assert_eq!(english_node_key_to_sefer("Bereshit"), Some((1, None)));
        assert_eq!(english_node_key_to_sefer("Shemot"), Some((2, None)));
        assert_eq!(english_node_key_to_sefer("Vayikra"), Some((3, None)));
        assert_eq!(english_node_key_to_sefer("Bamidbar"), Some((4, None)));
        assert_eq!(english_node_key_to_sefer("Devarim"), Some((5, None)));
    }

    #[test]
    fn test_english_node_key_book_of_ruth() {
        // Tzafnat Pa'neach uses "Book of Ruth"
        assert_eq!(english_node_key_to_sefer("Book of Ruth"), Some((29, None)));
    }

    #[test]
    fn test_english_node_key_non_book_returns_none() {
        // Introduction, Postscript, etc. should not map
        assert_eq!(english_node_key_to_sefer("Introduction"), None);
        assert_eq!(english_node_key_to_sefer("Postscript"), None);
        assert_eq!(english_node_key_to_sefer("Haftarot"), None);
        assert_eq!(english_node_key_to_sefer("default"), None);
        assert_eq!(english_node_key_to_sefer(""), None);
    }

    #[test]
    fn test_english_node_key_resolves_to_valid_perek_id() {
        // Every mapped key should produce a valid (non-zero) first_perek_id
        let all_keys = vec![
            "Genesis",
            "Exodus",
            "Leviticus",
            "Numbers",
            "Deuteronomy",
            "Joshua",
            "Judges",
            "I Samuel",
            "II Samuel",
            "I Kings",
            "II Kings",
            "Isaiah",
            "Jeremiah",
            "Ezekiel",
            "Hosea",
            "Joel",
            "Amos",
            "Obadiah",
            "Jonah",
            "Micah",
            "Nahum",
            "Habakkuk",
            "Zephaniah",
            "Haggai",
            "Zechariah",
            "Malachi",
            "Psalms",
            "Proverbs",
            "Job",
            "Song of Songs",
            "Ruth",
            "Book of Ruth",
            "Lamentations",
            "Ecclesiastes",
            "Esther",
            "Daniel",
            "Ezra",
            "Nehemiah",
            "I Chronicles",
            "II Chronicles",
            // Transliterated variants
            "Bereshit",
            "Shemot",
            "Vayikra",
            "Bamidbar",
            "Devarim",
        ];
        for key in all_keys {
            let (sefer, additional) = english_node_key_to_sefer(key)
                .unwrap_or_else(|| panic!("Key '{}' should map to a sefer", key));
            let perek_id = first_perek_id(sefer, additional);
            assert!(
                perek_id > 0,
                "Key '{}' mapped to sefer={}, additional={:?} but first_perek_id is 0",
                key,
                sefer,
                additional
            );
        }
    }
}
