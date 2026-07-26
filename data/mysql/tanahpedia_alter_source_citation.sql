-- One-time upgrade for databases created before source_citation was added to family tables.
-- Plain MySQL has no ADD COLUMN IF NOT EXISTS clause (that is a MariaDB-only
-- extension), so this uses the standard prepared-statement idiom to check
-- information_schema first. This makes the script safe to execute
-- unconditionally on every deploy (production data-deploy Lambda has no
-- pre-check; this file is re-run on every deployment).
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_person_union'
                        AND COLUMN_NAME = 'source_citation'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_person_union ADD COLUMN source_citation VARCHAR(400) NULL'
            )
    );
PREPARE addSourceCitationToUnion
FROM @preparedStatement;
EXECUTE addSourceCitationToUnion;
DEALLOCATE PREPARE addSourceCitationToUnion;
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_person_parent_child'
                        AND COLUMN_NAME = 'source_citation'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_person_parent_child ADD COLUMN source_citation VARCHAR(400) NULL'
            )
    );
PREPARE addSourceCitationToParentChild
FROM @preparedStatement;
EXECUTE addSourceCitationToParentChild;
DEALLOCATE PREPARE addSourceCitationToParentChild;