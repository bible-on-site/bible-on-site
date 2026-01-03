-- SQLite schema for tanah database

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
-- Table structure for table tanah_helek
--

DROP TABLE IF EXISTS tanah_helek;
CREATE TABLE tanah_helek (
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sefer_id_from INTEGER NOT NULL,
  sefer_id_to INTEGER NOT NULL,
  PRIMARY KEY (id)
);

--
-- Table structure for table tanah_sefer
--

DROP TABLE IF EXISTS tanah_sefer;
CREATE TABLE tanah_sefer (
  id INTEGER NOT NULL,
  name TEXT,
  tanach_us_name TEXT,
  perek_id_from INTEGER NOT NULL,
  perek_id_to INTEGER NOT NULL,
  PRIMARY KEY (id)
);

--
-- Table structure for table tanah_additional
--

DROP TABLE IF EXISTS tanah_additional;
CREATE TABLE tanah_additional (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sefer_id INTEGER NOT NULL,
  letter TEXT NOT NULL,
  tanach_us_name TEXT NOT NULL,
  perek_from INTEGER NOT NULL,
  perek_to INTEGER NOT NULL,
  FOREIGN KEY (sefer_id) REFERENCES tanah_sefer (id) ON DELETE CASCADE ON UPDATE CASCADE
);

--
-- Table structure for table tanah_perek
--

DROP TABLE IF EXISTS tanah_perek;
CREATE TABLE tanah_perek (
  id INTEGER NOT NULL,
  perek INTEGER,
  header TEXT,
  PRIMARY KEY (id)
);

--
-- Table structure for table tanah_perek_date
--

DROP TABLE IF EXISTS tanah_perek_date;
CREATE TABLE tanah_perek_date (
  perek_id INTEGER NOT NULL,
  cycle INTEGER NOT NULL,
  date TEXT NOT NULL,
  hebdate TEXT NOT NULL,
  star_rise TEXT NOT NULL,
  PRIMARY KEY (perek_id, cycle),
  FOREIGN KEY (perek_id) REFERENCES tanah_perek (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Table structure for table tanah_pasuk_segment

DROP TABLE IF EXISTS tanah_pasuk_segment;
CREATE TABLE tanah_pasuk_segment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sefer_id INTEGER NOT NULL,
  perek_id INTEGER NOT NULL,
  pasuk_id INTEGER NOT NULL,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('ktiv', 'qri', 'ptuha', 'stuma')),
  FOREIGN KEY (sefer_id) REFERENCES tanah_sefer (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Segment subtables (one-to-one relationship with tanah_pasuk_segment)

-- Offset to paired segment (see docs/data/ktiv-qri.md for full documentation)
-- For ktiv: offset to matching qri (usually +1, but -1 if qri precedes ktiv after makaf)
-- For qri: offset to matching ktiv (usually -1, but +1 if qri precedes ktiv after makaf)
-- Value 0 indicates orphan segment: כתיב ולא קרי (ktiv with no qri) or קרי ולא כתיב (qri with no ktiv)
-- Regular text (קרי וכתיב where ktiv=qri) has no entry in this table
DROP TABLE IF EXISTS tanah_pasuk_segment_qri_ktiv_offset;
CREATE TABLE tanah_pasuk_segment_qri_ktiv_offset (
  id INTEGER PRIMARY KEY,
  qri_ktiv_offset INTEGER NOT NULL,
  FOREIGN KEY (id) REFERENCES tanah_pasuk_segment (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Value for ktiv and qri segments
DROP TABLE IF EXISTS tanah_pasuk_segment_value;
CREATE TABLE tanah_pasuk_segment_value (
  id INTEGER PRIMARY KEY,
  value TEXT NOT NULL,
  FOREIGN KEY (id) REFERENCES tanah_pasuk_segment (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- qri: vocalized text that differs from ktiv (appears after ktiv segment)
DROP TABLE IF EXISTS tanah_pasuk_segment_recording_time_frame;
CREATE TABLE tanah_pasuk_segment_recording_time_frame (
  id INTEGER PRIMARY KEY,
  recording_time_frame_from TEXT NOT NULL DEFAULT '00:00:00',
  recording_time_frame_to TEXT NOT NULL DEFAULT '00:00:00',
  FOREIGN KEY (id) REFERENCES tanah_pasuk_segment (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ptuha and stuma segments have no additional fields (just the segment_type in tanah_pasuk_segment)