-- Idempotent upgrade for databases created before source_citation was added
-- to family tables. Safe to run on every deploy.

SET @has_union_source_citation := (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'tanahpedia_person_union'
		AND COLUMN_NAME = 'source_citation'
);
SET @union_upgrade_sql := IF(
	@has_union_source_citation = 0,
	'ALTER TABLE tanahpedia_person_union ADD COLUMN source_citation VARCHAR(400) NULL',
	'SELECT 1'
);
PREPARE union_upgrade_stmt FROM @union_upgrade_sql;
EXECUTE union_upgrade_stmt;
DEALLOCATE PREPARE union_upgrade_stmt;

SET @has_parent_child_source_citation := (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'tanahpedia_person_parent_child'
		AND COLUMN_NAME = 'source_citation'
);
SET @parent_child_upgrade_sql := IF(
	@has_parent_child_source_citation = 0,
	'ALTER TABLE tanahpedia_person_parent_child ADD COLUMN source_citation VARCHAR(400) NULL',
	'SELECT 1'
);
PREPARE parent_child_upgrade_stmt FROM @parent_child_upgrade_sql;
EXECUTE parent_child_upgrade_stmt;
DEALLOCATE PREPARE parent_child_upgrade_stmt;
