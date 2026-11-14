-- Sargable "today in Tanah" anniversaries: one generated month_day column
-- (Hebrew month * 100 + day, NULL for the unknown/not-yet/forever
-- sentinels) per Hebrew-date column the anniversary EXISTS predicates
-- read, each with a secondary index. The website and API queries then
-- compare month_day = ? instead of `date % 10000 = ?`, which forced a
-- full scan of every date table on each /pedia landing request.
-- Fully idempotent: safe to run on fresh and existing databases.

-- ─── tanahpedia_event_date_range ────────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_event_date_range'
           AND COLUMN_NAME = 'start_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_event_date_range ADD COLUMN start_month_day INT GENERATED ALWAYS AS (IF(start_date > 0 AND start_date <> 99991229, start_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of start_date, NULL for sentinels'''
    )
);
PREPARE addEventDateRangeStartMonthDay FROM @preparedStatement;
EXECUTE addEventDateRangeStartMonthDay;
DEALLOCATE PREPARE addEventDateRangeStartMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_event_date_range'
           AND INDEX_NAME = 'idx_event_date_range_start_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_event_date_range ADD INDEX idx_event_date_range_start_month_day (start_month_day)'
    )
);
PREPARE addEventDateRangeStartMonthDayIndex FROM @preparedStatement;
EXECUTE addEventDateRangeStartMonthDayIndex;
DEALLOCATE PREPARE addEventDateRangeStartMonthDayIndex;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_event_date_range'
           AND COLUMN_NAME = 'end_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_event_date_range ADD COLUMN end_month_day INT GENERATED ALWAYS AS (IF(end_date > 0 AND end_date <> 99991229, end_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of end_date, NULL for sentinels'''
    )
);
PREPARE addEventDateRangeEndMonthDay FROM @preparedStatement;
EXECUTE addEventDateRangeEndMonthDay;
DEALLOCATE PREPARE addEventDateRangeEndMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_event_date_range'
           AND INDEX_NAME = 'idx_event_date_range_end_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_event_date_range ADD INDEX idx_event_date_range_end_month_day (end_month_day)'
    )
);
PREPARE addEventDateRangeEndMonthDayIndex FROM @preparedStatement;
EXECUTE addEventDateRangeEndMonthDayIndex;
DEALLOCATE PREPARE addEventDateRangeEndMonthDayIndex;

-- ─── tanahpedia_saying ──────────────────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_saying'
           AND COLUMN_NAME = 'month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_saying ADD COLUMN month_day INT GENERATED ALWAYS AS (IF(saying_date > 0 AND saying_date <> 99991229, saying_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of saying_date, NULL for sentinels'''
    )
);
PREPARE addSayingMonthDay FROM @preparedStatement;
EXECUTE addSayingMonthDay;
DEALLOCATE PREPARE addSayingMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_saying'
           AND INDEX_NAME = 'idx_saying_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_saying ADD INDEX idx_saying_month_day (month_day)'
    )
);
PREPARE addSayingMonthDayIndex FROM @preparedStatement;
EXECUTE addSayingMonthDayIndex;
DEALLOCATE PREPARE addSayingMonthDayIndex;

-- ─── tanahpedia_person_birth_date ───────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_birth_date'
           AND COLUMN_NAME = 'month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_birth_date ADD COLUMN month_day INT GENERATED ALWAYS AS (IF(birth_date > 0 AND birth_date <> 99991229, birth_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of birth_date, NULL for sentinels'''
    )
);
PREPARE addBirthDateMonthDay FROM @preparedStatement;
EXECUTE addBirthDateMonthDay;
DEALLOCATE PREPARE addBirthDateMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_birth_date'
           AND INDEX_NAME = 'idx_person_birth_date_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_birth_date ADD INDEX idx_person_birth_date_month_day (month_day)'
    )
);
PREPARE addBirthDateMonthDayIndex FROM @preparedStatement;
EXECUTE addBirthDateMonthDayIndex;
DEALLOCATE PREPARE addBirthDateMonthDayIndex;

-- ─── tanahpedia_person_death_date ───────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_death_date'
           AND COLUMN_NAME = 'month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_death_date ADD COLUMN month_day INT GENERATED ALWAYS AS (IF(death_date > 0 AND death_date <> 99991229, death_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of death_date, NULL for sentinels'''
    )
);
PREPARE addDeathDateMonthDay FROM @preparedStatement;
EXECUTE addDeathDateMonthDay;
DEALLOCATE PREPARE addDeathDateMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_death_date'
           AND INDEX_NAME = 'idx_person_death_date_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_death_date ADD INDEX idx_person_death_date_month_day (month_day)'
    )
);
PREPARE addDeathDateMonthDayIndex FROM @preparedStatement;
EXECUTE addDeathDateMonthDayIndex;
DEALLOCATE PREPARE addDeathDateMonthDayIndex;

-- ─── tanahpedia_person_union ────────────────────────────────────────────────
SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_union'
           AND COLUMN_NAME = 'start_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_union ADD COLUMN start_month_day INT GENERATED ALWAYS AS (IF(start_date > 0 AND start_date <> 99991229, start_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of start_date, NULL for sentinels'''
    )
);
PREPARE addUnionStartMonthDay FROM @preparedStatement;
EXECUTE addUnionStartMonthDay;
DEALLOCATE PREPARE addUnionStartMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_union'
           AND INDEX_NAME = 'idx_person_union_start_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_union ADD INDEX idx_person_union_start_month_day (start_month_day)'
    )
);
PREPARE addUnionStartMonthDayIndex FROM @preparedStatement;
EXECUTE addUnionStartMonthDayIndex;
DEALLOCATE PREPARE addUnionStartMonthDayIndex;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_union'
           AND COLUMN_NAME = 'end_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_union ADD COLUMN end_month_day INT GENERATED ALWAYS AS (IF(end_date > 0 AND end_date <> 99991229, end_date % 10000, NULL)) VIRTUAL COMMENT ''Anniversary key: month*100+day of end_date, NULL for sentinels'''
    )
);
PREPARE addUnionEndMonthDay FROM @preparedStatement;
EXECUTE addUnionEndMonthDay;
DEALLOCATE PREPARE addUnionEndMonthDay;

SET @preparedStatement = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanahpedia_person_union'
           AND INDEX_NAME = 'idx_person_union_end_month_day') > 0,
        'SELECT 1',
        'ALTER TABLE tanahpedia_person_union ADD INDEX idx_person_union_end_month_day (end_month_day)'
    )
);
PREPARE addUnionEndMonthDayIndex FROM @preparedStatement;
EXECUTE addUnionEndMonthDayIndex;
DEALLOCATE PREPARE addUnionEndMonthDayIndex;
