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
        (1, _) => 1,     // בראשית: 50 chapters
        (2, _) => 51,    // שמות: 40
        (3, _) => 91,    // ויקרא: 27
        (4, _) => 118,   // במדבר: 36
        (5, _) => 154,   // דברים: 34
        // Nevi'im Rishonim
        (6, _) => 188,   // יהושע: 24
        (7, _) => 212,   // שופטים: 21
        (8, Some(2)) => 264, // שמואל ב: 24 chapters
        (8, _) => 233,       // שמואל א (or all of שמואל): 31 chapters
        (9, Some(2)) => 310, // מלכים ב: 25 chapters
        (9, _) => 288,       // מלכים א (or all of מלכים): 22 chapters
        // Nevi'im Acharonim
        (10, _) => 335,  // ישעיהו: 66
        (11, _) => 401,  // ירמיהו: 52
        (12, _) => 453,  // יחזקאל: 48
        // Trei Asar
        (13, _) => 501,  // הושע: 14
        (14, _) => 515,  // יואל: 4
        (15, _) => 519,  // עמוס: 9
        (16, _) => 528,  // עובדיה: 1
        (17, _) => 529,  // יונה: 4
        (18, _) => 533,  // מיכה: 7
        (19, _) => 540,  // נחום: 3
        (20, _) => 543,  // חבקוק: 3
        (21, _) => 546,  // צפניה: 3
        (22, _) => 549,  // חגי: 2
        (23, _) => 551,  // זכריה: 14
        (24, _) => 565,  // מלאכי: 3
        // Ketuvim
        (25, _) => 568,  // תהילים: 150
        (26, _) => 718,  // משלי: 31
        (27, _) => 749,  // איוב: 42
        // Megillot
        (28, _) => 791,  // שיר השירים: 8
        (29, _) => 799,  // רות: 4
        (30, _) => 803,  // איכה: 5
        (31, _) => 808,  // קהלת: 12
        (32, _) => 820,  // אסתר: 10
        // Late Ketuvim
        (33, _) => 830,      // דניאל: 12
        (34, Some(50)) => 852, // נחמיה: 13 chapters
        (34, _) => 842,       // עזרא (or all of עזרא/נחמיה): 10 chapters
        (35, Some(2)) => 894,  // דברי הימים ב: 36 chapters
        (35, _) => 865,        // דברי הימים א (or all): 29 chapters
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_total_929() {
        // Chapter counts per sefer/split
        let sefer_chapters: &[(i64, Option<i64>, i64)] = &[
            (1, None, 50), (2, None, 40), (3, None, 27), (4, None, 36), (5, None, 34),
            (6, None, 24), (7, None, 21),
            (8, Some(1), 31), (8, Some(2), 24),
            (9, Some(1), 22), (9, Some(2), 25),
            (10, None, 66), (11, None, 52), (12, None, 48),
            (13, None, 14), (14, None, 4), (15, None, 9), (16, None, 1),
            (17, None, 4), (18, None, 7), (19, None, 3), (20, None, 3),
            (21, None, 3), (22, None, 2), (23, None, 14), (24, None, 3),
            (25, None, 150), (26, None, 31), (27, None, 42),
            (28, None, 8), (29, None, 4), (30, None, 5), (31, None, 12), (32, None, 10),
            (33, None, 12),
            (34, Some(70), 10), (34, Some(50), 13),
            (35, Some(1), 29), (35, Some(2), 36),
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
}
