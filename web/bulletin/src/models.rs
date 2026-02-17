//! Request/response types for the PDF generation endpoint.

use serde::{Deserialize, Serialize};

/// Top-level request for PDF generation.
/// The service resolves all perek data (text, headers) from embedded Tanach data.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePdfRequest {
    /// e.g. "במדבר". Optional — derived from the first perek if omitted.
    #[serde(default)]
    pub sefer_name: Option<String>,

    /// Ordered list of perek IDs (1-929) to include.
    pub perakim_ids: Vec<i32>,

    /// When true, fetch and include perushim for each perek.
    /// (Currently unused — reserved for future perushim feature.)
    #[serde(default)]
    #[allow(dead_code)]
    pub include_perushim: bool,

    /// When true, fetch and include articles for each perek.
    #[serde(default = "default_true")]
    pub include_articles: bool,

    /// If non-empty, limit articles to these specific IDs.
    #[serde(default)]
    pub article_ids: Vec<i32>,

    /// If non-empty, limit articles to these author IDs.
    #[serde(default)]
    pub author_ids: Vec<i32>,
}

fn default_true() -> bool {
    true
}

/// Metadata returned alongside the PDF (optional, for logging/debugging).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct GeneratePdfResponse {
    pub filename: String,
    pub page_count: usize,
}
