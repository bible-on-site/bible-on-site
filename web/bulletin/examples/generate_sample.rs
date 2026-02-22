//! Generate a sample PDF to test quality.
//! Run: cargo run --example generate_sample

use std::fs;
use std::path::PathBuf;

use bulletin::pdf;
use bulletin::tanach;

fn main() {
    let fonts_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts");

    // Use embedded Tanach data — Bereshit 1 (perekId = 1)
    let perek_data = tanach::get_perek(1).expect("perek 1 must exist");

    let req = pdf::PdfRequest {
        sefer_name: perek_data.sefer_name.clone(),
        perakim: vec![pdf::PdfPerekInput {
            perek_heb: tanach::perek_to_hebrew(perek_data.perek_in_sefer),
            header: perek_data.header.clone(),
            pesukim: perek_data.pesukim.clone(),
            articles: vec![(
                "מאמר לדוגמה".to_string(),
                "הרב ישראל".to_string(),
                "<p>תוכן המאמר כאן.</p><p>פסקה שנייה של <b>המאמר</b>.</p>".to_string(),
            )],
        }],
    };

    let pdf_bytes = pdf::build_pdf(&req, &fonts_dir).unwrap();

    let output_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample_output.pdf");
    fs::write(&output_path, &pdf_bytes).unwrap();

    println!("Sample PDF generated: {}", output_path.display());
    println!(
        "File size: {} bytes",
        fs::metadata(&output_path).unwrap().len()
    );
}
