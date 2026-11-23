-- Run on MySQL 8.4 with the article writers and search worker paused.
-- See docs/aws/mysql-97-upgrade.md for preflight and validation.
-- Keep the expression identical to data/mysql/tanah_dynamic_structure.sql.
SET @upgrade_article_fingerprint = IF(
    EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
          AND COLUMN_NAME = 'content_hash'
          AND LOWER(GENERATION_EXPRESSION) LIKE '%md5(%'
    ),
    'ALTER TABLE tanah_article MODIFY COLUMN content_hash BINARY(16) GENERATED ALWAYS AS (
        UNHEX(LEFT(SHA2(CONCAT_WS(X''01'', IFNULL(name, ''''), IFNULL(abstract, ''''),
            IFNULL(content, ''''), perek_id, author_id), 256), 32))
    ) STORED, ALGORITHM=COPY, LOCK=SHARED',
    'SELECT 1'
);
PREPARE upgrade_article_fingerprint FROM @upgrade_article_fingerprint;
EXECUTE upgrade_article_fingerprint;
DEALLOCATE PREPARE upgrade_article_fingerprint;

-- A current document needs only its fingerprint updated. A document that
-- already lagged its article must still go through the normal search rebuild.
-- Computing the legacy fingerprint on 8.4 makes this repair safe to retry if
-- the DDL committed and the connection dropped before the update.
SET @refresh_search_documents = IF(
    EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'article_search_doc'
    ),
    'UPDATE article_search_doc AS d JOIN tanah_article AS a ON a.id = d.article_id
     SET d.content_hash = a.content_hash, d.updated_at = d.updated_at
     WHERE d.content_hash = UNHEX(MD5(CONCAT_WS(X''01'', IFNULL(a.name, ''''),
         IFNULL(a.abstract, ''''), IFNULL(a.content, ''''), a.perek_id, a.author_id)))
       AND d.content_hash <> a.content_hash',
    'SELECT 1'
);
PREPARE refresh_search_documents FROM @refresh_search_documents;
EXECUTE refresh_search_documents;
DEALLOCATE PREPARE refresh_search_documents;
