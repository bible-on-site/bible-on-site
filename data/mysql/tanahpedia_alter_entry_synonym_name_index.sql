-- Add an index on tanahpedia_entry_synonym.name so alias-name lookups
-- (WHERE s.name = ?) use an index probe instead of a full table scan, and
-- the FOR UPDATE name lock in the alias write path narrows to the matching
-- range instead of next-key-locking the whole table.
-- Idempotent: safe to re-run on every deploy.
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_entry_synonym'
                        AND INDEX_NAME = 'idx_entry_synonym_name'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_entry_synonym ADD INDEX idx_entry_synonym_name (name)'
            )
    );
PREPARE addEntrySynonymNameIndex
FROM @preparedStatement;
EXECUTE addEntrySynonymNameIndex;
DEALLOCATE PREPARE addEntrySynonymNameIndex;
