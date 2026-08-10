//! Lookup stage: Join with the `texts` collection to get version data.
//!
//! Uses a correlated pipeline subquery to pre-filter within MongoDB:
//! - Only Hebrew versions (language: "he")
//! - Exclude problematic versionTitle/versionSource entries
//! - Keep the single fullest version per index entry — Sefaria often carries a
//!   near-empty stub alongside the real text (e.g. "Radak on Genesis" has 29
//!   segments while its "Vocalized Edition" has 2370), so taking whichever
//!   version happened to come first silently dropped most of the commentary
//! - Only project the `chapter` field (actual text content)
//!
//! This avoids the 16MB BSON document size limit that occurs when naively
//! joining large commentaries (e.g., Rashi on Torah has 21MB+ of text data).

use bson::{Document, doc};

/// JSON representation of the lookup sub-pipeline stages.
const LOOKUP_TEXTS_PIPELINE_JSON: &str = include_str!("lookup_texts_pipeline.json");

/// Returns the `$lookup` stage document with correlated pipeline subquery.
pub fn build() -> Document {
    let pipeline: Vec<Document> = serde_json::from_str(LOOKUP_TEXTS_PIPELINE_JSON).expect(
        "Failed to parse lookup_texts_pipeline.json - this is a bug in the stage definition",
    );

    doc! {
        "$lookup": {
            "from": "texts",
            "let": { "idx_title": "$title" },
            "pipeline": pipeline,
            "as": "versions"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub_pipeline() -> Vec<Document> {
        build()
            .get_document("$lookup")
            .unwrap()
            .get_array("pipeline")
            .unwrap()
            .iter()
            .map(|s| s.as_document().unwrap().clone())
            .collect()
    }

    fn stage_names(pipeline: &[Document]) -> Vec<String> {
        pipeline
            .iter()
            .filter_map(|s| s.keys().next().cloned())
            .collect()
    }

    /// serde_json widens integers to i64, so read either width.
    fn as_int(doc: &Document, key: &str) -> i64 {
        doc.get(key)
            .and_then(bson::Bson::as_i64)
            .or_else(|| doc.get(key).and_then(bson::Bson::as_i32).map(i64::from))
            .unwrap_or_else(|| panic!("{key} is not an integer"))
    }

    #[test]
    fn selects_the_fullest_version_before_limiting() {
        let pipeline = sub_pipeline();
        let names = stage_names(&pipeline);

        let sort_at = names.iter().position(|n| n == "$sort").expect("sort stage");
        let limit_at = names
            .iter()
            .position(|n| n == "$limit")
            .expect("limit stage");
        let size_at = names
            .iter()
            .position(|n| n == "$addFields")
            .expect("size stage");

        assert!(
            size_at < sort_at && sort_at < limit_at,
            "version size must be computed and sorted before the single version is kept: {names:?}"
        );

        let sort = pipeline[sort_at].get_document("$sort").unwrap();
        assert_eq!(as_int(sort, "versionSize"), -1, "largest version first");
        assert!(
            sort.contains_key("versionTitle"),
            "tie-break must be deterministic"
        );
        assert_eq!(as_int(&pipeline[limit_at], "$limit"), 1);
    }

    #[test]
    fn projects_only_chapter_after_selection() {
        let pipeline = sub_pipeline();
        let names = stage_names(&pipeline);
        let project_at = names
            .iter()
            .position(|n| n == "$project")
            .expect("project stage");
        let limit_at = names.iter().position(|n| n == "$limit").unwrap();

        assert!(
            project_at > limit_at,
            "chapter projection must run after the version is chosen, otherwise the size field is gone: {names:?}"
        );
        let project = pipeline[project_at].get_document("$project").unwrap();
        assert_eq!(as_int(project, "chapter"), 1);
    }

    #[test]
    fn keeps_hebrew_only_and_the_exclusion_lists() {
        let pipeline = sub_pipeline();
        let matcher = pipeline[0].get_document("$match").unwrap();
        assert_eq!(matcher.get_str("language").unwrap(), "he");
        assert!(
            !matcher
                .get_document("versionTitle")
                .unwrap()
                .get_array("$nin")
                .unwrap()
                .is_empty()
        );
        assert!(
            !matcher
                .get_document("versionSource")
                .unwrap()
                .get_array("$nin")
                .unwrap()
                .is_empty()
        );
    }
}
