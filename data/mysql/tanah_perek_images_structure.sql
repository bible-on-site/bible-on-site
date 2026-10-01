-- Editorial perek images are durable data. Apply this file as an additive
-- migration in production; the regular static-data deploy must not drop them.
CREATE TABLE IF NOT EXISTS `tanah_perek_image` (
    `id` int unsigned NOT NULL AUTO_INCREMENT,
    `perek_id` int NOT NULL,
    `sort_order` smallint unsigned NOT NULL DEFAULT 0,
    `alt_text` varchar(500) NOT NULL,
    `caption` text NOT NULL,
    `description` varchar(500) DEFAULT NULL,
    `credit` varchar(255) DEFAULT NULL,
    `is_active` tinyint(1) NOT NULL DEFAULT 1,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `perek_order` (`perek_id`, `is_active`, `sort_order`, `id`),
    CONSTRAINT `valid_perek_image_chapter` CHECK (`perek_id` BETWEEN 1 AND 929)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tanah_perek_image_variant` (
    `id` int unsigned NOT NULL AUTO_INCREMENT,
    `image_id` int unsigned NOT NULL,
    `role` enum('display','social') NOT NULL,
    `format` enum('avif','webp','jpeg') NOT NULL,
    `width` smallint unsigned NOT NULL,
    `height` smallint unsigned NOT NULL,
    `s3_key` varchar(512) NOT NULL,
    `bytes` int unsigned DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `image_variant` (`image_id`, `role`, `format`, `width`),
    UNIQUE KEY `object_key` (`s3_key`),
    CONSTRAINT `perek_image_variant_parent` FOREIGN KEY (`image_id`)
        REFERENCES `tanah_perek_image` (`id`) ON DELETE CASCADE,
    CONSTRAINT `valid_image_dimensions` CHECK (`width` > 0 AND `height` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
