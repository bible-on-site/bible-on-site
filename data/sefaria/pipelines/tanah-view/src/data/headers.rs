//! Perek headers data loader.
//!
//! Loads 929 perek headers from `annotations/perakim-headers.yml`.

use anyhow::Result;
use bson::Bson;
use serde::Deserialize;
use std::path::Path;

/// A single perek header entry from the YAML file.
#[derive(Debug, Deserialize)]
pub struct PerekHeader {
    pub id: u32,
    pub sefer: String,
    pub perek: u32,
    pub header: String,
    pub qualified: bool,
}

/// Loads perek headers from the YAML file.
///
/// # Arguments
/// * `data_root` - Path to the `data/` directory
///
/// # Returns
/// A vector of 929 perek headers in order.
pub fn load(data_root: &Path) -> Result<Vec<PerekHeader>> {
    let path = data_root.join("annotations/perakim-headers.yml");
    let content = std::fs::read_to_string(&path)?;
    let headers: Vec<PerekHeader> = serde_yaml::from_str(&content)?;
    Ok(headers)
}

/// Extracts just the header strings in order (for MongoDB aggregation).
pub fn to_header_strings(headers: &[PerekHeader]) -> Vec<String> {
    headers.iter().map(|h| h.header.clone()).collect()
}

/// Converts headers to BSON array format for MongoDB aggregation.
pub fn to_bson_array(headers: &[PerekHeader]) -> Bson {
    let bson_headers: Vec<Bson> = headers
        .iter()
        .map(|h| Bson::String(h.header.clone()))
        .collect();
    Bson::Array(bson_headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_headers() {
        // Find data root relative to this crate
        let data_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let headers = load(&data_root).expect("Failed to load headers");

        // Headers file is work-in-progress, just verify it loads and has basic structure
        assert!(!headers.is_empty(), "Should have at least some headers");
        assert!(headers.len() <= 929, "Should not exceed 929 perek headers");
        assert_eq!(headers[0].header, "בריאת העולם");
        assert_eq!(headers[0].sefer, "בראשית");
    }
}
