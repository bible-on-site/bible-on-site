-- Add the optimistic-concurrency base pointer to entry revisions so every
-- applied change records the APPLIED head it was based on. Existing rows keep
-- NULL (unknown base, pre-history).
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_entry_revision'
                        AND COLUMN_NAME = 'base_revision_id'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_entry_revision ADD COLUMN base_revision_id CHAR(36) NULL COMMENT ''APPLIED head this change was based on'''
            )
    );
PREPARE addBaseRevisionId
FROM @preparedStatement;
EXECUTE addBaseRevisionId;
DEALLOCATE PREPARE addBaseRevisionId;
