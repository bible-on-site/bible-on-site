//! Generate MongoDB Compass stages for debugging the aggregation pipeline.

use anyhow::Result;
use bson::Document;
use std::fs;
use std::path::Path;

use crate::aggregation;

/// Convert a BSON Document to MongoDB Shell format (unquoted keys, like Compass expects)
fn bson_to_shell_format(doc: &Document, indent: usize) -> String {
    let indent_str = "  ".repeat(indent);
    let inner_indent = "  ".repeat(indent + 1);

    let mut parts: Vec<String> = Vec::new();

    for (key, value) in doc.iter() {
        let formatted_value = bson_value_to_shell(value, indent + 1);
        parts.push(format!("{}{}: {}", inner_indent, key, formatted_value));
    }

    if parts.is_empty() {
        "{}".to_string()
    } else {
        format!("{{\n{}\n{}}}", parts.join(",\n"), indent_str)
    }
}

fn bson_value_to_shell(value: &bson::Bson, indent: usize) -> String {
    use bson::Bson;

    match value {
        Bson::Document(doc) => bson_to_shell_format(doc, indent),
        Bson::Array(arr) => {
            if arr.is_empty() {
                "[]".to_string()
            } else {
                let indent_str = "  ".repeat(indent);
                let inner_indent = "  ".repeat(indent + 1);
                let items: Vec<String> = arr
                    .iter()
                    .map(|v| format!("{}{}", inner_indent, bson_value_to_shell(v, indent + 1)))
                    .collect();
                format!("[\n{}\n{}]", items.join(",\n"), indent_str)
            }
        }
        Bson::String(s) => format!(
            "\"{}\"",
            s.replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
        ),
        Bson::Int32(n) => n.to_string(),
        Bson::Int64(n) => n.to_string(),
        Bson::Double(n) => n.to_string(),
        Bson::Boolean(b) => b.to_string(),
        Bson::Null => "null".to_string(),
        _ => format!("{:?}", value),
    }
}

pub fn generate() -> Result<()> {
    println!("📊 Generating MongoDB Compass stages for perushim pipeline...");

    let pipeline = aggregation::build_pipeline();

    // Clean and create output directory
    let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output/mongodb-compass-stages");
    if outputs_dir.exists() {
        fs::remove_dir_all(&outputs_dir)?;
    }
    fs::create_dir_all(&outputs_dir)?;

    // Stage names for file naming
    let stage_names = [
        "match-index",
        "lookup-texts",
        "addFields-normalize-authors",
        "lookup-person",
        "project-initial",
        "project-name",
        "match-versions",
        "project-final",
        "sort",
    ];

    for (i, stage) in pipeline.iter().enumerate() {
        let stage_name = stage_names.get(i).unwrap_or(&"stage");
        let filename = format!("{:02}-{}.mongodb-compass-stage", i + 1, stage_name);
        let output_path = outputs_dir.join(&filename);

        // Get the stage operator (e.g., "$match", "$project")
        let stage_content = if let Some((op, inner)) = stage.iter().next() {
            if let bson::Bson::Document(inner_doc) = inner {
                format!(
                    "// Stage {}: {}\n{}",
                    i + 1,
                    op,
                    bson_to_shell_format(inner_doc, 0)
                )
            } else {
                format!(
                    "// Stage {}: {}\n{}",
                    i + 1,
                    op,
                    bson_value_to_shell(inner, 0)
                )
            }
        } else {
            bson_to_shell_format(stage, 0)
        };

        fs::write(&output_path, &stage_content)?;
        println!("  📄 {}", filename);
    }

    println!(
        "✅ Written {} stages to {}",
        pipeline.len(),
        outputs_dir.display()
    );

    Ok(())
}
