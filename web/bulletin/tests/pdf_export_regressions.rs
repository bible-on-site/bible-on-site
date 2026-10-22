//! Regression checks on real generated PDFs for the Sefer export fixes:
//! TOC link destinations (#2334), images (#2333), article markup (#2336/#2339).

use std::path::PathBuf;

use bulletin::{pdf, tanach};
use lopdf::{Document, Object};

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

fn fonts_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts")
}

fn perek_input(id: i32, articles: Vec<(String, String, String)>) -> pdf::PdfPerekInput {
    let data = tanach::get_perek(id).expect("perek must exist");
    pdf::PdfPerekInput {
        perek_heb: tanach::perek_to_hebrew(data.perek_in_sefer),
        header: data.header.clone(),
        pesukim: pdf::plain_pesukim(&data.pesukim),
        images: vec![],
        articles,
    }
}

fn full_sefer(sefer: &str, perakim: Vec<pdf::PdfPerekInput>) -> pdf::PdfRequest {
    pdf::PdfRequest {
        sefer_name: sefer.to_string(),
        perakim,
        include_cover: true,
        include_toc: true,
        cover_accent_hex: "8B0000".to_string(),
        cover_text: pdf::PdfCoverText::default(),
    }
}

/// 1-based target pages of internal links, in page order. Typst splits one
/// link into several annotations (one per run), so consecutive repeats collapse.
fn internal_link_targets(pdf_bytes: &[u8]) -> Vec<u32> {
    let doc = Document::load_mem(pdf_bytes).expect("valid PDF");
    let pages = doc.get_pages();
    let page_of = |id: lopdf::ObjectId| pages.iter().find(|(_, p)| **p == id).map(|(n, _)| *n);
    let mut targets = Vec::new();
    for page_id in pages.values() {
        for annot in doc.get_page_annotations(*page_id).unwrap_or_default() {
            if annot.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Link".as_slice()) {
                continue;
            }
            let dest = annot.get(b"Dest").ok().cloned().or_else(|| {
                let action = annot.get(b"A").ok()?;
                let action = match action {
                    Object::Reference(r) => doc.get_dictionary(*r).ok()?,
                    Object::Dictionary(d) => d,
                    _ => return None,
                };
                action.get(b"D").ok().cloned()
            });
            let dest = match dest {
                Some(Object::Reference(r)) => doc.get_object(r).ok().cloned(),
                other => other,
            };
            if let Some(Object::Array(arr)) = dest
                && let Some(Object::Reference(target)) = arr.first()
            {
                targets.push(page_of(*target).expect("link target is a page"));
            }
        }
    }
    targets.dedup();
    targets
}

#[test]
fn malachi_toc_links_jump_to_each_perek() {
    let perakim = (565..=567).map(|id| perek_input(id, vec![])).collect();
    let buf = pdf::build_pdf(&full_sefer("מלאכי", perakim), &fonts_dir()).unwrap();
    let targets = internal_link_targets(&buf);
    // Cover = 1, TOC = 2, so perek א starts on page 3; each perek starts on a new page.
    assert_eq!(targets.len(), 3, "{targets:?}");
    assert_eq!(targets[0], 3);
    assert!(targets.windows(2).all(|w| w[0] < w[1]), "{targets:?}");
    let pages = Document::load_mem(&buf).unwrap().get_pages().len() as u32;
    assert!(targets[2] <= pages);
}

#[test]
fn content_rich_toc_links_follow_final_pagination() {
    let long_article = format!(
        "<h1>כותרת המאמר</h1>{}",
        "<p>פסקה ארוכה של מאמר – עם קו מפריד, וטקסט שממלא את העמוד.</p>".repeat(120)
    );
    let image_article = format!("<p>לפני התמונה</p><img src=\"data:image/png;base64,{PNG_1X1}\">");
    let mut perakim = vec![
        perek_input(1, vec![("מאמר".into(), "הרב".into(), long_article)]),
        perek_input(2, vec![("תמונה".into(), String::new(), image_article)]),
        perek_input(3, vec![]),
    ];
    perakim[1].images.push(pdf::PdfImage {
        bytes: base64::Engine::decode(&base64::engine::general_purpose::STANDARD, PNG_1X1).unwrap(),
        ext: "png".to_string(),
        caption: "איור".to_string(),
    });
    let buf = pdf::build_pdf(&full_sefer("בראשית", perakim), &fonts_dir()).unwrap();
    let targets = internal_link_targets(&buf);
    assert_eq!(targets.len(), 3);
    assert_eq!(targets[0], 3);
    assert!(
        targets[1] > targets[0] + 1,
        "the long article pushes perek ב later: {targets:?}"
    );
    assert!(targets[2] > targets[1]);
}

#[test]
fn image_free_and_single_image_ranges_render() {
    let mut with_image = perek_input(2, vec![]);
    with_image.images.push(pdf::PdfImage {
        bytes: base64::Engine::decode(&base64::engine::general_purpose::STANDARD, PNG_1X1).unwrap(),
        ext: "png".to_string(),
        caption: String::new(),
    });
    for perakim in [
        vec![perek_input(1, vec![])],
        vec![perek_input(1, vec![]), with_image],
    ] {
        let req = pdf::PdfRequest {
            sefer_name: "בראשית".to_string(),
            perakim,
            include_cover: false,
            include_toc: false,
            cover_accent_hex: String::new(),
            cover_text: pdf::PdfCoverText::default(),
        };
        let buf = pdf::build_pdf(&req, &fonts_dir()).unwrap();
        assert_eq!(&buf[0..5], b"%PDF-");
    }
}

#[test]
fn corrupt_image_is_reported_not_dropped() {
    let mut perek = perek_input(1, vec![]);
    perek.images.push(pdf::PdfImage {
        bytes: vec![0, 1, 2, 3],
        ext: "jpg".to_string(),
        caption: String::new(),
    });
    let req = pdf::PdfRequest {
        sefer_name: "בראשית".to_string(),
        perakim: vec![perek],
        include_cover: false,
        include_toc: false,
        cover_accent_hex: String::new(),
        cover_text: pdf::PdfCoverText::default(),
    };
    let err = pdf::build_pdf(&req, &fonts_dir()).unwrap_err().to_string();
    assert!(err.contains("Typst compilation failed"), "{err}");
}

#[test]
fn bold_quote_followed_by_parenthesized_source_compiles() {
    // Shape of production article 3068 (בראשית ב) that failed every range containing it.
    let html = "<blockquote>וַיִּבְרָ֨א <b>זָכָ֥ר וּנְקֵבָ֖ה בָּרָ֥א אֹתָֽם׃<br></b>(בראשית א כז)</blockquote>";
    let req = pdf::PdfRequest {
        sefer_name: "בראשית".to_string(),
        perakim: vec![perek_input(2, vec![("n".into(), "a".into(), html.into())])],
        include_cover: false,
        include_toc: false,
        cover_accent_hex: String::new(),
        cover_text: pdf::PdfCoverText::default(),
    };
    assert!(pdf::build_pdf(&req, &fonts_dir()).is_ok());
}
