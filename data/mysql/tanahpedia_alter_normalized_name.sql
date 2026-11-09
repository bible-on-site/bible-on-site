-- Sargable mention-decoration name resolution: a generated normalized_name
-- column (REPLACE(name, dash, space), matching the pipeline space-separated
-- intended_name contract) on tanahpedia_entry.unique_name and
-- tanahpedia_entry_synonym.name, each with a secondary index. The website
-- mention queries then join on the plain indexed column instead of
-- REPLACE() over the whole entry+synonym namespace per invocation.
-- Fully idempotent: safe to run on fresh and existing databases.

-- ─── tanahpedia_entry ───────────────────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_entry'
           AND COLUMN_NAME = 'normalized_name') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_entry ADD COLUMN normalized_name VARCHAR(255) GENERATED ALWAYS AS (REPLACE(`unique_name`, ''-'', '' '')) VIRTUAL COMMENT ''Mention-resolution key: unique_name with hyphens as spaces'''
    )
);
PREPARE addEntryNormalizedName FROM @preparedStatement;
EXECUTE addEntryNormalizedName;
DEALLOCATE PREPARE addEntryNormalizedName;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_entry'
           AND INDEX_NAME = 'idx_entry_normalized_name') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_entry ADD INDEX idx_entry_normalized_name (normalized_name)'
    )
);
PREPARE addEntryNormalizedNameIndex FROM @preparedStatement;
EXECUTE addEntryNormalizedNameIndex;
DEALLOCATE PREPARE addEntryNormalizedNameIndex;

-- ─── tanahpedia_entry_synonym ───────────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_entry_synonym'
           AND COLUMN_NAME = 'normalized_name') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_entry_synonym ADD COLUMN normalized_name VARCHAR(255) GENERATED ALWAYS AS (REPLACE(`name`, ''-'', '' '')) VIRTUAL COMMENT ''Mention-resolution key: name with hyphens as spaces'''
    )
);
PREPARE addSynonymNormalizedName FROM @preparedStatement;
EXECUTE addSynonymNormalizedName;
DEALLOCATE PREPARE addSynonymNormalizedName;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_entry_synonym'
           AND INDEX_NAME = 'idx_synonym_normalized_name') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_entry_synonym ADD INDEX idx_synonym_normalized_name (normalized_name)'
    )
);
PREPARE addSynonymNormalizedNameIndex FROM @preparedStatement;
EXECUTE addSynonymNormalizedNameIndex;
DEALLOCATE PREPARE addSynonymNormalizedNameIndex;
