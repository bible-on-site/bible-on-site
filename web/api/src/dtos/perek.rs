use async_graphql::{ComplexObject, Context, Result, SimpleObject};

use crate::{providers::Database, services::articles_service};
use entities::perek::Model;

/// Convert a number to Hebrew letters (gematry) with gershayim.
/// Supports numbers 1-999.
fn number_to_hebrew(n: i32) -> String {
    if n <= 0 || n > 999 {
        return n.to_string();
    }

    let ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
    let tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    let hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

    let h = (n / 100) as usize;
    let t = ((n % 100) / 10) as usize;
    let o = (n % 10) as usize;

    let mut result = String::new();

    if h > 0 && h <= 9 {
        result.push_str(hundreds[h]);
    }

    // Handle special cases: 15 = ט״ו, 16 = ט״ז
    if t == 1 && o == 5 {
        result.push_str("טו");
    } else if t == 1 && o == 6 {
        result.push_str("טז");
    } else {
        if t > 0 && t <= 9 {
            result.push_str(tens[t]);
        }
        if o > 0 && o <= 9 {
            result.push_str(ones[o]);
        }
    }

    add_gershayim(&result)
}

/// Add gershayim (״) before the last character, or geresh (׳) for single character
fn add_gershayim(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return String::new();
    }
    if chars.len() == 1 {
        format!("{}׳", s)
    } else {
        let (before_last, last) = s.char_indices().last().map(|(i, c)| (&s[..i], c)).unwrap();
        format!("{}״{}", before_last, last)
    }
}

/// Hebrew month names (01=Tishrei, 02=Cheshvan, 03=Kislev, etc.)
fn hebrew_month_name(month: i64, is_leap_year: bool) -> &'static str {
    match month {
        1 => "תשרי",
        2 => "חשון",
        3 => "כסלו",
        4 => "טבת",
        5 => "שבט",
        6 if is_leap_year => "אדר א׳",
        6 => "אדר",
        7 => "ניסן",
        8 => "אייר",
        9 => "סיון",
        10 => "תמוז",
        11 => "אב",
        12 => "אלול",
        13 => "אדר א׳",
        14 => "אדר ב׳",
        _ => "?",
    }
}

/// Check if a Hebrew year is a leap year
fn is_hebrew_leap_year(year: i64) -> bool {
    let cycle_position = ((year - 1) % 19) + 1;
    matches!(cycle_position, 3 | 6 | 8 | 11 | 14 | 17 | 19)
}

/// Format a Hebrew date integer (YYYYMMDD) to a readable Hebrew string
fn format_hebrew_date(hebdate: &str) -> Option<String> {
    let hebdate: i64 = hebdate.parse().ok()?;
    let year = hebdate / 10000;
    let month = (hebdate % 10000) / 100;
    let day = hebdate % 100;

    let is_leap = is_hebrew_leap_year(year);
    let day_heb = number_to_hebrew(day as i32);
    let month_name = hebrew_month_name(month, is_leap);
    let year_heb = number_to_hebrew((year % 1000) as i32);

    Some(format!("{} {} {}", day_heb, month_name, year_heb))
}

#[derive(SimpleObject, Debug, Clone)]
#[graphql(complex)]
pub struct Perek {
    pub id: i32,
    /// The perek ID (1-929) used in the 929 project
    pub perek_id: Option<i32>,
    /// The sefer ID this perek belongs to
    pub sefer_id: Option<i32>,
    /// Additional identifier for sefarim with multiple parts (e.g., שמואל א, שמואל ב)
    pub additional: Option<i32>,
    /// The perek number within the sefer/additional
    pub perek: Option<i32>,
    /// The date this perek is scheduled for in the 929 cycle
    pub date: Option<String>,
    /// The Hebrew date representation (integer format YYYYMMDD)
    pub hebdate: Option<String>,
    /// The Hebrew date in formatted Hebrew string
    pub compiled_hebdate: Option<String>,
    /// The tseit (nightfall) time for this date
    pub tseit: Option<String>,
    /// The header/title for this perek
    pub header: Option<String>,
    /// The source reference with gematry (Hebrew letters for numbers)
    pub compiled_source: Option<String>,
}

impl From<Model> for Perek {
    fn from(value: Model) -> Self {
        // Compute compiled_source from sefer_name, additional_letter, and perek_in_context
        let compiled_source = value.sefer_name.as_ref().map(|sefer_name| {
            let perek_num = value.perek_in_context.unwrap_or(1);
            let perek_heb = number_to_hebrew(perek_num);
            match &value.additional_letter {
                Some(letter) => format!("{} {} {}", sefer_name, letter, perek_heb),
                None => format!("{} {}", sefer_name, perek_heb),
            }
        });

        // Compute compiled_hebdate from hebdate
        let compiled_hebdate = value.hebdate.as_ref().and_then(|h| format_hebrew_date(h));

        Self {
            id: value.id,
            perek_id: value.perek_id,
            sefer_id: value.sefer_id,
            additional: value.additional,
            perek: value.perek,
            date: value.date.map(|d| d.to_string()),
            hebdate: value.hebdate,
            compiled_hebdate,
            tseit: value.tseit.map(|t| t.to_string()),
            header: value.header,
            compiled_source,
        }
    }
}

#[ComplexObject]
impl Perek {
    /// Returns the count of articles for this perek
    #[graphql(name = "articlesCount")]
    async fn articles_count(&self, ctx: &Context<'_>) -> Result<i64> {
        // Use perek_id (1-929) for counting, not the DB id
        let perek_id = self.perek_id.unwrap_or(self.id);
        let db = ctx.data::<Database>()?;
        let count = articles_service::count_by_perek_id(db, perek_id).await?;
        Ok(count)
    }
}
