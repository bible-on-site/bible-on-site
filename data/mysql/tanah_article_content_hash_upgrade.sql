-- Stored content fingerprint on tanah_article for the article-search
-- reconcile sweep. Without it, every sweep asks MySQL to evaluate
-- MD5(name + abstract + content) for every public article just to diff ids
-- against article_search_doc — a full read of the largest column in the
-- system every 10 minutes. A STORED generated column computes once per
-- write, so the sweep reads only (id, content_hash) pairs.
--
-- Safe to re-run on every deploy: the ALTER is skipped when the column
-- already exists. Keep the expression identical to
-- tanah_dynamic_structure.sql.
SET @contentHashUpgrade = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_article'
           AND COLUMN_NAME = 'content_hash') > 0,
        'SELECT 1',
        'ALTER TABLE tanah_article ADD COLUMN content_hash BINARY(16) GENERATED ALWAYS AS (UNHEX(MD5(CONCAT_WS(X''01'', IFNULL(`name`, ''''), IFNULL(`abstract`, ''''), IFNULL(`content`, ''''), `perek_id`, `author_id`)))) STORED'
    )
);
PREPARE contentHashUpgrade FROM @contentHashUpgrade;
EXECUTE contentHashUpgrade;
DEALLOCATE PREPARE contentHashUpgrade;
