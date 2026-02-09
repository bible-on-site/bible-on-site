-- SQLite schema for perushim catalog (small, bundled with app)
-- Contains commentator and commentary metadata only — no text content.
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
-- Table structure for table parshan (commentator)
-- Similar to the author entity — static, small
--
DROP TABLE IF EXISTS parshan;
CREATE TABLE parshan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  -- Primary Hebrew name of the commentator
  birth_year INTEGER,
  -- When known (e.g. from Sefaria person)
  has_pic INTEGER NOT NULL DEFAULT 0
);
--
-- Table structure for table perush (commentary work)
-- A named commentary, linked to a parshan. One perush may span multiple sefarim.
--
DROP TABLE IF EXISTS perush;
CREATE TABLE perush (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  -- Hebrew display name (e.g., רש"י, אבן עזרא)
  parshan_id INTEGER NOT NULL,
  comp_date TEXT,
  -- Composition date (as-is from Sefaria)
  pub_date TEXT,
  -- Publication date
  priority INTEGER NOT NULL DEFAULT 0,
  -- Display order (lower = first)
  -- 0-99: Targum variants (chronological)
  -- 100: Rashi
  -- 200+: Others (chronological)
  FOREIGN KEY (parshan_id) REFERENCES parshan(id) ON DELETE CASCADE ON UPDATE CASCADE
);