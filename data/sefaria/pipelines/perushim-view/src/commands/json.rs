//! Generate JSON files for parshan and perush entities (web frontend static data).
//!
//! Produces two JSON files:
//! - `parshanim.json` — Array of commentators
//! - `perushim.json` — Array of commentary works with parshan references

use anyhow::Result;
use std::fs;
use std::path::Path;

use crate::data::extract::Extracted;

pub fn generate(
    extracted: &Extracted,
    dump_name: &str,
    output_to_dependant_modules: bool,
) -> Result<()> {
    let (parshanim_path, perushim_path) = if output_to_dependant_modules {
        let web_db =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../web/bible-on-site/src/data/db");
        (
            web_db.join(format!("{}.parshanim.json", dump_name)),
            web_db.join(format!("{}.perushim.json", dump_name)),
        )
    } else {
        let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        fs::create_dir_all(&outputs_dir)?;
        (
            outputs_dir.join(format!("{}.parshanim.json", dump_name)),
            outputs_dir.join(format!("{}.perushim.json", dump_name)),
        )
    };

    // Generate parshanim JSON
    let parshanim_json: Vec<serde_json::Value> = extracted
        .parshanim
        .iter()
        .map(|p| {
            let mut obj = serde_json::json!({
                "id": p.id,
                "name": p.name,
                "hasPic": p.has_pic
            });
            if let Some(y) = p.birth_year {
                obj["birthYear"] = serde_json::json!(y);
            }
            obj
        })
        .collect();

    let json = serde_json::to_string_pretty(&parshanim_json)?;
    fs::write(&parshanim_path, json)?;
    println!("📁 Parshanim written to: {}", parshanim_path.display());

    // Generate perushim JSON
    let perushim_json: Vec<serde_json::Value> = extracted
        .perushim
        .iter()
        .map(|p| {
            let mut obj = serde_json::json!({
                "id": p.id,
                "name": p.name,
                "parshanId": p.parshan_id,
                "priority": p.priority
            });
            if let Some(cd) = &p.comp_date {
                obj["compDate"] = serde_json::json!(cd);
            }
            if let Some(pd) = &p.pub_date {
                obj["pubDate"] = serde_json::json!(pd);
            }
            obj
        })
        .collect();

    let json = serde_json::to_string_pretty(&perushim_json)?;
    fs::write(&perushim_path, json)?;
    println!("📁 Perushim written to: {}", perushim_path.display());

    Ok(())
}
