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

--
-- Shared reading-unit contract (version 1) — see docs/data/reading-units.md
--

-- Reading divisions: each division slices the canonical pesukim corpus
-- into ordered units behind its own route root and menu label.
DROP TABLE IF EXISTS tanah_reading_division;
CREATE TABLE tanah_reading_division (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL,
  root_path TEXT NOT NULL,
  menu_label TEXT NOT NULL
);

-- Reading units: the addressable entry inside a division. unit_id is a
-- stable id contiguous within the division; unit_order is the 1-based
-- order inside the parent sefer; closing_break records the Masoretic
-- break that ends the unit (NULL when closed by the sefer end).
DROP TABLE IF EXISTS tanah_reading_unit;
CREATE TABLE tanah_reading_unit (
  division_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  sefer_id INTEGER NOT NULL,
  unit_order INTEGER NOT NULL,
  heading TEXT NOT NULL,
  closing_break TEXT CHECK (closing_break IS NULL OR closing_break IN ('ptuha', 'stuma')),
  PRIMARY KEY (division_id, unit_id),
  FOREIGN KEY (division_id) REFERENCES tanah_reading_division (id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (sefer_id) REFERENCES tanah_sefer (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Reading-unit ranges: inclusive canonical scripture bounds for each
-- unit. Primary ranges have auxiliary_* NULL and range_index ordering
-- the unit's range list; auxiliary readings (e.g. Haftarah) carry
-- auxiliary_ordinal (order within the unit's auxiliary list),
-- auxiliary_id and auxiliary_label, with range_index ordering that
-- auxiliary's own range list. segment_index columns are 0-based segment
-- bounds for intra-pasuk Masoretic breaks (NULL = whole-pasuk edge).
DROP TABLE IF EXISTS tanah_reading_unit_range;
CREATE TABLE tanah_reading_unit_range (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  range_index INTEGER NOT NULL,
  auxiliary_ordinal INTEGER,
  auxiliary_id TEXT,
  auxiliary_label TEXT,
  start_perek_id INTEGER NOT NULL,
  start_pasuk INTEGER NOT NULL,
  start_segment_index INTEGER,
  end_perek_id INTEGER NOT NULL,
  end_pasuk INTEGER NOT NULL,
  end_segment_index INTEGER,
  FOREIGN KEY (division_id, unit_id) REFERENCES tanah_reading_unit (division_id, unit_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Aliyah boundary schemes: a named split/custom that can be applied to
-- a reading context (e.g. Shabbat seven-aliyah + maftir, weekday
-- three-aliyah). Named so additional customs/variants can coexist
-- instead of one hardcoded split.
DROP TABLE IF EXISTS tanah_parasha_aliyah_scheme;
CREATE TABLE tanah_parasha_aliyah_scheme (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  scheme_order INTEGER NOT NULL
);

-- Parasha reading contexts: the stable identity a boundary set belongs
-- to. 'standalone' contexts compose one parasha unit; 'joined' contexts
-- compose two in reading order without merging unit identities.
-- applicability records where the context applies (NULL = everywhere);
-- חוקת-בלק joins only in חוץ לארץ, so its row names the restriction.
DROP TABLE IF EXISTS tanah_parasha_reading;
CREATE TABLE tanah_parasha_reading (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('standalone', 'joined')),
  sefer_id INTEGER NOT NULL,
  applicability TEXT,
  FOREIGN KEY (sefer_id) REFERENCES tanah_sefer (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Constituent units of a reading context, in reading order.
DROP TABLE IF EXISTS tanah_parasha_reading_unit;
CREATE TABLE tanah_parasha_reading_unit (
  reading_id TEXT NOT NULL,
  unit_position INTEGER NOT NULL,
  division_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL,
  PRIMARY KEY (reading_id, unit_position),
  UNIQUE (reading_id, unit_id),
  FOREIGN KEY (reading_id) REFERENCES tanah_parasha_reading (id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (division_id, unit_id) REFERENCES tanah_reading_unit (division_id, unit_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Aliyah boundaries: inclusive canonical start/end coordinates for each
-- aliyah of a (reading, scheme) pair. role distinguishes the repeated
-- maftir reading from the seven regular aliyot. A single aliyah may
-- cross a perek boundary; coincident chapter/aliyah edges are
-- render-time concerns, not stored deduplication.
DROP TABLE IF EXISTS tanah_parasha_aliyah;
CREATE TABLE tanah_parasha_aliyah (
  reading_id TEXT NOT NULL,
  scheme_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('aliyah', 'maftir')),
  label TEXT NOT NULL,
  start_perek_id INTEGER NOT NULL,
  start_pasuk INTEGER NOT NULL,
  end_perek_id INTEGER NOT NULL,
  end_pasuk INTEGER NOT NULL,
  PRIMARY KEY (reading_id, scheme_id, ordinal),
  FOREIGN KEY (reading_id) REFERENCES tanah_parasha_reading (id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (scheme_id) REFERENCES tanah_parasha_aliyah_scheme (id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Alternative divisions of a single aliyah — a different minhag's
-- boundary for the same stretch (e.g. חב"ד's ויגש, עדות המזרח's מסעי).
-- custom names the tradition when the source attributes one (NULL =
-- unattributed recorded split); source records which curated upstream
-- carries the division.
DROP TABLE IF EXISTS tanah_parasha_aliyah_alternative;
CREATE TABLE tanah_parasha_aliyah_alternative (
  reading_id TEXT NOT NULL,
  scheme_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  alternative INTEGER NOT NULL,
  start_perek_id INTEGER NOT NULL,
  start_pasuk INTEGER NOT NULL,
  end_perek_id INTEGER NOT NULL,
  end_pasuk INTEGER NOT NULL,
  custom TEXT,
  source TEXT,
  PRIMARY KEY (reading_id, scheme_id, ordinal, alternative),
  FOREIGN KEY (reading_id, scheme_id, ordinal)
    REFERENCES tanah_parasha_aliyah (reading_id, scheme_id, ordinal)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Provenance of the imported aliyah dataset: where the boundaries came
-- from, under which license, pinned to which upstream revision, and
-- when it was taken — a single row per imported source.
DROP TABLE IF EXISTS tanah_parasha_aliyah_source;
CREATE TABLE tanah_parasha_aliyah_source (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  repository TEXT NOT NULL,
  license TEXT NOT NULL,
  upstream_commit TEXT NOT NULL,
  retrieved TEXT NOT NULL
);