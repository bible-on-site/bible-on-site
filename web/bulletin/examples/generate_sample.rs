//! Generate a sample PDF to test quality.
//! Run: cargo run --example generate_sample

use std::fs;
use std::path::PathBuf;

// We need to inline the types since they're in the binary crate
mod inline {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GeneratePdfRequest {
        pub sefer_name: String,
        pub perakim: Vec<PerekInput>,
        pub include_perushim: bool,
        pub include_articles: bool,
        pub article_ids: Vec<i32>,
        pub author_ids: Vec<i32>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PerekInput {
        pub perek_id: i32,
        pub perek_heb: String,
        pub header: String,
        pub pesukim: Vec<String>,
    }
}

fn main() {
    let fonts_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts");

    // Load fonts
    let regular_bytes = fs::read(fonts_dir.join("FrankRuhlLibre-Regular.ttf")).unwrap();
    let bold_bytes = fs::read(fonts_dir.join("FrankRuhlLibre-Bold.ttf")).unwrap();

    let regular = genpdf::fonts::FontData::new(regular_bytes, None).unwrap();
    let bold = genpdf::fonts::FontData::new(bold_bytes, None).unwrap();

    let font_family = genpdf::fonts::FontFamily {
        regular: regular.clone(),
        bold: bold.clone(),
        italic: regular.clone(),
        bold_italic: bold.clone(),
    };

    let mut doc = genpdf::Document::new(font_family);
    doc.set_title("בראשית א — בריאת העולם");
    doc.set_paper_size(genpdf::PaperSize::A4);

    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(genpdf::Margins::trbl(20, 15, 20, 15));
    doc.set_page_decorator(decorator);

    // Helper: reverse graphemes for RTL
    fn rev(text: &str) -> String {
        use unicode_segmentation::UnicodeSegmentation;
        text.graphemes(true).rev().collect()
    }

    // Title
    doc.push(
        genpdf::elements::Paragraph::new("")
            .aligned(genpdf::Alignment::Center)
            .styled_string(
                rev("בראשית א — בריאת העולם"),
                genpdf::style::Style::new().bold().with_font_size(18),
            ),
    );
    doc.push(genpdf::elements::Break::new(1.0));

    // Section
    doc.push(
        genpdf::elements::Paragraph::new("")
            .aligned(genpdf::Alignment::Right)
            .styled_string(
                rev("הפרק"),
                genpdf::style::Style::new().bold().with_font_size(14),
            ),
    );
    doc.push(genpdf::elements::Break::new(0.5));

    // Sample pesukim
    let pesukim = [
        "א בראשית ברא אלהים את השמים ואת הארץ",
        "ב והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים",
        "ג ויאמר אלהים יהי אור ויהי אור",
        "ד וירא אלהים את האור כי טוב ויבדל אלהים בין האור ובין החשך",
        "ה ויקרא אלהים לאור יום ולחשך קרא לילה ויהי ערב ויהי בקר יום אחד",
    ];

    for pasuk in &pesukim {
        doc.push(
            genpdf::elements::Paragraph::new("")
                .aligned(genpdf::Alignment::Right)
                .styled_string(rev(pasuk), genpdf::style::Style::new().with_font_size(11)),
        );
    }

    // Render
    let output_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample_output.pdf");
    doc.render_to_file(&output_path).unwrap();

    println!("Sample PDF generated: {}", output_path.display());
    println!(
        "File size: {} bytes",
        fs::metadata(&output_path).unwrap().len()
    );
}
