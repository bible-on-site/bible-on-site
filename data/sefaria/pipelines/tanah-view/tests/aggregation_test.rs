//! Integration tests for the tanah-view aggregation pipeline.
//!
//! These tests run the aggregation pipeline against MongoDB and verify the output.
//! Requires MongoDB to be running with the Sefaria dump loaded.
//!
//! Tests are ignored in CI environments unless the `integration` feature is enabled.
//! Run locally with: `cargo test --features integration`
//!
//! TODO: Replace this workaround with proper nextest filtering when available.
//! See: https://github.com/nextest-rs/nextest/discussions/1757
//! Workaround based on: https://stackoverflow.com/a/50568293

use bson::Document;
use mongodb::{Client, options::ClientOptions};
use once_cell::sync::Lazy;
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

/// Cached aggregation results - runs pipeline once for all tests
static TANAH_VIEW: Lazy<Mutex<Option<Vec<Value>>>> = Lazy::new(|| Mutex::new(None));

/// Run the aggregation pipeline and return results as JSON values
async fn run_aggregation() -> Vec<Value> {
    // Load environment variables
    dotenvy::from_path("../../setup-and-population/.env").ok();
    dotenvy::dotenv().ok();

    let mongo_host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".to_string());
    let mongo_port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".to_string());
    let dump_name =
        std::env::var("DUMP_NAME").unwrap_or_else(|_| "sefaria-dump-5784-sivan-4".to_string());

    let client_options = ClientOptions::parse(format!("mongodb://{}:{}", mongo_host, mongo_port))
        .await
        .expect("Failed to parse MongoDB connection string");

    let client = Client::with_options(client_options).expect("Failed to create MongoDB client");
    let db = client.database(&dump_name);

    // Load data from the data/ directory
    let data_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let pipeline = tanah_view::aggregation::build_pipeline(&data_root)
        .expect("Failed to build aggregation pipeline");
    let collection = db.collection::<Document>("texts");
    let mut cursor = collection
        .aggregate(pipeline)
        .await
        .expect("Failed to run aggregation");

    let mut results: Vec<Value> = Vec::new();
    while cursor.advance().await.expect("Failed to advance cursor") {
        let doc = cursor.deserialize_current().expect("Failed to deserialize");
        let json: Value = serde_json::to_value(&doc).expect("Failed to convert BSON to JSON");
        results.push(json);
    }

    results
}

/// Get cached tanah view data, running aggregation if needed
fn get_tanah_view() -> Vec<Value> {
    let mut cache = TANAH_VIEW.lock().unwrap();
    if cache.is_none() {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create runtime");
        *cache = Some(rt.block_on(run_aggregation()));
    }
    cache.clone().unwrap()
}

/// Helper to find a sefer by name
fn find_sefer<'a>(data: &'a [Value], name: &str) -> &'a Value {
    data.iter()
        .find(|s| s["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("{} not found", name))
}

/// Helper to find a sefer with additionals structure
fn find_sefer_with_additionals<'a>(data: &'a [Value], sefer_name: &str) -> &'a Value {
    data.iter()
        .find(|s| s["name"].as_str() == Some(sefer_name) && s.get("additionals").is_some())
        .unwrap_or_else(|| panic!("Sefer '{}' with additionals not found", sefer_name))
}

/// Helper to get segment from sefer/perek/pasuk (1-based indices)
fn get_segment(sefer: &Value, perek: usize, pasuk: usize, seg_idx: usize) -> &Value {
    &sefer["perakim"][perek - 1]["pesukim"][pasuk - 1]["segments"][seg_idx]
}

/// Helper to get all perakim from a sefer, handling both regular and additionals structure
fn get_all_perakim(sefer: &Value) -> Vec<&Value> {
    if let Some(additionals) = sefer.get("additionals").and_then(|a| a.as_array()) {
        additionals
            .iter()
            .flat_map(|add| {
                add.get("perakim")
                    .and_then(|p| p.as_array())
                    .map(|arr| arr.iter().collect::<Vec<_>>())
                    .unwrap_or_default()
            })
            .collect()
    } else if let Some(perakim) = sefer.get("perakim").and_then(|p| p.as_array()) {
        perakim.iter().collect()
    } else {
        Vec::new()
    }
}

/// Helper to get offset as i64, handling various numeric types
fn get_offset_as_i64(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_f64().map(|f| f as i64))
}

mod pasek {
    use super::*;

    #[test]
    #[cfg_attr(not(feature = "integration"), ignore)]
    fn glues_with_space_in_bereshit_2_5() {
        let data = get_tanah_view();
        let bereshit = find_sefer(&data, "בראשית");
        let segment = get_segment(bereshit, 2, 5, 0);

        assert_eq!(
            segment["value"].as_str().unwrap(),
            "וְכֹ֣ל ׀",
            "First segment of בראשית ב:ה should have pasek glued with space"
        );
    }
}

mod segment_types {
    use super::*;

    mod qri {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn regular_word_has_type_qri_without_offset() {
            let data = get_tanah_view();
            let bereshit = find_sefer(&data, "בראשית");
            let segment = get_segment(bereshit, 1, 1, 0);

            assert_eq!(
                segment["type"].as_str().unwrap(),
                "qri",
                "Regular words should have type 'qri'"
            );
            assert!(
                segment.get("ktivOffset").is_none(),
                "Regular qri should NOT have ktivOffset"
            );
            assert!(
                segment.get("recordingTimeFrame").is_some(),
                "qri should have recordingTimeFrame"
            );
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn is_vocalized_with_niqqud() {
            let data = get_tanah_view();
            let niqqud_pattern =
                regex::Regex::new(r"[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7]").unwrap();

            let bereshit = find_sefer(&data, "בראשית");
            let first_pasuk = &bereshit["perakim"][0]["pesukim"][0]["segments"];

            for segment in first_pasuk.as_array().unwrap().iter().take(5) {
                if segment["type"].as_str() == Some("qri") && segment.get("ktivOffset").is_none() {
                    let value = segment["value"].as_str().unwrap_or("");
                    assert!(
                        niqqud_pattern.is_match(value),
                        "Qri segment '{}' should be vocalized (have niqqud)",
                        value
                    );
                }
            }
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn regular_segments_have_recording_time_frame() {
            let data = get_tanah_view();
            let mut checked = 0;

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                if let Some(first_perek) = perakim.first()
                    && let Some(pesukim) = first_perek.get("pesukim").and_then(|p| p.as_array())
                {
                    for pasuk in pesukim {
                        if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array()) {
                            for segment in segments {
                                if segment["type"].as_str() == Some("qri")
                                    && segment.get("ktivOffset").is_none()
                                {
                                    assert!(
                                        segment.get("recordingTimeFrame").is_some(),
                                        "Regular qri segment '{}' should have recordingTimeFrame",
                                        segment["value"].as_str().unwrap_or("")
                                    );
                                    checked += 1;
                                }
                            }
                        }
                    }
                }
            }

            assert!(
                checked > 100,
                "Should have checked at least 100 regular qri segments"
            );
        }
    }

    mod ktiv {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn is_unvocalized_without_niqqud() {
            let data = get_tanah_view();
            let niqqud_pattern =
                regex::Regex::new(r"[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C7]").unwrap();

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("ktiv") {
                                        let value = segment["value"].as_str().unwrap_or("");
                                        assert!(
                                            !niqqud_pattern.is_match(value),
                                            "Ktiv segment '{}' should be unvocalized (no niqqud)",
                                            value
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn never_has_recording_time_frame() {
            let data = get_tanah_view();

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("ktiv") {
                                        assert!(
                                            segment.get("recordingTimeFrame").is_none(),
                                            "Ktiv segment '{}' should NOT have recordingTimeFrame",
                                            segment["value"].as_str().unwrap_or("")
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    mod ptuha_stuma {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn has_no_recording_time_frame() {
            let data = get_tanah_view();
            let bereshit = find_sefer(&data, "בראשית");

            for perek in bereshit["perakim"].as_array().unwrap() {
                for pasuk in perek["pesukim"].as_array().unwrap() {
                    for segment in pasuk["segments"].as_array().unwrap() {
                        let seg_type = segment["type"].as_str().unwrap_or("");
                        if seg_type == "ptuha" || seg_type == "stuma" {
                            assert!(
                                segment.get("recordingTimeFrame").is_none(),
                                "{} should NOT have recordingTimeFrame",
                                seg_type
                            );
                            return; // Found one, test passes
                        }
                    }
                }
            }
            panic!("No ptuha or stuma found in בראשית");
        }
    }
}

mod ktiv_qri_pairs {
    use super::*;

    #[test]
    #[cfg_attr(not(feature = "integration"), ignore)]
    fn bereshit_8_17_has_correct_offsets() {
        let data = get_tanah_view();
        let bereshit = find_sefer(&data, "בראשית");

        let pasuk = &bereshit["perakim"][7]["pesukim"][16]["segments"];
        let segments: Vec<&Value> = pasuk.as_array().unwrap().iter().collect();

        let ktiv_idx = segments
            .iter()
            .position(|s| s["value"].as_str() == Some("הוצא"))
            .expect("ktiv 'הוצא' not found");

        let ktiv_seg = segments[ktiv_idx];
        let qri_seg = segments[ktiv_idx + 1];

        // Ktiv assertions
        assert_eq!(ktiv_seg["type"].as_str().unwrap(), "ktiv");
        assert_eq!(ktiv_seg["qriOffset"].as_f64().unwrap() as i64, 1);
        assert!(ktiv_seg.get("recordingTimeFrame").is_none());

        // Qri assertions
        assert_eq!(qri_seg["type"].as_str().unwrap(), "qri");
        assert_eq!(qri_seg["value"].as_str().unwrap(), "הַיְצֵ֣א");
        assert_eq!(qri_seg["ktivOffset"].as_f64().unwrap() as i64, -1);
        assert!(qri_seg.get("recordingTimeFrame").is_some());
    }

    #[test]
    #[cfg_attr(not(feature = "integration"), ignore)]
    fn count_is_reasonable() {
        let data = get_tanah_view();
        let mut qri_with_offset_count = 0;

        for sefer in &data {
            let perakim = get_all_perakim(sefer);

            for perek in perakim {
                if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                    for pasuk in pesukim {
                        if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array()) {
                            for segment in segments {
                                if segment["type"].as_str() == Some("qri")
                                    && segment.get("ktivOffset").is_some()
                                {
                                    qri_with_offset_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        assert!(
            (1200..=1400).contains(&qri_with_offset_count),
            "Expected ~1279 qri segments with ktivOffset, got {}",
            qri_with_offset_count
        );
    }

    mod offset_consistency {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn ktiv_points_to_qri() {
            let data = get_tanah_view();
            let mut checked_count = 0;

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for (idx, segment) in segments.iter().enumerate() {
                                    if segment["type"].as_str() == Some("ktiv")
                                        && let Some(offset) = segment.get("qriOffset")
                                        && let Some(offset_val) = get_offset_as_i64(offset)
                                        && offset_val > 0
                                        && (idx as i64 + offset_val) < segments.len() as i64
                                    {
                                        let target = &segments[idx + offset_val as usize];
                                        assert_eq!(
                                            target["type"].as_str(),
                                            Some("qri"),
                                            "Ktiv at index {} with qriOffset {} should point to qri",
                                            idx,
                                            offset_val
                                        );
                                        checked_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            assert!(
                checked_count > 500,
                "Should have checked at least 500 ktiv->qri pairs, got {}",
                checked_count
            );
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn qri_points_to_ktiv() {
            let data = get_tanah_view();
            let mut checked_count = 0;

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for (idx, segment) in segments.iter().enumerate() {
                                    if segment["type"].as_str() == Some("qri")
                                        && let Some(offset) = segment.get("ktivOffset")
                                        && let Some(offset_val) = get_offset_as_i64(offset)
                                        && offset_val < 0
                                    {
                                        let target_idx = idx as i64 + offset_val;
                                        if target_idx >= 0 && (target_idx as usize) < segments.len()
                                        {
                                            let target = &segments[target_idx as usize];
                                            assert_eq!(
                                                target["type"].as_str(),
                                                Some("ktiv"),
                                                "Qri at index {} with ktivOffset {} should point to ktiv",
                                                idx,
                                                offset_val
                                            );
                                            checked_count += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            assert!(
                checked_count > 500,
                "Should have checked at least 500 qri->ktiv pairs, got {}",
                checked_count
            );
        }
    }

    /// Tests for orphan segments (כתיב ולא קרי and קרי ולא כתיב)
    mod orphan_segments {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn ktiv_without_qri_has_zero_offset() {
            // כתיב ולא קרי - ktiv segments with no matching qri should have qriOffset=0
            let data = get_tanah_view();
            let mut ktiv_zero_count = 0;
            let mut ktiv_zero_examples: Vec<(String, i32, String)> = Vec::new();

            for sefer in &data {
                let sefer_name = sefer["name"].as_str().unwrap_or("unknown");
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    let perek_id = perek["perekId"].as_i64().unwrap_or(0) as i32;
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("ktiv")
                                        && let Some(offset) = segment.get("qriOffset")
                                        && get_offset_as_i64(offset) == Some(0)
                                    {
                                        ktiv_zero_count += 1;
                                        if ktiv_zero_examples.len() < 5 {
                                            let value =
                                                segment["value"].as_str().unwrap_or("").to_string();
                                            ktiv_zero_examples.push((
                                                sefer_name.to_string(),
                                                perek_id,
                                                value,
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // We know from data analysis there are 30 כתיב ולא קרי cases
            assert!(
                (25..=40).contains(&ktiv_zero_count),
                "Expected ~30 ktiv segments with qriOffset=0 (כתיב ולא קרי), got {}. Examples: {:?}",
                ktiv_zero_count,
                ktiv_zero_examples
            );
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn qri_without_ktiv_has_zero_offset() {
            // קרי ולא כתיב - bracket qri segments with no matching ktiv should have ktivOffset=0
            let data = get_tanah_view();
            let mut qri_zero_count = 0;
            let mut qri_zero_examples: Vec<(String, i32, String)> = Vec::new();

            for sefer in &data {
                let sefer_name = sefer["name"].as_str().unwrap_or("unknown");
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    let perek_id = perek["perekId"].as_i64().unwrap_or(0) as i32;
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("qri")
                                        && let Some(offset) = segment.get("ktivOffset")
                                        && get_offset_as_i64(offset) == Some(0)
                                    {
                                        qri_zero_count += 1;
                                        if qri_zero_examples.len() < 5 {
                                            let value =
                                                segment["value"].as_str().unwrap_or("").to_string();
                                            qri_zero_examples.push((
                                                sefer_name.to_string(),
                                                perek_id,
                                                value,
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // We know from data analysis there are 11 קרי ולא כתיב cases
            assert!(
                (8..=15).contains(&qri_zero_count),
                "Expected ~11 qri segments with ktivOffset=0 (קרי ולא כתיב), got {}. Examples: {:?}",
                qri_zero_count,
                qri_zero_examples
            );
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn all_ktiv_segments_have_qri_offset() {
            // Every ktiv segment should have qriOffset (either pointing to qri or 0 for orphan)
            let data = get_tanah_view();
            let mut ktiv_without_offset: Vec<(String, i32, String)> = Vec::new();

            for sefer in &data {
                let sefer_name = sefer["name"].as_str().unwrap_or("unknown");
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    let perek_id = perek["perekId"].as_i64().unwrap_or(0) as i32;
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("ktiv")
                                        && segment.get("qriOffset").is_none()
                                    {
                                        let value =
                                            segment["value"].as_str().unwrap_or("").to_string();
                                        ktiv_without_offset.push((
                                            sefer_name.to_string(),
                                            perek_id,
                                            value,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }

            assert!(
                ktiv_without_offset.is_empty(),
                "All ktiv segments should have qriOffset. Found {} without: {:?}",
                ktiv_without_offset.len(),
                ktiv_without_offset
            );
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn regular_qri_has_no_ktiv_offset() {
            // Regular qri (קרי וכתיב) should NOT have ktivOffset property at all
            // Only bracket-derived qri should have ktivOffset
            let data = get_tanah_view();
            let mut regular_qri_count = 0;
            let mut bracket_qri_count = 0;

            for sefer in &data {
                let perakim = get_all_perakim(sefer);

                for perek in perakim {
                    if let Some(pesukim) = perek.get("pesukim").and_then(|p| p.as_array()) {
                        for pasuk in pesukim {
                            if let Some(segments) = pasuk.get("segments").and_then(|s| s.as_array())
                            {
                                for segment in segments {
                                    if segment["type"].as_str() == Some("qri") {
                                        if segment.get("ktivOffset").is_some() {
                                            bracket_qri_count += 1;
                                        } else {
                                            regular_qri_count += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Regular qri should be the vast majority (300k+)
            // Bracket qri should be around 1200-1300
            assert!(
                regular_qri_count > 300000,
                "Expected >300k regular qri segments without ktivOffset, got {}",
                regular_qri_count
            );
            assert!(
                (1200..=1400).contains(&bracket_qri_count),
                "Expected ~1279 bracket qri segments with ktivOffset, got {}",
                bracket_qri_count
            );
        }
    }
}

mod additionals {
    use super::*;

    mod shmuel {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn has_correct_structure() {
            let data = get_tanah_view();
            let shmuel = find_sefer_with_additionals(&data, "שמואל");

            let additionals = shmuel["additionals"].as_array().unwrap();
            assert_eq!(additionals.len(), 2, "שמואל should have 2 additionals");

            let shmuel_a = &additionals[0];
            assert_eq!(shmuel_a["name"].as_str(), Some("שמואל א"));
            assert_eq!(shmuel_a["perakim"].as_array().unwrap().len(), 31);

            let shmuel_b = &additionals[1];
            assert_eq!(shmuel_b["name"].as_str(), Some("שמואל ב"));
            assert_eq!(shmuel_b["perakim"].as_array().unwrap().len(), 24);
        }

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn ktiv_qri_works_in_additionals() {
            let data = get_tanah_view();
            let shmuel = find_sefer_with_additionals(&data, "שמואל");
            let shmuel_a = &shmuel["additionals"].as_array().unwrap()[0];

            let perek_9 = &shmuel_a["perakim"][8];
            let pasuk_1 = &perek_9["pesukim"][0];
            let segments = pasuk_1["segments"].as_array().unwrap();

            assert!(!segments.is_empty(), "Pasuk should have segments");
            let first_seg = &segments[0];
            assert!(first_seg.get("type").is_some());
            assert!(first_seg.get("value").is_some());
        }
    }

    mod melachim {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn has_correct_structure() {
            let data = get_tanah_view();
            let melachim = find_sefer_with_additionals(&data, "מלכים");

            let additionals = melachim["additionals"].as_array().unwrap();
            assert_eq!(additionals.len(), 2, "מלכים should have 2 additionals");

            assert_eq!(additionals[0]["perakim"].as_array().unwrap().len(), 22);
            assert_eq!(additionals[1]["perakim"].as_array().unwrap().len(), 25);
        }
    }

    mod ezra {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn has_correct_structure() {
            let data = get_tanah_view();
            let ezra = find_sefer_with_additionals(&data, "עזרא");

            let additionals = ezra["additionals"].as_array().unwrap();
            assert_eq!(additionals.len(), 2, "עזרא should have 2 additionals");

            assert_eq!(additionals[0]["perakim"].as_array().unwrap().len(), 10);
            assert_eq!(additionals[1]["perakim"].as_array().unwrap().len(), 13);
        }
    }

    mod divrei_hayamim {
        use super::*;

        #[test]
        #[cfg_attr(not(feature = "integration"), ignore)]
        fn has_correct_structure() {
            let data = get_tanah_view();
            let dh = find_sefer_with_additionals(&data, "דברי הימים");

            let additionals = dh["additionals"].as_array().unwrap();
            assert_eq!(additionals.len(), 2, "דברי הימים should have 2 additionals");

            assert_eq!(additionals[0]["perakim"].as_array().unwrap().len(), 29);
            assert_eq!(additionals[1]["perakim"].as_array().unwrap().len(), 36);
        }
    }
}
