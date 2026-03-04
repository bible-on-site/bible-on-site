//! Match stage: Filter the `index` collection for Tanakh commentaries (perushim).
//!
//! This stage filters for documents in the "Tanakh" category while excluding:
//! - The 39 Tanakh books themselves (they are the base text, not commentaries)
//! - Works with Haskalah/Reform connections
//! - Modern English-language works (not traditional Hebrew perushim)
//! - Works that are not verse-by-verse commentaries on Tanakh
//! - Other titles excluded for reasons that need clarification (marked with TODO)

use bson::{Document, doc};

/// The 39 Tanakh books — excluded because they ARE the base biblical text, not commentaries.
const TANAKH_BOOKS: &[&str] = &[
    // Torah
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    // Nevi'im Rishonim (Former Prophets)
    "Joshua",
    "Judges",
    "I Samuel",
    "II Samuel",
    "I Kings",
    "II Kings",
    // Nevi'im Acharonim (Latter Prophets) — Major
    "Isaiah",
    "Jeremiah",
    "Ezekiel",
    // Trei Asar (Twelve Minor Prophets)
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
    // Ketuvim (Writings)
    "Psalms",
    "Proverbs",
    "Job",
    // Five Megillot
    "Song of Songs",
    "Ruth",
    "Lamentations",
    "Ecclesiastes",
    "Esther",
    // Ketuvim — Other
    "Daniel",
    "Ezra",
    "Nehemiah",
    "I Chronicles",
    "II Chronicles",
];

/// Works with Haskalah (Jewish Enlightenment) connections.
const HASKALAH_EXCLUDED: &[&str] = &[
    // Shadal (Samuel David Luzzatto, 1800–1865) — prominent figure of the Italian Haskalah
    "Shadal on Genesis",
    "Shadal on Exodus",
    "Shadal on Leviticus",
    "Shadal on Numbers",
    "Shadal on Deuteronomy",
    // Shadal on Isaiah was missed in the original exclusion
    "Shadal on Isaiah",
    // Yashar (Isaac Samuel Reggio, 1784–1855) — Italian Haskalah figure
    "Reggio on Torah",
    // Em LaMikra (Elijah Benamozegh, 1823–1900) — Italian rabbi with non-traditional methodology
    "Em LaMikra",
    // Ohev Ger — Shadal's commentary on Targum Onkelos
    "Ohev Ger",
];

/// Modern English-language works — not traditional Hebrew perushim.
const MODERN_ENGLISH_EXCLUDED: &[&str] = &[
    "Footnotes to Kohelet by Bruce Heitler",
    "Depths of Yonah",
    "From David to Destruction",
    "JPS 1985 Footnotes", // JPS (Jewish Publication Society) — Conservative movement publication
    "Moses; A Human Life",
    "Redeeming Relevance; Genesis",
    "Redeeming Relevance; Exodus",
    "Redeeming Relevance; Numbers",
    "Redeeming Relevance; Deuteronomy",
    // The Five Books of Moses / The Early Prophets (Everett Fox) — modern English translation
    "The Five Books of Moses, by Everett Fox",
    "The Early Prophets, by Everett Fox",
    // Covenant and Conversation series (Rabbi Jonathan Sacks) — modern English essays
    "Covenant and Conversation; Genesis; The Book of the Beginnings",
    "Covenant and Conversation; Exodus; The Book of Redemption",
    "Covenant and Conversation; Leviticus; The Book of Holiness",
    "Covenant and Conversation; Numbers; The Wilderness Years",
    "Covenant and Conversation; Deuteronomy; Renewal of the Sinai Covenant",
    "Judaism's Life Changing Ideas; A Weekly Reading of the Jewish Bible",
    "Essays in Ethics; A Weekly Reading of the Jewish Bible",
    "I Believe; A Weekly Reading of the Jewish Bible",
    "Studies in Spirituality; A Weekly Reading of the Jewish Bible",
    "Lessons in Leadership; A Weekly Reading of the Jewish Bible",
    // Tribal Lands (Tamar Weissman) — modern academic work
    "Tribal Lands",
];

/// Works that are not verse-by-verse commentaries on Tanakh text.
const NOT_PERUSIM: &[&str] = &[
    "Sefer Yesodei HaTorah", // Rambam's halachic work (Mishneh Torah), not a Tanakh commentary
    "Malbim Ayelet HaShachar", // Methodological introduction to Malbim's commentary, not a perush
];

/// Academic / non-traditional works — not from the Orthodox tradition.
const ACADEMIC_EXCLUDED: &[&str] = &[
    // Cassuto (Umberto Cassuto, 1883–1951) — academic Bible scholar
    "Cassuto on Genesis",
    "Cassuto on Exodus",
    // Karati Bekhol Lev (Michal Tikochinsky) — modern non-rabbinic work
    "Karati Bekhol Lev",
    // Sefer Daniel; Opportunity in Exile / Megillat Ruth; From Chaos to Kingship (Chaim Jachter) —
    // modern English works
    "Sefer Daniel; Opportunity in Exile",
    "Megillat Ruth; From Chaos to Kingship",
];

// TODO: Clarify exclusion reason for each of these titles
const UNCLEAR_EXCLUSIONS: &[&str] = &[
    "Baal HaTurim on Genesis",
    "Immanuel of Rome on Esther",
    "Targum Neofiti",
    "Chibbah Yeteirah on Torah",
    "Sepher Torat Elohim on Genesis",
    "Ish Kilvavo; on Samuel",
    "MeAvur HaAretz; on Joshua",
    "Ish Leshivto; on Judges",
    "Chatam Sofer on Torah",
    "Aderet Eliyahu (Rabbi Yosef Chaim)",
    "Nachal Sorek",
    "Mashmia Yeshuah",
    "Paaneach Raza",
    "Chanukat HaTorah",
    "Beit HaLevi on Torah",
    "Ba'alei Brit Avram",
    "Meshekh Chokhmah",
    "Tzaverei Shalal",
    "Rosh David",
    "Rabbeinu Bahya",
    "Malbim on Leviticus",
    "Imrei Yosher on Ruth",
    "Avi Ezer",
    "Penei David",
    "Rav Hirsch on Torah",
    "Tevat Gome",
    "Saadia Gaon on Exodus",
    "Saadia Gaon on Numbers",
    "Saadia Gaon on Deuteronomy",
];

/// Returns the `$match` stage document for filtering the `index` collection.
///
/// Matches documents where:
/// - `categories` contains "Tanakh"
/// - `title` is not in the exclusion list
pub fn build() -> Document {
    let excluded: Vec<&str> = TANAKH_BOOKS
        .iter()
        .chain(HASKALAH_EXCLUDED.iter())
        .chain(MODERN_ENGLISH_EXCLUDED.iter())
        .chain(NOT_PERUSIM.iter())
        .chain(ACADEMIC_EXCLUDED.iter())
        .chain(UNCLEAR_EXCLUSIONS.iter())
        .copied()
        .collect();

    doc! {
        "$match": {
            "categories": "Tanakh",
            "title": {
                "$nin": excluded
            }
        }
    }
}
