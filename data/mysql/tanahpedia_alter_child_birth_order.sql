-- Add a nullable child birth order to each parent child relationship.
-- Existing relationships remain unordered until set through the write API.
SET @preparedStatement = (
        SELECT IF(
                (
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'tanahpedia_person_parent_child'
                        AND COLUMN_NAME = 'birth_order'
                ) > 0,
                'SELECT 1',
                'ALTER TABLE tanahpedia_person_parent_child ADD COLUMN birth_order INT NULL'
            )
    );
PREPARE addChildBirthOrder
FROM @preparedStatement;
EXECUTE addChildBirthOrder;
DEALLOCATE PREPARE addChildBirthOrder;
