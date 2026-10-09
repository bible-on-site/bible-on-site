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

    /// First page: styled cover with sefer title (full-sefer download).
    #[serde(default)]
    pub include_cover: bool,

    /// After cover: TOC listing all perakim in this PDF.
    #[serde(default)]
    pub include_toc: bool,

    /// Accent color for cover ornament (hex without `#`, e.g. `8B0000`).
    #[serde(default)]
    pub cover_accent_hex: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_pdf_request_deserializes_camel_case_defaults() {
        let req: GeneratePdfRequest =
            serde_json::from_str(r##"{"perakimIds":[1,2],"coverAccentHex":"#123abc"}"##)
                .expect("request should deserialize");

        assert_eq!(req.perakim_ids, vec![1, 2]);
        assert!(req.include_articles);
        assert!(!req.include_perushim);
        assert!(!req.include_cover);
        assert!(!req.include_toc);
        assert!(req.article_ids.is_empty());
        assert!(req.author_ids.is_empty());
        assert_eq!(req.cover_accent_hex.as_deref(), Some("#123abc"));
    }

    #[test]
    fn generate_pdf_request_allows_filter_and_layout_options() {
        let req: GeneratePdfRequest = serde_json::from_str(
            r#"{"perakimIds":[3],"includeArticles":false,"includePerushim":true,"articleIds":[8],"authorIds":[5],"includeCover":true,"includeToc":true}"#,
        )
        .expect("request should deserialize");

        assert!(!req.include_articles);
        assert!(req.include_perushim);
        assert_eq!(req.article_ids, vec![8]);
        assert_eq!(req.author_ids, vec![5]);
        assert!(req.include_cover);
        assert!(req.include_toc);
    }
}
