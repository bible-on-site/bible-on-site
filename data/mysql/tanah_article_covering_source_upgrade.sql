-- Verse-level article coverage upgrade for issue #2189 (epic #2175 §3).
-- Existing articles and content are retained. Safe to re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy admin-authored mappings, so the
-- DDL below is built inside a string the rewriter cannot match (same idiom as
-- tanah_daily_bulletin_upgrade.sql). Never write the creation keywords
-- literally in this file, including in comments.
--
-- coverage_verified distinguishes "coverage unknown" from "verified coverage":
-- FALSE (the default, and the state of every pre-existing article) means the
-- real covered pesukim were never mapped, so consumers fall back to the
-- primary perek association without claiming pasuk precision. TRUE means the
-- rows in tanah_article_covering_source are the verified coverage and drive
-- verse/range lookups. The admin mapping workflow sets it.
SET @coveringSourceSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_article ADD COLUMN coverage_verified BOOLEAN NOT NULL DEFAULT FALSE')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
        AND COLUMN_NAME = 'coverage_verified'
);
PREPARE coveringSourceUpgrade FROM @coveringSourceSql;
EXECUTE coveringSourceUpgrade;
DEALLOCATE PREPARE coveringSourceUpgrade;

-- Each row links one article to one canonical {perek_id, pasuk} it verifiably
-- covers, and an article has many rows. The composite primary key prevents
-- duplicate mappings, the first key column serves article-editing lookups,
-- and the secondary key serves verse/range lookups. perek existence is
-- enforced by FK. Pasuk upper bounds are validated against the canonical
-- pasuk count by the write path (MySQL has no per-row dynamic CHECK).
--
-- Deliberately no backfill: a primary perek_id alone must not be fabricated
-- into whole-perek coverage. Rows are authored through the auditable admin
-- workflow, then coverage_verified is set.
SET @coveringSourceSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_article_covering_source (
    article_id MEDIUMINT NOT NULL,
    perek_id INT NOT NULL,
    pasuk SMALLINT NOT NULL COMMENT ''1-based pasuk index within perek'',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, perek_id, pasuk),
    KEY idx_covering_source_perek_pasuk (perek_id, pasuk),
    CONSTRAINT fk_covering_source_article FOREIGN KEY (article_id)
        REFERENCES tanah_article (id) ON DELETE CASCADE,
    CONSTRAINT fk_covering_source_perek FOREIGN KEY (perek_id)
        REFERENCES tanah_perek (id),
    CONSTRAINT chk_covering_source_pasuk CHECK (pasuk >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE coveringSourceUpgrade FROM @coveringSourceSql;
EXECUTE coveringSourceUpgrade;
DEALLOCATE PREPARE coveringSourceUpgrade;
