-- Enforce one entry-entity link per (entry_id, entity_id) pair.
-- First collapse any duplicate link rows (keeping one row per pair), then add
-- the unique key. Both statements are idempotent.
DELETE ee FROM tanahpedia_entry_entity ee
JOIN (
    SELECT entry_id, entity_id, MIN(id) AS keep_id
    FROM tanahpedia_entry_entity
    GROUP BY entry_id, entity_id
    HAVING COUNT(*) > 1
) dup ON dup.entry_id = ee.entry_id
     AND dup.entity_id = ee.entity_id
     AND ee.id <> dup.keep_id;

SET @preparedStatement = (
    SELECT IF(
        (
            SELECT COUNT(*)
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'tanahpedia_entry_entity'
                AND INDEX_NAME = 'uk_entry_entity_pair'
        ) > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_entry_entity ADD UNIQUE KEY uk_entry_entity_pair (entry_id, entity_id)'
    )
);
PREPARE addEntryEntityUniqueKey
FROM @preparedStatement;
EXECUTE addEntryEntityUniqueKey;
DEALLOCATE PREPARE addEntryEntityUniqueKey;
