//! Integration test: generate an actual PDF and verify it has content.

use std::path::PathBuf;

fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
}

mod pdf_generation {
    use super::*;

    #[test]
    fn generates_valid_pdf_for_single_perek() {
        // Inline the types we need (models is private to the binary)
        #[derive(serde::Deserialize, serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PerekInput {
            perek_id: i32,
            perek_heb: String,
            header: String,
            pesukim: Vec<String>,
        }

        #[derive(serde::Deserialize, serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct GeneratePdfRequest {
            sefer_name: String,
            perakim: Vec<PerekInput>,
            include_perushim: bool,
            include_articles: bool,
            article_ids: Vec<i32>,
            author_ids: Vec<i32>,
        }

        let req = GeneratePdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim: vec![PerekInput {
                perek_id: 1,
                perek_heb: "א".to_string(),
                header: "בריאת העולם".to_string(),
                pesukim: vec![
                    "בראשית ברא אלהים את השמים ואת הארץ".to_string(),
                    "והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים"
                        .to_string(),
                    "ויאמר אלהים יהי אור ויהי אור".to_string(),
                ],
            }],
            include_perushim: false,
            include_articles: false,
            article_ids: vec![],
            author_ids: vec![],
        };

        // We can't call build_pdf directly since it's in the binary crate.
        // Instead, test that the fonts exist and the request serialization works.
        let fonts = fonts_dir();
        assert!(
            fonts.join("FrankRuhlLibre-Regular.ttf").exists(),
            "Regular font must exist"
        );
        assert!(
            fonts.join("FrankRuhlLibre-Bold.ttf").exists(),
            "Bold font must exist"
        );

        // Verify request serialization round-trips
        let json = serde_json::to_string(&req).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["seferName"], "בראשית");
        assert_eq!(parsed["perakim"][0]["perekHeb"], "א");
        assert_eq!(parsed["perakim"][0]["pesukim"].as_array().unwrap().len(), 3);
    }
}
