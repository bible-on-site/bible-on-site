//! Shared primitives for explicitly reviewed source-to-verse dictionaries.

use super::perek_mapping;
use anyhow::{Context, Result, bail, ensure};
use bson::Bson;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(super) enum Anchor {
    One(String),
    Many(Vec<String>),
}

impl Anchor {
    pub(super) fn refs(&self) -> &[String] {
        match self {
            Self::One(reference) => std::slice::from_ref(reference),
            Self::Many(references) => references,
        }
    }
}

// FNV-1a over typed string/array tokens. This is a reproducible source-change
// detector, not a security primitive. Delimiters also detect resegmentation.
pub(super) fn fingerprint(value: &Bson, hash: &mut u64) -> Result<()> {
    fn feed(hash: &mut u64, bytes: &[u8]) {
        for byte in bytes {
            *hash = (*hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    }
    match value {
        Bson::String(text) => {
            feed(hash, b"s");
            feed(hash, text.as_bytes());
            feed(hash, &[0xff]);
        }
        Bson::Array(items) => {
            feed(hash, b"[");
            for item in items {
                fingerprint(item, hash)?;
            }
            feed(hash, b"]");
        }
        _ => bail!("Unsupported mapped source text type"),
    }
    Ok(())
}

pub(super) fn resolve_ref(
    reference: &str,
    counts: &BTreeMap<String, Vec<usize>>,
) -> Result<(i64, i64)> {
    let (book, coordinate) = reference
        .rsplit_once(' ')
        .context("Expected Book chapter:verse")?;
    let (chapter, verse) = coordinate
        .split_once(':')
        .context("Expected chapter:verse")?;
    let chapter: usize = chapter.parse()?;
    let verse: usize = verse.parse()?;
    let chapters = counts.get(book).context("Unknown Tanakh book")?;
    ensure!(
        chapter > 0 && chapter <= chapters.len(),
        "Invalid chapter in {reference}"
    );
    ensure!(
        verse > 0 && verse <= chapters[chapter - 1],
        "Invalid verse in {reference}"
    );
    let (sefer, additional) =
        perek_mapping::english_node_key_to_sefer(book).context("Unknown book mapping")?;
    Ok((
        perek_mapping::first_perek_id(sefer, additional) + chapter as i64 - 1,
        verse as i64,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::bson;

    #[test]
    fn source_fingerprints_reject_non_text_values_instead_of_coercing_them() {
        for source in [
            bson!(null),
            bson!(false),
            bson!(1),
            bson!({"text": "body"}),
            bson!(["body", 1]),
        ] {
            let error = fingerprint(&source, &mut 0xcbf29ce484222325).unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("Unsupported mapped source text type")
            );
        }
    }
}
