//! Build-time staging for the shared brand fonts and the perek corpus.
//!
//! `web/shared/branding/fonts/` is the single canonical copy of the Al
//! Heperek binaries (#3708); the renderer's FONTS_DIR contract still expects
//! one local directory, so the TTFs and license are staged into `fonts/`
//! here. The embedded `data/tanach-text.json` is generated from the pinned
//! website corpus by `scripts/extract-tanach-text.mjs` (#3709): a normal
//! checkout has that corpus on disk so this script runs Node, while the
//! Lambda image regenerates the file in a Node stage and never ships Node
//! into the Rust build stage.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    stage_brand_fonts(&manifest);
    ensure_tanach_text(&manifest);
}

/// Copies the shared Al Heperek TTFs and license into the local `fonts/`
/// dir the renderer, the PDF tests and the Lambda zip keep consuming.
fn stage_brand_fonts(manifest: &Path) {
    let shared_fonts = manifest.join("../shared/branding/fonts");
    println!("cargo:rerun-if-changed={}", shared_fonts.display());
    let fonts_dir = manifest.join("fonts");
    fs::create_dir_all(&fonts_dir).unwrap();
    for entry in fs::read_dir(&shared_fonts).unwrap_or_else(|error| {
        panic!(
            "Cannot read shared brand fonts {}: {error}",
            shared_fonts.display()
        )
    }) {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        // The renderer, the PDF tests and the Lambda zip consume TTFs and
        // the license only — the shared WOFF2 webfonts have no consumer here.
        if !name.starts_with("AlHeperek") || name.ends_with(".woff2") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let destination = fonts_dir.join(&name);
        let bytes = fs::read(&path).unwrap();
        if fs::read(&destination)
            .map(|current| current != bytes)
            .unwrap_or(true)
        {
            fs::write(&destination, &bytes).unwrap();
        }
    }
}

/// Regenerates `data/tanach-text.json` from the pinned corpus when it is on
/// disk; a pre-generated file satisfies builds without the corpus (Docker).
fn ensure_tanach_text(manifest: &Path) {
    let script = manifest.join("scripts/extract-tanach-text.mjs");
    let output = manifest.join("data/tanach-text.json");
    let db_dir = manifest.join("../bible-on-site/src/data/db");
    println!("cargo:rerun-if-changed={}", script.display());
    println!("cargo:rerun-if-changed={}", output.display());
    let corpora: Vec<PathBuf> = fs::read_dir(&db_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name().is_some_and(|name| {
                        let name = name.to_string_lossy();
                        name.starts_with("sefaria-dump-") && name.ends_with(".tanah_view.json")
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    for corpus in &corpora {
        println!("cargo:rerun-if-changed={}", corpus.display());
    }
    if !corpora.is_empty() {
        match Command::new("node").arg(&script).status() {
            Ok(status) if status.success() => {}
            Ok(status) => panic!("extract-tanach-text.mjs failed: {status}"),
            Err(error) => panic!(
                "Node cannot regenerate {} while the canonical corpus is present: {error}",
                output.display()
            ),
        }
    }
    assert!(
        output.exists(),
        "Missing {} — generated from the pinned website corpus; \
         run `node scripts/extract-tanach-text.mjs`",
        output.display()
    );
}
