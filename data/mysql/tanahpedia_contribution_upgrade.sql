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

-- Agent registrations and immutable instruction/tool bundles contain no content.
SET @contributionAgentSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanahpedia_contribution_agent (
	id CHAR(36) NOT NULL PRIMARY KEY,
	version INT UNSIGNED NOT NULL DEFAULT 1,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
PREPARE contributionAgentUpgrade FROM @contributionAgentSql;
EXECUTE contributionAgentUpgrade;
DEALLOCATE PREPARE contributionAgentUpgrade;

SET @contributionBundleSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanahpedia_contribution_agent_bundle (
	hash CHAR(64) NOT NULL PRIMARY KEY,
	version VARCHAR(100) NOT NULL,
	data JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
PREPARE contributionBundleUpgrade FROM @contributionBundleSql;
EXECUTE contributionBundleUpgrade;
DEALLOCATE PREPARE contributionBundleUpgrade;

-- Immutable legacy origins. the unique persisted proposal identity makes
-- transactional PR promotion safe to replay after a crash or concurrent CD.
SET @articleLinkImportSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanahpedia_article_link_import (
	proposal_id CHAR(36) NOT NULL PRIMARY KEY,
	contribution_id CHAR(36) NOT NULL,
	article_id INT NOT NULL,
	original JSON NOT NULL,
	created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	KEY idx_article_link_import_pr (contribution_id),
	KEY idx_article_link_import_article (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
PREPARE articleLinkImportUpgrade FROM @articleLinkImportSql;
EXECUTE articleLinkImportUpgrade;
DEALLOCATE PREPARE articleLinkImportUpgrade;

SET @articleLinkImportLockSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanahpedia_article_link_import_lock (
	article_id INT NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE articleLinkImportLockUpgrade FROM @articleLinkImportLockSql;
EXECUTE articleLinkImportLockUpgrade;
DEALLOCATE PREPARE articleLinkImportLockUpgrade;
