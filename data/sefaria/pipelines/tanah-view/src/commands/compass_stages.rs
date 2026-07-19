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
    println!("📊 Generating MongoDB Compass stages...");

    // Build the aggregation pipeline with data from the data/ directory
    let data_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let pipeline = aggregation::build_pipeline(&data_root)?;

    // Clean and create output directory
    let outputs_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(".output/mongodb-compass-stages");
    if outputs_dir.exists() {
        fs::remove_dir_all(&outputs_dir)?;
    }
    fs::create_dir_all(&outputs_dir)?;

    // Stage names for file naming
    let stage_names = [
        "match",
        "lookup",
        "project",
        "setWindowFields",
        "set",
        "group",
        "replaceRoot",
        "sort",
        "project-final",
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

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{Bson, doc};

    #[test]
    fn bson_to_shell_format_formats_nested_documents_with_unquoted_keys() {
        let doc = doc! {
            "$project": {
                "name": "$title",
                "active": false,
                "rank": 3,
            }
        };

        let shell = bson_to_shell_format(&doc, 0);

        assert!(shell.contains("$project: {"));
        assert!(shell.contains("name: \"$title\""));
        assert!(shell.contains("active: false"));
        assert!(shell.contains("rank: 3"));
    }

    #[test]
    fn bson_value_to_shell_formats_arrays_and_escaped_strings() {
        let value = Bson::Array(vec![
            Bson::String("line\n\"quoted\"\\path".to_string()),
            Bson::Int32(7),
            Bson::Double(1.5),
            Bson::Null,
        ]);

        let shell = bson_value_to_shell(&value, 0);

        assert!(shell.starts_with("["));
        assert!(shell.contains("\"line\\n\\\"quoted\\\"\\\\path\""));
        assert!(shell.contains("7"));
        assert!(shell.contains("1.5"));
        assert!(shell.contains("null"));
    }

    #[test]
    fn bson_to_shell_format_handles_empty_documents_and_unknown_values() {
        assert_eq!(bson_to_shell_format(&Document::new(), 0), "{}");
        assert!(bson_value_to_shell(&Bson::ObjectId(Default::default()), 0).contains("ObjectId"));
    }
}
