-- Recurring Hebrew-date article overrides for issue #3098.
-- Existing articles and content are retained. Safe to re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy admin-authored assignments, so the
-- DDL below is built inside a string the rewriter cannot match (same idiom as
-- tanah_article_covering_source_upgrade.sql). Never write the creation keywords
-- literally in this file, including in comments.
--
-- Each row assigns one article to one recurring Hebrew {hebrew_month, hebrew_day}
-- pair (no Hebrew year — it recurs every Hebrew year on the literal date).
-- hebrew_month uses the uniform legacy numbering shared by the app, the
-- website and the bulletin: 1=Tishrei ... 12=Elul, 6=Adar of a non-leap year,
-- 13=Adar I and 14=Adar II (leap years only). An assignment to a month that a
-- given year does not have (e.g. 6 in a leap year, 13/14 in a non-leap year)
-- simply never matches that year — the mapping is literal and is not shifted
-- to observed holiday dates. The composite primary key guarantees at most one
-- article per recurring date, while an article may hold many assignments.
-- hebrew_day accepts up to 30 even for months that are always 29 days: the
-- write path validates against the real maximum of each month.
SET @articleHebrewDateSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_article_hebrew_date (
    article_id MEDIUMINT NOT NULL,
    hebrew_month TINYINT UNSIGNED NOT NULL COMMENT ''Uniform Hebrew month: 1=Tishrei..12=Elul, 13=Adar I, 14=Adar II'',
    hebrew_day TINYINT UNSIGNED NOT NULL COMMENT ''Day of the Hebrew month, 1-30'',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hebrew_month, hebrew_day),
    KEY idx_article_hebrew_date_article (article_id),
    CONSTRAINT fk_article_hebrew_date_article FOREIGN KEY (article_id)
        REFERENCES tanah_article (id) ON DELETE CASCADE,
    CONSTRAINT chk_article_hebrew_date_month CHECK (hebrew_month BETWEEN 1 AND 14),
    CONSTRAINT chk_article_hebrew_date_day CHECK (hebrew_day BETWEEN 1 AND 30)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE articleHebrewDateUpgrade FROM @articleHebrewDateSql;
EXECUTE articleHebrewDateUpgrade;
DEALLOCATE PREPARE articleHebrewDateUpgrade;

-- Initial assignments requested in issue #3098:
--   article 2199 (לימוד לתשעה באב)    -> 9 Av   = (11, 9)
--   article 2860 (מאמרים ליום העצמאות) -> 5 Iyar = (8, 5)
-- Deployed idempotently through the database path (admin-authored content
-- belongs in the DB, not in populator code). Each row is inserted only when
-- the referenced article exists, is distribution-eligible and has a non-empty
-- body, so test databases without those articles stay clean and a broken
-- reference can never pass silently. Re-running re-asserts the owner-approved
-- assignment (VALUES(article_id) wins over a stray conflicting row).
INSERT INTO tanah_article_hebrew_date (article_id, hebrew_month, hebrew_day)
SELECT 2199, 11, 9 FROM DUAL
WHERE EXISTS (
    SELECT 1 FROM tanah_article
    WHERE id = 2199 AND distributable = TRUE
        AND content IS NOT NULL AND TRIM(content) <> ''
)
ON DUPLICATE KEY UPDATE article_id = VALUES(article_id);

INSERT INTO tanah_article_hebrew_date (article_id, hebrew_month, hebrew_day)
SELECT 2860, 8, 5 FROM DUAL
WHERE EXISTS (
    SELECT 1 FROM tanah_article
    WHERE id = 2860 AND distributable = TRUE
        AND content IS NOT NULL AND TRIM(content) <> ''
)
ON DUPLICATE KEY UPDATE article_id = VALUES(article_id);
