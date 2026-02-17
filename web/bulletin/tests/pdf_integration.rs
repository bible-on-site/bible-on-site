//! Integration tests: generate actual PDFs and verify output.
//! Also saves fixture PDFs under tests/fixtures/ for visual regression.
//!
//! Tests use the embedded Tanach data (via bulletin::tanach) — same as production.

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

mod pdf_generation {
    use super::*;
    use bulletin::pdf;
    use bulletin::tanach;

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

        // Look up perek 1 (בראשית א') from embedded data
        let perek_data = tanach::get_perek(1).expect("perek 1 must exist");
        assert_eq!(perek_data.sefer_name, "בראשית");
        assert!(!perek_data.pesukim.is_empty());

        let req = pdf::PdfRequest {
            sefer_name: perek_data.sefer_name.clone(),
            perakim: vec![pdf::PdfPerekInput {
                perek_heb: tanach::perek_to_hebrew(perek_data.perek_in_sefer),
                header: perek_data.header.clone(),
                pesukim: perek_data.pesukim.clone(),
            }],
        };

        let doc = pdf::build_pdf(&req, &[], &fonts_dir()).unwrap();
        let mut buf = Vec::new();
        doc.render(&mut buf).unwrap();

        assert!(
            buf.len() > 1000,
            "PDF should be > 1KB, got {} bytes",
            buf.len()
        );
        assert_eq!(&buf[0..5], b"%PDF-", "Output should start with PDF header");

        let fixture_path = fixtures_dir().join("bereshit-aleph.pdf");
        fs::write(&fixture_path, &buf).unwrap();
        println!("Saved fixture: {} ({} bytes)", fixture_path.display(), buf.len());
    }

    #[test]
    fn generates_pdf_fixture_multi_perek() {
        // Look up במדבר perakim 1-3 (perek IDs 118-120)
        let perek_ids = [118, 119, 120];
        let perakim: Vec<pdf::PdfPerekInput> = perek_ids
            .iter()
            .map(|&id| {
                let data = tanach::get_perek(id).unwrap_or_else(|| panic!("perek {} must exist", id));
                pdf::PdfPerekInput {
                    perek_heb: tanach::perek_to_hebrew(data.perek_in_sefer),
                    header: data.header.clone(),
                    pesukim: data.pesukim.clone(),
                }
            })
            .collect();

        let first_data = tanach::get_perek(118).unwrap();
        assert_eq!(first_data.sefer_name, "במדבר");

        let req = pdf::PdfRequest {
            sefer_name: first_data.sefer_name.clone(),
            perakim,
        };

        let articles = vec![(
            "מאמר לדוגמה".to_string(),
            "הרב ישראל".to_string(),
            "תוכן המאמר כאן\n\nפסקה שנייה של המאמר".to_string(),
        )];

        let doc = pdf::build_pdf(&req, &articles, &fonts_dir()).unwrap();
        let mut buf = Vec::new();
        doc.render(&mut buf).unwrap();

        assert!(buf.len() > 1000, "Multi-perek PDF should be > 1KB");
        assert_eq!(&buf[0..5], b"%PDF-", "Output should start with PDF header");

        let fixture_path = fixtures_dir().join("bamidbar-aleph-gimel.pdf");
        fs::write(&fixture_path, &buf).unwrap();
        println!("Saved fixture: {} ({} bytes)", fixture_path.display(), buf.len());
    }

    #[test]
    fn all_929_perakim_exist_in_embedded_data() {
        for id in 1..=929 {
            assert!(
                tanach::get_perek(id).is_some(),
                "perekId {} must exist in embedded data",
                id
            );
        }
    }
}
