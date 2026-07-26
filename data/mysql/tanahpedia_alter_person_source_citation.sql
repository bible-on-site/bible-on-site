-- One-time upgrade for databases created before person_source_citation was added
-- to tanahpedia_person_union. Plain MySQL has no ADD COLUMN IF NOT EXISTS clause
-- (that is a MariaDB-only extension), so this uses the standard prepared-statement
-- idiom to check information_schema first. This makes the script safe to execute
-- unconditionally on every deploy (production data-deploy Lambda has no
-- pre-check; this file is re-run on every deployment).
--
-- source_citation holds the citation for the UNION/relationship itself (e.g. the
-- commentary source justifying its classification as a marriage).
-- person_source_citation holds the related persons own citation (e.g. the verse
-- where she is first mentioned or her children are born), shown separately when
-- it differs from the relationship citation.
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_person_union'
                        AND COLUMN_NAME = 'person_source_citation'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_person_union ADD COLUMN person_source_citation VARCHAR(400) NULL'
            )
    );
PREPARE addPersonSourceCitationToUnion
FROM @preparedStatement;
EXECUTE addPersonSourceCitationToUnion;
DEALLOCATE PREPARE addPersonSourceCitationToUnion;