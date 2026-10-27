-- Initial dedication records for issue #2731.
--
-- Authoritative production content applied through the data-deploy path (not
-- the Rust populator and not GUI fixtures). Every statement is repeat-safe:
-- dedication rows are guarded by subject, purpose types by description, and
-- link rows by their primary keys, so re-running on every deploy is a no-op.
-- Pre-existing dedication rows, purposes and assignments are preserved.
--
-- Removing one of these records permanently means deleting it via admin AND
-- removing its block here, otherwise the next deploy reseeds it (same seed
-- semantics as tanahpedia_seed_data.sql).
--
-- Canonical sefer ids come from tanah_sefarim_and_perakim_data.sql:
--   בראשית 1, שופטים 7, מלאכי 24, תהילים 25, שיר השירים 28.
-- Each sefer link insert also checks the sefer name so a drifted id can never
-- point a production dedication at the wrong sefer.
--
-- Comment lines stay free of semicolons and apostrophes for the deploy
-- Lambda statement splitter.

-- ---------------------------------------------------------------------------
-- Purpose types: ensure the three needed descriptions exist, creating any
-- missing one after the current max id.
-- ---------------------------------------------------------------------------

SET @dedicationTypeId := (
    SELECT COALESCE(MAX(id), 0) + 1 FROM tanah_dedication_type
);
INSERT INTO tanah_dedication_type (id, description)
SELECT @dedicationTypeId, 'לע"נ' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication_type WHERE description = 'לע"נ'
);

SET @dedicationTypeId := (
    SELECT COALESCE(MAX(id), 0) + 1 FROM tanah_dedication_type
);
INSERT INTO tanah_dedication_type (id, description)
SELECT @dedicationTypeId, 'רפואה שלימה' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication_type WHERE description = 'רפואה שלימה'
);

SET @dedicationTypeId := (
    SELECT COALESCE(MAX(id), 0) + 1 FROM tanah_dedication_type
);
INSERT INTO tanah_dedication_type (id, description)
SELECT @dedicationTypeId, 'לרפואה' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication_type WHERE description = 'לרפואה'
);

-- ---------------------------------------------------------------------------
-- מרדכי בן זאב — לע"נ — מלאכי
-- ---------------------------------------------------------------------------

INSERT INTO tanah_dedication (subject)
SELECT 'מרדכי בן זאב' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication WHERE subject = 'מרדכי בן זאב'
);
SET @dedicationId := (
    SELECT MIN(id) FROM tanah_dedication WHERE subject = 'מרדכי בן זאב'
);
INSERT IGNORE INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id)
SELECT @dedicationId, dt.id FROM tanah_dedication_type dt
WHERE dt.description = 'לע"נ' AND @dedicationId IS NOT NULL;
INSERT IGNORE INTO tanah_sefer_dedication (sefer_id, dedication_id)
SELECT 24, @dedicationId FROM DUAL
WHERE @dedicationId IS NOT NULL
  AND EXISTS (SELECT 1 FROM tanah_sefer WHERE id = 24 AND name = 'מלאכי');

-- ---------------------------------------------------------------------------
-- יעל בת רחל — לע"נ — שופטים
-- ---------------------------------------------------------------------------

INSERT INTO tanah_dedication (subject)
SELECT 'יעל בת רחל' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication WHERE subject = 'יעל בת רחל'
);
SET @dedicationId := (
    SELECT MIN(id) FROM tanah_dedication WHERE subject = 'יעל בת רחל'
);
INSERT IGNORE INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id)
SELECT @dedicationId, dt.id FROM tanah_dedication_type dt
WHERE dt.description = 'לע"נ' AND @dedicationId IS NOT NULL;
INSERT IGNORE INTO tanah_sefer_dedication (sefer_id, dedication_id)
SELECT 7, @dedicationId FROM DUAL
WHERE @dedicationId IS NOT NULL
  AND EXISTS (SELECT 1 FROM tanah_sefer WHERE id = 7 AND name = 'שופטים');

-- ---------------------------------------------------------------------------
-- מזל בת רחל — רפואה שלימה — תהילים
-- ---------------------------------------------------------------------------

INSERT INTO tanah_dedication (subject)
SELECT 'מזל בת רחל' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication WHERE subject = 'מזל בת רחל'
);
SET @dedicationId := (
    SELECT MIN(id) FROM tanah_dedication WHERE subject = 'מזל בת רחל'
);
INSERT IGNORE INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id)
SELECT @dedicationId, dt.id FROM tanah_dedication_type dt
WHERE dt.description = 'רפואה שלימה' AND @dedicationId IS NOT NULL;
INSERT IGNORE INTO tanah_sefer_dedication (sefer_id, dedication_id)
SELECT 25, @dedicationId FROM DUAL
WHERE @dedicationId IS NOT NULL
  AND EXISTS (SELECT 1 FROM tanah_sefer WHERE id = 25 AND name = 'תהילים');

-- ---------------------------------------------------------------------------
-- עלושה בת גֿזלה — לע"נ — שיר השירים
-- ---------------------------------------------------------------------------

INSERT INTO tanah_dedication (subject)
SELECT 'עלושה בת גֿזלה' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication WHERE subject = 'עלושה בת גֿזלה'
);
SET @dedicationId := (
    SELECT MIN(id) FROM tanah_dedication WHERE subject = 'עלושה בת גֿזלה'
);
INSERT IGNORE INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id)
SELECT @dedicationId, dt.id FROM tanah_dedication_type dt
WHERE dt.description = 'לע"נ' AND @dedicationId IS NOT NULL;
INSERT IGNORE INTO tanah_sefer_dedication (sefer_id, dedication_id)
SELECT 28, @dedicationId FROM DUAL
WHERE @dedicationId IS NOT NULL
  AND EXISTS (SELECT 1 FROM tanah_sefer WHERE id = 28 AND name = 'שיר השירים');

-- ---------------------------------------------------------------------------
-- ראובן בן יקוט — לרפואה — בראשית
-- ---------------------------------------------------------------------------

INSERT INTO tanah_dedication (subject)
SELECT 'ראובן בן יקוט' FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM tanah_dedication WHERE subject = 'ראובן בן יקוט'
);
SET @dedicationId := (
    SELECT MIN(id) FROM tanah_dedication WHERE subject = 'ראובן בן יקוט'
);
INSERT IGNORE INTO tanah_dedication_dedication_type (dedication_id, dedication_type_id)
SELECT @dedicationId, dt.id FROM tanah_dedication_type dt
WHERE dt.description = 'לרפואה' AND @dedicationId IS NOT NULL;
INSERT IGNORE INTO tanah_sefer_dedication (sefer_id, dedication_id)
SELECT 1, @dedicationId FROM DUAL
WHERE @dedicationId IS NOT NULL
  AND EXISTS (SELECT 1 FROM tanah_sefer WHERE id = 1 AND name = 'בראשית');
