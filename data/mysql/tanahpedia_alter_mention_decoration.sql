-- Add the Tanahpedia mention-decoration table (issue #2516): name-keyed
-- NLP decorations that survive the target entry not existing yet.
-- Idempotent: safe on a database that already carries the table.
CREATE TABLE IF NOT EXISTS `tanahpedia_mention_decoration` (
    `id` char(36) NOT NULL,
    -- Decoration contract version, bumped on breaking shape changes.
    `contract_version` smallint NOT NULL DEFAULT 1,
    `source_kind` enum('pasuk', 'article') NOT NULL,
    -- Scripture coordinates for pasuk sources (same semantics as
    -- tanahpedia_entity_tanah_source: 0-based inclusive segment range,
    -- NULL bounds = whole pasuk).
    `perek_id` int DEFAULT NULL,
    `pasuk_number` int DEFAULT NULL,
    `segment_start` int DEFAULT NULL,
    `segment_end` int DEFAULT NULL,
    -- Article coordinates for article sources: character offsets into
    -- tanah_article.content at content_hash, the staleness key
    -- since the article row carries no revision column.
    `article_id` mediumint DEFAULT NULL,
    `content_hash` char(64) DEFAULT NULL,
    `span_start` int DEFAULT NULL,
    `span_end` int DEFAULT NULL,
    -- Exact original mention text — matching view only, never normalized
    -- stored scripture/article content.
    `surface` varchar(255) NOT NULL,
    -- Natural dedupe key (md5 over source_kind + coordinates + model_revision):
    -- lets repeat imports upsert idempotently even though the pasuk/article
    -- coordinate halves are mutually NULL.
    `dedupe_key` char(32) NOT NULL,
    -- Intended entry resolution key (tanahpedia_entry.unique_name) — by
    -- design NOT a foreign key: the entry may not exist yet and creating
    -- it later must activate this decoration without re-inference.
    `intended_name` varchar(255) NOT NULL,
    `entity_type` enum(
        'PERSON',
        'PLACE',
        'EVENT',
        'WAR',
        'ANIMAL',
        'OBJECT',
        'TEMPLE_TOOL',
        'PLANT',
        'ASTRONOMICAL_OBJECT',
        'SAYING',
        'SEFER',
        'PROPHECY',
        'NATION'
    ) NOT NULL,
    `disambiguation` varchar(255) DEFAULT NULL,
    `confidence` decimal(4,3) DEFAULT NULL,
    `acceptance` enum('auto', 'manual', 'held', 'rejected') NOT NULL DEFAULT 'auto',
    -- Pipeline provenance: pinned model/config revision + source hash
    -- (perek text hash or article content_hash) for cache invalidation.
    `model_revision` varchar(255) NOT NULL,
    `source_hash` char(64) NOT NULL,
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_decoration_dedupe` (`dedupe_key`),
    KEY `idx_decoration_pasuk` (`source_kind`, `perek_id`, `pasuk_number`),
    KEY `idx_decoration_article` (`source_kind`, `article_id`),
    KEY `idx_decoration_intended_name` (`intended_name`),
    CONSTRAINT `fk_decoration_perek` FOREIGN KEY (`perek_id`) REFERENCES `tanah_perek` (`id`),
    CONSTRAINT `fk_decoration_article` FOREIGN KEY (`article_id`) REFERENCES `tanah_article` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
