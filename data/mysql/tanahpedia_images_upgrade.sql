-- Image assets and entity/entry image links for Tanahpedia (issue 3769).
-- tanahpedia_image stores the asset plus its attribution/licensing
-- provenance once, and the two link tables attach it to an entity and/or an
-- entry with per-link ordering and a primary flag. permission_evidence is
-- private editorial metadata — never returned by public readers.
-- Additive and repeat-safe: IF NOT EXISTS keeps the deploy Lambda from
-- injecting a DROP before the statement.

CREATE TABLE IF NOT EXISTS `tanahpedia_image` (
    `id` char(36) NOT NULL,
    `url` varchar(1024) NOT NULL COMMENT 'Served asset URL (CDN/S3 public object or external host)',
    `width` smallint unsigned DEFAULT NULL,
    `height` smallint unsigned DEFAULT NULL,
    `alt_text` varchar(500) NOT NULL,
    `caption` varchar(500) DEFAULT NULL,
    `creator` varchar(255) DEFAULT NULL COMMENT 'Artist / photographer when known',
    `credit_line` varchar(500) DEFAULT NULL COMMENT 'Concise display credit line',
    `source_name` varchar(255) DEFAULT NULL COMMENT 'Holding collection/site, e.g. Wikimedia Commons',
    `source_url` varchar(1024) DEFAULT NULL COMMENT 'Source item page URL',
    `license_name` varchar(255) DEFAULT NULL COMMENT 'License / rights statement; NULL when public domain',
    `license_url` varchar(1024) DEFAULT NULL,
    `is_public_domain` tinyint(1) NOT NULL DEFAULT 0,
    `modifications` varchar(500) DEFAULT NULL COMMENT 'Changes from the source item, e.g. crops',
    `permission_evidence` text COMMENT 'PRIVATE: permission/public-domain evidence; never publicly exposed',
    `is_public` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Published to readers only after evidence is recorded',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tanahpedia_entity_image` (
    `id` char(36) NOT NULL,
    `entity_id` char(36) NOT NULL,
    `image_id` char(36) NOT NULL,
    `sort_order` smallint NOT NULL DEFAULT 0,
    `is_primary` tinyint(1) NOT NULL DEFAULT 0,
    `primary_owner` char(36) GENERATED ALWAYS AS (IF(`is_primary` = 1, `entity_id`, NULL)) VIRTUAL COMMENT 'Unique-primary guard: entity_id when this row is primary, else NULL',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_entity_image_pair` (`entity_id`, `image_id`),
    UNIQUE KEY `uk_entity_image_primary` (`primary_owner`),
    KEY `idx_entity_image_entity` (`entity_id`, `sort_order`),
    KEY `idx_entity_image_image` (`image_id`),
    CONSTRAINT `fk_entity_image_entity` FOREIGN KEY (`entity_id`) REFERENCES `tanahpedia_entity` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_entity_image_image` FOREIGN KEY (`image_id`) REFERENCES `tanahpedia_image` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tanahpedia_entry_image` (
    `id` char(36) NOT NULL,
    `entry_id` char(36) NOT NULL,
    `image_id` char(36) NOT NULL,
    `sort_order` smallint NOT NULL DEFAULT 0,
    `is_primary` tinyint(1) NOT NULL DEFAULT 0,
    `primary_owner` char(36) GENERATED ALWAYS AS (IF(`is_primary` = 1, `entry_id`, NULL)) VIRTUAL COMMENT 'Unique-primary guard: entry_id when this row is primary, else NULL',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_entry_image_pair` (`entry_id`, `image_id`),
    UNIQUE KEY `uk_entry_image_primary` (`primary_owner`),
    KEY `idx_entry_image_entry` (`entry_id`, `sort_order`),
    KEY `idx_entry_image_image` (`image_id`),
    CONSTRAINT `fk_entry_image_entry` FOREIGN KEY (`entry_id`) REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_entry_image_image` FOREIGN KEY (`image_id`) REFERENCES `tanahpedia_image` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
