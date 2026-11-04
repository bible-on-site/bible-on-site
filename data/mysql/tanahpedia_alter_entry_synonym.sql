-- Add an index on the synonym name column. Every public alias lookup filters
-- by name, so the table needs a matching key. Existing rows are kept and the
-- index is additive, safe to re-run on every deploy.
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
                'ALTER TABLE tanahpedia_entry_synonym ADD KEY idx_entry_synonym_name (name)'
            )
    );
PREPARE addEntrySynonymNameIndex
FROM @preparedStatement;
EXECUTE addEntrySynonymNameIndex;
DEALLOCATE PREPARE addEntrySynonymNameIndex;
