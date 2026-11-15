-- Durable issue and PR records, preserving existing history on every deployment
SET @contributionSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanahpedia_contribution (
	id CHAR(36) NOT NULL PRIMARY KEY,
	number BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
	kind VARCHAR(8) NOT NULL,
	state VARCHAR(12) NOT NULL,
	title VARCHAR(255) NOT NULL,
	issue_id CHAR(36) NULL,
	version INT UNSIGNED NOT NULL DEFAULT 1,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
	KEY idx_contribution_queue (kind, state, number),
	KEY idx_contribution_issue (issue_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
PREPARE contributionUpgrade FROM @contributionSql;
EXECUTE contributionUpgrade;
DEALLOCATE PREPARE contributionUpgrade;
