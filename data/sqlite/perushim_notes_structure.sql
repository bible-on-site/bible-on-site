-- SQLite schema for perushim notes (large, delivered via PAD or on-demand download)
-- Contains the actual commentary text, one compressed blob per perek.
--
-- Schema version 2: notes are stored as zlib-compressed binary blobs keyed by
-- perek_id. The whole-perek read shape matches every consumer (inline reader,
-- commentary search import), so one blob lookup replaces hundreds of row reads
-- and cross-note redundancy compresses ~4x better than per-row storage.
-- The blob binary format is documented in
-- data/sefaria/pipelines/perushim-view/src/commands/note_blob.rs (writer) and
-- app/BibleOnSite/Helpers/PerushNoteBlob.cs (reader).

PRAGMA foreign_keys = ON;

--
-- Table structure for table _metadata
-- 'schema_version' = '2' marks the compressed-blob layout.
--

DROP TABLE IF EXISTS _metadata;
CREATE TABLE _metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

--
-- Table structure for table perek_perush
-- One row per (perek, perush) pair that has at least one note.
-- Replaces SELECT DISTINCT perush_id FROM note for the picker.
--

DROP TABLE IF EXISTS perek_perush;
CREATE TABLE perek_perush (
  perek_id INTEGER NOT NULL,    -- 929 global perek numbering (matches tanah_perek.id)
  perush_id INTEGER NOT NULL,   -- References perush.id from catalog
  PRIMARY KEY (perek_id, perush_id)
);

--
-- Table structure for table note_blob
-- One row per perek carrying every note of that perek as a compressed blob.
--

DROP TABLE IF EXISTS note_blob;
CREATE TABLE note_blob (
  perek_id INTEGER PRIMARY KEY, -- 929 global perek numbering (matches tanah_perek.id)
  data BLOB NOT NULL            -- PNB1 blob: zlib-compressed note records
);
