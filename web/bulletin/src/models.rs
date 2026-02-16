//! Request/response types for the PDF generation endpoint.

use serde::{Deserialize, Serialize};

/// Top-level request for PDF generation.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePdfRequest {
    /// e.g. "במדבר"
    pub sefer_name: String,

    /// Ordered list of perakim to include.
    pub perakim: Vec<PerekInput>,

    /// When true, fetch and include perushim for each perek.
    #[serde(default)]
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

/// A single perek's content as sent by the website.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerekInput {
    /// 1-929
    pub perek_id: i32,

    /// Hebrew letter for perek number, e.g. "א"
    pub perek_heb: String,

    /// Perek header/title, e.g. "מפקד בני ישראל"
    #[serde(default)]
    pub header: String,

    /// Pesukim text — plain extracted text per pasuk.
    pub pesukim: Vec<String>,
}

/// Metadata returned alongside the PDF (optional, for logging/debugging).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePdfResponse {
    pub filename: String,
    pub page_count: usize,
}
