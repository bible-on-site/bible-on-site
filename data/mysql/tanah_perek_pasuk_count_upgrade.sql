-- Canonical pasuk count per perek for issue #2189 (epic #2175 §3).
-- Existing scripture rows are retained. Safe to re-run on every deploy.
--
-- pasuk_count stores how many pesukim the canonical corpus holds for each
-- perek, so write paths (admin article covering-source editing) can validate
-- that a pasuk coordinate actually exists — MySQL has no per-row dynamic
-- CHECK. NULL means the bound was never filled — it is not "zero pesukim".
-- tanah_perek_pasuk_count_data.sql fills the value for all 929 perakim.
--
-- tanah_static_structure.sql already carries the column for fresh databases.
-- This guarded ALTER is for existing databases whose structure predates it.
SET @pasukCountUpgrade = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_perek'
           AND COLUMN_NAME = 'pasuk_count') > 0,
        'SELECT 1',
        'ALTER TABLE tanah_perek ADD COLUMN pasuk_count SMALLINT DEFAULT NULL'
    )
);
PREPARE pasukCountUpgrade FROM @pasukCountUpgrade;
EXECUTE pasukCountUpgrade;
DEALLOCATE PREPARE pasukCountUpgrade;

-- Readers (admin perakim, API Perek) select pasuk_count through
-- tanah_perek_view. On databases whose structure predates the column the
-- stale view would hide it, so the view is refreshed here too — a view
-- carries no data, recreating it is safe to re-run, and the definition is
-- the same one tanah_static_structure.sql ships for fresh databases.
DROP VIEW IF EXISTS tanah_perek_view;
CREATE VIEW tanah_perek_view AS
SELECT p.id,
    p.id AS perek_id,
    s.id AS sefer_id,
    s.name AS sefer_name,
    CASE
        WHEN a.id IS NOT NULL THEN a.id
        ELSE NULL
    END AS additional,
    a.letter AS additional_letter,
    p.perek,
    CASE
        WHEN a.id IS NOT NULL THEN p.id - a.perek_from + 1
        ELSE p.id - s.perek_id_from + 1
    END AS perek_in_context,
    pd.date,
    pd.hebdate,
    pd.star_rise AS tseit,
    p.header,
    p.pasuk_count
FROM tanah_perek p
    JOIN tanah_sefer s ON p.id BETWEEN s.perek_id_from AND s.perek_id_to
    LEFT JOIN tanah_perek_date pd ON pd.perek_id = p.id
    AND pd.cycle = (
        SELECT MAX(pd2.cycle)
        FROM tanah_perek_date pd2
        WHERE pd2.perek_id = p.id
            AND pd2.date <= CURRENT_DATE
    )
    LEFT JOIN tanah_additional a ON a.sefer_id = s.id
    AND p.id BETWEEN a.perek_from AND a.perek_to;
