//! Final project stage: Map sefer names to canonical numbers and finalize fields.
//!
//! This stage performs the final projection:
//! - `sefer`: Maps Hebrew sefer name to canonical number (1–35, matching Tanakh order)
//! - `additional`: For split books (שמואל א/ב, מלכים א/ב, עזרא/נחמיה, דברי הימים א/ב)
//! - `name`: Final cleanup (e.g., "ר' חננאל" → "רבינו חננאל")
//! - Passes through: alt_structs, authors, compDate, pubDate, schema, versions
//!
//! Canonical sefer numbering:
//!   1–5: Torah (בראשית through דברים)
//!   6–7: Nevi'im Rishonim first (יהושע, שופטים)
//!   8–9: Split Nevi'im (שמואל=8, מלכים=9)
//!   10–24: Nevi'im Acharonim (ישעיהו through מלאכי)
//!   25–27: Ketuvim (תהילים, משלי, איוב)
//!   28–32: Megillot (שיר השירים through אסתר)
//!   33–35: Late Ketuvim (דניאל, עזרא/נחמיה=34, דברי הימים=35)
//!
//! Due to the complexity of this stage (deeply nested MongoDB expressions),
//! the inner content is defined as JSON and parsed at runtime.

use bson::{Document, doc};

/// JSON representation of the project stage inner content.
const PROJECT_FINAL_INNER_JSON: &str = include_str!("project_final_inner.json");

/// Returns the `$project` stage document.
pub fn build() -> Document {
    let inner: Document = serde_json::from_str(PROJECT_FINAL_INNER_JSON)
        .expect("Failed to parse project_final_inner.json - this is a bug in the stage definition");

    doc! {
        "$project": inner
    }
}
