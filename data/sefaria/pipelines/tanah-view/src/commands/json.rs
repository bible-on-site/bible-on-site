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
