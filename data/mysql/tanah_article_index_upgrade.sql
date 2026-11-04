-- Article lookup indexes for tanah_article (perek_id, author_id).
-- Existing articles and content are retained. Safe to re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy admin-authored articles, so the
-- DDL below is built inside a string the rewriter cannot match (same idiom as
-- tanah_article_covering_source_upgrade.sql). Never write the creation
-- keywords literally in this file, including in comments.
--
-- Every articles_service / authors service / bulletin get_articles_by_perek
-- lookup filters on perek_id or author_id, which had no secondary index and
-- forced a full scan of the growing article table per lookup. Each index is
-- guarded independently so a partially migrated database still converges.
SET @articleIndexSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_article ADD KEY idx_article_perek (perek_id)')
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
        AND INDEX_NAME = 'idx_article_perek'
);
PREPARE articleIndexUpgrade FROM @articleIndexSql;
EXECUTE articleIndexUpgrade;
DEALLOCATE PREPARE articleIndexUpgrade;

SET @articleIndexSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_article ADD KEY idx_article_author (author_id)')
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
        AND INDEX_NAME = 'idx_article_author'
);
PREPARE articleIndexUpgrade FROM @articleIndexSql;
EXECUTE articleIndexUpgrade;
DEALLOCATE PREPARE articleIndexUpgrade;
