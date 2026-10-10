//! Binary blob format for per-perek commentary notes ("PNB1").
//!
//! One `note_blob.data` row carries every note of a single perek:
//! 4-byte magic `PNB1`, a u32 record count, then per record
//! `perush_id`, `pasuk`, `note_idx`, utf-8 byte length and content —
//! all little-endian — the whole buffer zlib-compressed.
//! Readers: `app/BibleOnSite/Helpers/PerushNoteBlob.cs`.

use anyhow::{Context, Result};
use flate2::Compression;
use flate2::write::ZlibEncoder;
use std::io::Write;

use crate::data::extract::Note;

/// Blob format magic: "PNB1" (perushim note blob, version 1).
pub const BLOB_MAGIC: &[u8; 4] = b"PNB1";

/// Current schema generation stored in `_metadata.schema_version`.
pub const SCHEMA_VERSION: &str = "2";

/// Encodes one perek's notes into a compressed PNB1 blob.
/// `notes` must already be ordered by (pasuk, perush_id, note_idx).
pub fn encode_perek_blob(notes: &[&Note]) -> Result<Vec<u8>> {
    let mut raw = Vec::with_capacity(64 * 1024);
    raw.extend_from_slice(BLOB_MAGIC);
    raw.extend_from_slice(&(notes.len() as u32).to_le_bytes());
    for note in notes {
        let content = note.note_content.as_bytes();
        raw.extend_from_slice(&(note.perush_id as u32).to_le_bytes());
        raw.extend_from_slice(&(note.pasuk as u32).to_le_bytes());
        raw.extend_from_slice(&(note.note_idx as u32).to_le_bytes());
        raw.extend_from_slice(&(content.len() as u32).to_le_bytes());
        raw.extend_from_slice(content);
    }

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&raw)?;
    encoder
        .finish()
        .context("failed to finish note blob zlib stream")
}

/// Decoded note record; used by the v1→v2 converter's self-check and tests.
#[derive(Debug, PartialEq, Eq)]
pub struct DecodedNote {
    pub perush_id: i64,
    pub pasuk: i64,
    pub note_idx: i64,
    pub content: String,
}

/// Decodes a PNB1 blob back into note records.
pub fn decode_perek_blob(blob: &[u8]) -> Result<Vec<DecodedNote>> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    let mut raw = Vec::new();
    ZlibDecoder::new(blob)
        .read_to_end(&mut raw)
        .context("invalid zlib stream in note blob")?;

    let mut cursor: &[u8] = &raw;
    let take_u32 = |cursor: &mut &[u8]| -> Result<u32> {
        let (head, tail) = cursor
            .split_first_chunk::<4>()
            .context("truncated note blob record")?;
        *cursor = tail;
        Ok(u32::from_le_bytes(*head))
    };

    anyhow::ensure!(
        cursor.len() >= 4 && &cursor[..4] == BLOB_MAGIC,
        "bad note blob magic"
    );
    cursor = &cursor[4..];

    let count = take_u32(&mut cursor)? as usize;
    let mut notes = Vec::with_capacity(count);
    for _ in 0..count {
        let perush_id = take_u32(&mut cursor)?;
        let pasuk = take_u32(&mut cursor)?;
        let note_idx = take_u32(&mut cursor)?;
        let len = take_u32(&mut cursor)? as usize;
        let (content, tail) = cursor
            .split_at_checked(len)
            .context("truncated note blob content")?;
        cursor = tail;
        notes.push(DecodedNote {
            perush_id: perush_id as i64,
            pasuk: pasuk as i64,
            note_idx: note_idx as i64,
            content: String::from_utf8(content.to_vec()).context("non-utf8 note content")?,
        });
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(perush_id: i64, pasuk: i64, note_idx: i64, content: &str) -> Note {
        Note {
            perush_id,
            perek_id: 1,
            pasuk,
            note_idx,
            note_content: content.to_string(),
        }
    }

    #[test]
    fn encode_decode_roundtrips_notes_in_order() {
        let notes = [
            note(1, 1, 0, "בראשית - בשביל התורה"),
            note(2, 1, 0, "בראשית ברא - <b>הפועל</b>"),
            note(1, 2, 0, "והארץ היתה תהו"),
            note(1, 2, 1, "second index on same pasuk"),
        ];
        let refs: Vec<&Note> = notes.iter().collect();

        let blob = encode_perek_blob(&refs).unwrap();
        let decoded = decode_perek_blob(&blob).unwrap();

        let expected: Vec<DecodedNote> = notes
            .iter()
            .map(|n| DecodedNote {
                perush_id: n.perush_id,
                pasuk: n.pasuk,
                note_idx: n.note_idx,
                content: n.note_content.clone(),
            })
            .collect();
        assert_eq!(decoded, expected);
    }

    #[test]
    fn encode_empty_perek_still_decodes() {
        let decoded = decode_perek_blob(&encode_perek_blob(&[]).unwrap()).unwrap();
        assert!(decoded.is_empty());
    }

    #[test]
    fn decode_rejects_bad_magic_and_truncation() {
        assert!(decode_perek_blob(b"not a blob").is_err());

        let blob = encode_perek_blob(&[&note(1, 1, 0, "abc")]).unwrap();
        assert!(decode_perek_blob(&blob[..blob.len() / 2]).is_err());
    }
}
