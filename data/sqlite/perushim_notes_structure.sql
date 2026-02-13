-- SQLite schema for perushim notes (large, delivered via PAD or on-demand download)
-- Contains the actual commentary text, one row per note per pasuk.
-- Matches the legacy tanah_note schema pattern.

PRAGMA foreign_keys = ON;

--
-- Table structure for table _metadata
--

DROP TABLE IF EXISTS _metadata;
CREATE TABLE _metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

--
-- Table structure for table note
-- Each row is one commentary phrase for a specific pasuk.
-- Modeled after legacy tanah_note: (perush_id, perek_id, pasuk, note_idx, note_content)
--

DROP TABLE IF EXISTS note;
CREATE TABLE note (
  perush_id INTEGER NOT NULL,   -- References perush.id from catalog
  perek_id INTEGER NOT NULL,    -- 929 global perek numbering (matches tanah_perek.id)
  pasuk INTEGER NOT NULL,       -- 1-indexed pasuk within the perek
  note_idx INTEGER NOT NULL,    -- 0-indexed note within the pasuk (for multi-note perushim)
  note_content TEXT NOT NULL,   -- The actual commentary text (HTML)
  PRIMARY KEY (perush_id, perek_id, pasuk, note_idx)
);
