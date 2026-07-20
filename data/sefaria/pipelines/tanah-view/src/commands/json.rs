//! Generate JSON output from MongoDB aggregation.

use anyhow::Result;
use std::fs;
use std::path::Path;

use crate::models::Sefer;

pub fn generate(
    sefarim: &[Sefer],
    dump_name: &str,
    output_to_dependant_modules: bool,
) -> Result<()> {
    let output_path = if output_to_dependant_modules {
        // Output to web/bible-on-site/src/data/db/
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../web/bible-on-site/src/data/db")
            .join(format!("{}.tanah_view.json", dump_name))
    } else {
        let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&outputs_dir)?;
        outputs_dir.join(format!("{}.tanah_view.json", dump_name))
    };

    // JSON files don't support comments, so we don't add the generation header
    // The file will be imported directly by TypeScript
    let json = serde_json::to_string_pretty(&sefarim)?;
    fs::write(&output_path, json)?;
    println!("📁 Written to: {}", output_path.display());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Pasuk, Perek, Sefer, Segment};

    fn sample_sefarim() -> Vec<Sefer> {
        vec![Sefer {
            id: "book-a".to_string(),
            name: "Book A".to_string(),
            tanach_us_name: Some("BookA".to_string()),
            helek: "Torah".to_string(),
            pesukim_count: 1,
            perek_from: 1,
            perek_to: 1,
            additionals: None,
            perakim: Some(vec![Perek {
                perek_id: 1,
                header: "Header".to_string(),
                date: vec![57750329],
                star_rise: vec!["05:30".to_string()],
                pesukim: vec![Pasuk {
                    segments: vec![Segment {
                        value: Some("word".to_string()),
                        segment_type: "qri".to_string(),
                        recording_time_frame: None,
                        ktiv_offset: None,
                        qri_offset: None,
                    }],
                }],
            }]),
        }]
    }

    #[test]
    fn generate_writes_pretty_tanah_view_json() {
        let dump_name = format!("test-tanah-dump-{}", std::process::id());
        let output_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(".output")
            .join(format!("{dump_name}.tanah_view.json"));
        let _ = fs::remove_file(&output_path);

        generate(&sample_sefarim(), &dump_name, false).unwrap();

        let json = fs::read_to_string(&output_path).unwrap();
        assert!(json.contains("\"name\": \"Book A\""));
        assert!(json.contains("\"perekId\": 1"));
        assert!(json.contains("\"type\": \"qri\""));
        assert!(json.contains('\n'));

        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed[0]["perakim"][0]["pesukim"][0]["segments"][0]["value"],
            "word"
        );

        let _ = fs::remove_file(output_path);
    }
}
