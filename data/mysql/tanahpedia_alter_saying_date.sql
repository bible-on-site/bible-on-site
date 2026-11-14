-- Add a nullable Hebrew date without replacing existing sayings or content.
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_saying'
           AND COLUMN_NAME = 'saying_date') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_saying ADD COLUMN saying_date INT NULL COMMENT ''YYYYMMDD Hebrew date; 00 for unknown components'''
    )
);
PREPARE addSayingDate FROM @preparedStatement;
EXECUTE addSayingDate;
DEALLOCATE PREPARE addSayingDate;
