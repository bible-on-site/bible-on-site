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

    // Citation recognition uses a client-safe projection. Generate it from the
    // same catalog so newly added/removed works cannot leave this list stale.
    let names_path = perushim_path
        .parent()
        .unwrap()
        .join(if output_to_dependant_modules {
            "perush-names.ts".to_string()
        } else {
            format!("{dump_name}.perush-names.ts")
        });
    let mut names: Vec<&str> = extracted.perushim.iter().map(|p| p.name.as_str()).collect();
    names.sort_by(|a, b| {
        b.chars()
            .count()
            .cmp(&a.chars().count())
            .then_with(|| a.cmp(b))
    });
    fs::write(
        names_path,
        format!(
            "/** Generated client-safe names-only projection of the perushim catalog. */\nexport const perushNames = {} as const;\n",
            serde_json::to_string_pretty(&names)?
        ),
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::extract::{Extracted, Note, Parshan, Perush};

    fn sample_extracted() -> Extracted {
        Extracted {
            parshanim: vec![
                Parshan {
                    id: 1,
                    name: "Rashi".to_string(),
                    birth_year: Some(1040),
                    has_pic: true,
                },
                Parshan {
                    id: 2,
                    name: "Unknown".to_string(),
                    birth_year: None,
                    has_pic: false,
                },
            ],
            perushim: vec![
                Perush {
                    id: 10,
                    name: "Commentary One".to_string(),
                    parshan_id: 1,
                    comp_date: Some("1100".to_string()),
                    pub_date: None,
                    priority: 20,
                },
                Perush {
                    id: 11,
                    name: "Commentary Two".to_string(),
                    parshan_id: 2,
                    comp_date: None,
                    pub_date: Some("1200".to_string()),
                    priority: 30,
                },
            ],
            notes: vec![Note {
                perush_id: 10,
                perek_id: 1,
                pasuk: 1,
                note_idx: 0,
                note_content: "ignored by json command".to_string(),
            }],
        }
    }

    #[test]
    fn generate_writes_parshanim_and_perushim_json_with_optional_fields() {
        let dump_name = format!("test-dump-{}", std::process::id());
        let output_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output");
        let parshanim_path = output_dir.join(format!("{dump_name}.parshanim.json"));
        let perushim_path = output_dir.join(format!("{dump_name}.perushim.json"));
        let names_path = output_dir.join(format!("{dump_name}.perush-names.ts"));
        let _ = fs::remove_file(&parshanim_path);
        let _ = fs::remove_file(&perushim_path);

        generate(&sample_extracted(), &dump_name, false).unwrap();

        let parshanim: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&parshanim_path).unwrap()).unwrap();
        assert_eq!(parshanim[0]["id"], 1);
        assert_eq!(parshanim[0]["birthYear"], 1040);
        assert_eq!(parshanim[0]["hasPic"], true);
        assert!(parshanim[1].get("birthYear").is_none());

        let perushim: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&perushim_path).unwrap()).unwrap();
        assert_eq!(perushim[0]["parshanId"], 1);
        assert_eq!(perushim[0]["compDate"], "1100");
        assert!(perushim[0].get("pubDate").is_none());
        assert_eq!(perushim[1]["pubDate"], "1200");

        let names = fs::read_to_string(&names_path).unwrap();
        assert!(names.contains("export const perushNames ="));
        for p in sample_extracted().perushim {
            assert!(names.contains(&serde_json::to_string(&p.name).unwrap()));
        }

        let _ = fs::remove_file(parshanim_path);
        let _ = fs::remove_file(perushim_path);
        let _ = fs::remove_file(names_path);
    }
}
