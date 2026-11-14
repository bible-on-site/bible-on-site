-- Dedication revival upgrade for issue #2731.
--
-- Extends the preserved dedication tables with expiry and adds the expanded
-- target scopes: full sefer, full helek, weekly parasha unit, Tanahpedia
-- entry and the whole masora-al-haperek feature. Existing dedication ids,
-- purposes, article links and perek-range assignments are retained. Safe to
-- re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy admin-authored dedications, so
-- the DDL below is built inside strings the rewriter cannot match (same idiom
-- as tanah_reading_metrics_upgrade.sql). Never write the creation keywords
-- literally in this file, including in comments.
--
-- Scope and expiry contract (docs/data/dedications.md holds the full
-- document):
-- * tanah_dedication.expires_at retires the whole dedication, and each link row
--   carries its own expires_at so one assignment can lapse while the others
--   stay active. NULL means ongoing and no end date is ever fabricated.
-- * expires_at is a DATETIME holding a UTC wall-clock instant and readers
--   compare it with UTC_TIMESTAMP: an
--   assignment is public while every applicable expiry is NULL or strictly
--   in the future, so the expiry instant itself is the first hidden moment.
-- * Scope link tables key (target, dedication_id) so every target lists its
--   dedications and every dedication lists its targets, and each gets a
--   secondary key on dedication_id for admin-side reads.
-- * Sefer, helek, parasha and perek-range targets deliberately carry no
--   foreign keys: deploys recreate tanah_sefer, tanah_helek and tanah_perek,
--   and a cascade would delete still-valid assignments. The write path
--   validates target identity and range bounds instead. tanah_dedication,
--   tanah_article and tanahpedia_entry persist across deploys, so their
--   links get real FK cascades.
-- * The comment lines above stay free of semicolons and apostrophes: the
--   deploy Lambda splits statements on semicolons without tracking comments,
--   and validate_lambda_safe_comments rejects unsafe comment lines.

-- Bootstrap the preserved dedication tables when they are absent so a fresh
-- database ends at the same schema the existing tables already carry. Each
-- body below is the current definition plus the new expires_at column and the
-- ALTER statements further down fill the same column on pre-existing tables.

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_dedication` (
    `id` mediumint NOT NULL AUTO_INCREMENT,
    `subject` varchar(1023) NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Whole-dedication expiry, UTC; NULL = ongoing'',
    PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb3');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_dedication_type` (
    `id` tinyint NOT NULL,
    `description` varchar(255) NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_dedication_dedication_type` (
    `dedication_id` mediumint NOT NULL,
    `dedication_type_id` tinyint NOT NULL,
    PRIMARY KEY (`dedication_id`, `dedication_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_article_dedication` (
    `article_id` mediumint NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    PRIMARY KEY (`article_id`, `dedication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_perek_dedication` (
    `perek_id_low` int NOT NULL,
    `perek_id_high` int NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    PRIMARY KEY (`perek_id_low`, `perek_id_high`, `dedication_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

-- Add expires_at where an older copy of a preserved table lacks it.

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_dedication'
           AND COLUMN_NAME = 'expires_at') > 0,
        'SELECT 1',
        'ALTER TABLE `tanah_dedication` ADD COLUMN `expires_at` DATETIME NULL DEFAULT NULL COMMENT ''Whole-dedication expiry, UTC; NULL = ongoing'''
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_perek_dedication'
           AND COLUMN_NAME = 'expires_at') > 0,
        'SELECT 1',
        'ALTER TABLE `tanah_perek_dedication` ADD COLUMN `expires_at` DATETIME NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'''
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_article_dedication'
           AND COLUMN_NAME = 'expires_at') > 0,
        'SELECT 1',
        'ALTER TABLE `tanah_article_dedication` ADD COLUMN `expires_at` DATETIME NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'''
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

-- Referential guards for the preserved link tables: the FK lands only when
-- no orphan rows would reject it, so legacy content never blocks the deploy.

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_dedication_dedication_type'
           AND CONSTRAINT_NAME = 'fk_ddt_dedication') > 0
        OR (SELECT COUNT(*) FROM tanah_dedication_dedication_type ddt
            LEFT JOIN tanah_dedication d ON d.id = ddt.dedication_id
            WHERE d.id IS NULL) > 0
        OR (SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tanah_dedication') = 0,
        'SELECT 1',
        'ALTER TABLE `tanah_dedication_dedication_type` ADD CONSTRAINT `fk_ddt_dedication` FOREIGN KEY (`dedication_id`) REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_perek_dedication'
           AND CONSTRAINT_NAME = 'fk_perek_dedication_dedication') > 0
        OR (SELECT COUNT(*) FROM tanah_perek_dedication pd
            LEFT JOIN tanah_dedication d ON d.id = pd.dedication_id
            WHERE d.id IS NULL) > 0,
        'SELECT 1',
        'ALTER TABLE `tanah_perek_dedication` ADD CONSTRAINT `fk_perek_dedication_dedication` FOREIGN KEY (`dedication_id`) REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_dedication_dedication_type'
           AND CONSTRAINT_NAME = 'fk_ddt_type') > 0
        OR (SELECT COUNT(*) FROM tanah_dedication_dedication_type ddt
            LEFT JOIN tanah_dedication_type dt ON dt.id = ddt.dedication_type_id
            WHERE dt.id IS NULL) > 0
        OR (SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tanah_dedication_type') = 0,
        'SELECT 1',
        'ALTER TABLE `tanah_dedication_dedication_type` ADD CONSTRAINT `fk_ddt_type` FOREIGN KEY (`dedication_type_id`) REFERENCES `tanah_dedication_type` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_article_dedication'
           AND CONSTRAINT_NAME = 'fk_article_dedication_dedication') > 0
        OR (SELECT COUNT(*) FROM tanah_article_dedication ad
            LEFT JOIN tanah_dedication d ON d.id = ad.dedication_id
            WHERE d.id IS NULL) > 0,
        'SELECT 1',
        'ALTER TABLE `tanah_article_dedication` ADD CONSTRAINT `fk_article_dedication_dedication` FOREIGN KEY (`dedication_id`) REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = (
    SELECT IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'tanah_article_dedication'
           AND CONSTRAINT_NAME = 'fk_article_dedication_article') > 0
        OR (SELECT COUNT(*) FROM tanah_article_dedication ad
            LEFT JOIN tanah_article a ON a.id = ad.article_id
            WHERE a.id IS NULL) > 0
        OR (SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tanah_article') = 0,
        'SELECT 1',
        'ALTER TABLE `tanah_article_dedication` ADD CONSTRAINT `fk_article_dedication_article` FOREIGN KEY (`article_id`) REFERENCES `tanah_article` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
    )
);
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

-- Expanded-scope link tables. Parasha ids are the weekly reading unit ids of
-- the shared parasha division (the /פרשה route identity). The masora feature
-- scope is a single row per dedication because it names the whole feature.

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_sefer_dedication` (
    `sefer_id` int NOT NULL COMMENT ''Canonical tanah_sefer id; no FK since deploys recreate it'',
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`sefer_id`, `dedication_id`),
    KEY `idx_sefer_dedication` (`dedication_id`),
    CONSTRAINT `fk_sefer_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_helek_dedication` (
    `helek_id` tinyint NOT NULL COMMENT ''Canonical tanah_helek id; no FK since deploys recreate it'',
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`helek_id`, `dedication_id`),
    KEY `idx_helek_dedication` (`dedication_id`),
    CONSTRAINT `fk_helek_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_parasha_dedication` (
    `parasha_id` smallint NOT NULL COMMENT ''Weekly parasha unit id of the shared division'',
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`parasha_id`, `dedication_id`),
    KEY `idx_parasha_dedication` (`dedication_id`),
    CONSTRAINT `chk_parasha_dedication_id` CHECK (`parasha_id` >= 1),
    CONSTRAINT `fk_parasha_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanahpedia_entry_dedication` (
    `entry_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    `dedication_id` mediumint NOT NULL,
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`entry_id`, `dedication_id`),
    KEY `idx_entry_dedication` (`dedication_id`),
    CONSTRAINT `fk_entry_dedication_entry` FOREIGN KEY (`entry_id`)
        REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_entry_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;

SET @dedicationUpgradeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_masora_dedication` (
    `dedication_id` mediumint NOT NULL COMMENT ''Feature-level scope: the whole masora-al-haperek division'',
    `expires_at` datetime NULL DEFAULT NULL COMMENT ''Assignment expiry, UTC; NULL = ongoing'',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`dedication_id`),
    CONSTRAINT `fk_masora_dedication_dedication` FOREIGN KEY (`dedication_id`)
        REFERENCES `tanah_dedication` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE dedicationUpgrade FROM @dedicationUpgradeSql;
EXECUTE dedicationUpgrade;
DEALLOCATE PREPARE dedicationUpgrade;
