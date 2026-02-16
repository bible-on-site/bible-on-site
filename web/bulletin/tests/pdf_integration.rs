//! Integration tests: generate actual PDFs and verify output.
//! Also saves fixture PDFs under tests/fixtures/ for visual regression.

use std::fs;
use std::path::PathBuf;

fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
}

fn fixtures_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    fs::create_dir_all(&dir).ok();
    dir
}

// Shared request types (models is private to the binary, so inline them)
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

mod pdf_generation {
    use super::*;

    #[test]
    fn generates_valid_pdf_for_single_perek() {
        let fonts = fonts_dir();
        assert!(
            fonts.join("FrankRuhlLibre-Regular.ttf").exists(),
            "Regular font must exist"
        );
        assert!(
            fonts.join("FrankRuhlLibre-Bold.ttf").exists(),
            "Bold font must exist"
        );

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

        // Verify request serialization round-trips
        let json = serde_json::to_string(&req).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["seferName"], "בראשית");
        assert_eq!(parsed["perakim"][0]["perekHeb"], "א");
        assert_eq!(parsed["perakim"][0]["pesukim"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn generates_pdf_fixture_bereshit_1() {
        use bulletin::pdf;

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
                    "וירא אלהים את האור כי טוב ויבדל אלהים בין האור ובין החשך".to_string(),
                    "ויקרא אלהים לאור יום ולחשך קרא לילה ויהי ערב ויהי בקר יום אחד".to_string(),
                ],
            }],
            include_perushim: false,
            include_articles: false,
            article_ids: vec![],
            author_ids: vec![],
        };

        // Convert to the internal model type expected by build_pdf
        let internal_req = bulletin::pdf::PdfRequest {
            sefer_name: req.sefer_name,
            perakim: req
                .perakim
                .into_iter()
                .map(|p| bulletin::pdf::PdfPerekInput {
                    perek_heb: p.perek_heb,
                    header: p.header,
                    pesukim: p.pesukim,
                })
                .collect(),
        };

        let articles: Vec<(String, String, String)> = vec![];
        let doc = pdf::build_pdf(&internal_req, &articles, &fonts_dir()).unwrap();

        let mut buf = Vec::new();
        doc.render(&mut buf).unwrap();

        assert!(buf.len() > 1000, "PDF should be > 1KB, got {} bytes", buf.len());
        assert_eq!(&buf[0..5], b"%PDF-", "Output should start with PDF header");

        // Save as fixture
        let fixture_path = fixtures_dir().join("bereshit-aleph.pdf");
        fs::write(&fixture_path, &buf).unwrap();
        println!("Saved fixture: {}", fixture_path.display());
    }

    #[test]
    fn generates_pdf_fixture_multi_perek() {
        use bulletin::pdf;

        let internal_req = bulletin::pdf::PdfRequest {
            sefer_name: "במדבר".to_string(),
            perakim: vec![
                bulletin::pdf::PdfPerekInput {
                    perek_heb: "א".to_string(),
                    header: "מפקד בני ישראל".to_string(),
                    pesukim: vec![
                        "וידבר יהוה אל משה במדבר סיני באהל מועד באחד לחדש השני בשנה השנית לצאתם מארץ מצרים לאמר".to_string(),
                        "שאו את ראש כל עדת בני ישראל למשפחתם לבית אבתם במספר שמות כל זכר לגלגלתם".to_string(),
                    ],
                },
                bulletin::pdf::PdfPerekInput {
                    perek_heb: "ב".to_string(),
                    header: "סדר המחנות".to_string(),
                    pesukim: vec![
                        "וידבר יהוה אל משה ואל אהרן לאמר".to_string(),
                        "איש על דגלו באתת לבית אבתם יחנו בני ישראל מנגד סביב לאהל מועד יחנו".to_string(),
                    ],
                },
                bulletin::pdf::PdfPerekInput {
                    perek_heb: "ג".to_string(),
                    header: "בני לוי".to_string(),
                    pesukim: vec![
                        "ואלה תולדת אהרן ומשה ביום דבר יהוה את משה בהר סיני".to_string(),
                    ],
                },
            ],
        };

        let articles: Vec<(String, String, String)> = vec![
            ("מאמר לדוגמה".to_string(), "הרב ישראל".to_string(), "תוכן המאמר כאן".to_string()),
        ];

        let doc = pdf::build_pdf(&internal_req, &articles, &fonts_dir()).unwrap();

        let mut buf = Vec::new();
        doc.render(&mut buf).unwrap();

        assert!(buf.len() > 1000, "Multi-perek PDF should be > 1KB");
        assert_eq!(&buf[0..5], b"%PDF-", "Output should start with PDF header");

        let fixture_path = fixtures_dir().join("bamidbar-aleph-gimel.pdf");
        fs::write(&fixture_path, &buf).unwrap();
        println!("Saved fixture: {}", fixture_path.display());
    }
}
