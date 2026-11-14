-- Shared reading-metrics contract upgrade for issue #2607.
--
-- Establishes the persisted decoration every GUI consumes: complete-text word
-- counts, a baseline estimated reading time (words_per_minute + calc_version
-- version the policy), a source hash for staleness detection, and ordered
-- per-unit counts for word-weighted reading-position progress.
--
-- Existing content is retained. Safe to re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy computed metrics, so the DDL
-- below is built inside a string the rewriter cannot match (same idiom as
-- tanah_article_covering_source_upgrade.sql). Never write the creation
-- keywords literally in this file, including in comments.
--
-- Contract summary (docs/data/reading-metrics.md holds the full document):
-- * One metric row per content item: the primary key of the content item
--   (perek_id / article_id / entry_id, or the note compound key) identifies it
--   inside its kind, no cross-kind polymorphic row.
-- * word_count NULL = metric unknown or not computed, 0 = verified empty body.
--   estimated_seconds is derived deterministically
--   (ceil(word_count * 60 / words_per_minute)) and NULL when word_count is NULL.
-- * source_hash = sha256 hex of the normalized counted text so content edits,
--   imports and policy changes cannot silently leave stale metrics attached
--   to new text.
-- * *_block rows store ordered word counts at the smallest useful reading
--   unit (pasuk / note / top-level readable block) with cumulative_words, so
--   reading-position progress maps word offsets without re-parsing text.
-- * Tables keyed by perek_id/perush note coordinates deliberately carry no
--   foreign keys: deploy recreates tanah_perek and the perushim tables, and a
--   cascade would delete still-valid metrics. source_hash + calc_version
--   detect real staleness instead. tanah_article and tanahpedia_entry are
--   never recreated by deploys, so their metric tables get real FK cascades.
-- * Comment lines above stay free of semicolons and apostrophes: the deploy
--   Lambda splits statements on semicolons without tracking comments, and
--   validate_lambda_safe_comments rejects unsafe comment lines.

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_perek_metric` (
    `perek_id` int NOT NULL COMMENT ''Canonical perek id (1-929); no FK: deploys recreate tanah_perek'',
    `word_count` mediumint unsigned DEFAULT NULL COMMENT ''NULL = unknown; 0 = verified empty'',
    `estimated_seconds` mediumint unsigned DEFAULT NULL COMMENT ''ceil(word_count*60/words_per_minute); NULL when unknown'',
    `words_per_minute` smallint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL COMMENT ''Counting-policy version that produced this row'',
    `source_hash` char(64) NOT NULL COMMENT ''sha256 hex of the normalized counted text'',
    `computed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`perek_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_perek_pasuk_metric` (
    `perek_id` int NOT NULL,
    `pasuk` smallint unsigned NOT NULL COMMENT ''1-based pasuk index within the perek'',
    `word_count` smallint unsigned NOT NULL,
    `cumulative_words` mediumint unsigned NOT NULL COMMENT ''Words up to and including this pasuk, in canonical order'',
    `calc_version` smallint unsigned NOT NULL,
    PRIMARY KEY (`perek_id`, `pasuk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_article_metric` (
    `article_id` mediumint NOT NULL,
    `word_count` mediumint unsigned DEFAULT NULL,
    `estimated_seconds` mediumint unsigned DEFAULT NULL,
    `words_per_minute` smallint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL,
    `source_hash` char(64) NOT NULL,
    `computed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`article_id`),
    CONSTRAINT `fk_article_metric_article` FOREIGN KEY (`article_id`)
        REFERENCES `tanah_article` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_article_metric_block` (
    `article_id` mediumint NOT NULL,
    `block_idx` smallint unsigned NOT NULL COMMENT ''0-based ordinal over the article readable blocks'',
    `word_count` smallint unsigned NOT NULL,
    `cumulative_words` mediumint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL,
    PRIMARY KEY (`article_id`, `block_idx`),
    CONSTRAINT `fk_article_metric_block` FOREIGN KEY (`article_id`)
        REFERENCES `tanah_article` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_note_metric` (
    `perush_id` smallint NOT NULL,
    `perek_id` smallint NOT NULL,
    `pasuk` smallint NOT NULL,
    `note_idx` smallint NOT NULL,
    `word_count` smallint unsigned NOT NULL,
    `cumulative_words` mediumint unsigned NOT NULL COMMENT ''Within (perush_id, perek_id), ordered by (pasuk, note_idx)'',
    `calc_version` smallint unsigned NOT NULL,
    `source_hash` char(64) NOT NULL,
    PRIMARY KEY (`perush_id`, `perek_id`, `pasuk`, `note_idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanah_perush_metric` (
    `perush_id` smallint NOT NULL,
    `perek_id` smallint NOT NULL COMMENT ''Scope of the estimate: this perush on this perek'',
    `word_count` mediumint unsigned DEFAULT NULL,
    `estimated_seconds` mediumint unsigned DEFAULT NULL,
    `words_per_minute` smallint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL,
    `source_hash` char(64) NOT NULL COMMENT ''sha256 over the ordered member note hashes'',
    `computed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`perush_id`, `perek_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanahpedia_entry_metric` (
    `entry_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    `word_count` mediumint unsigned DEFAULT NULL,
    `estimated_seconds` mediumint unsigned DEFAULT NULL,
    `words_per_minute` smallint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL,
    `source_hash` char(64) NOT NULL,
    `computed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`entry_id`),
    CONSTRAINT `fk_entry_metric_entry` FOREIGN KEY (`entry_id`)
        REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;

SET @readingMetricsSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS `tanahpedia_entry_metric_block` (
    `entry_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    `block_idx` smallint unsigned NOT NULL,
    `word_count` smallint unsigned NOT NULL,
    `cumulative_words` mediumint unsigned NOT NULL,
    `calc_version` smallint unsigned NOT NULL,
    PRIMARY KEY (`entry_id`, `block_idx`),
    CONSTRAINT `fk_entry_metric_block` FOREIGN KEY (`entry_id`)
        REFERENCES `tanahpedia_entry` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE readingMetricsUpgrade FROM @readingMetricsSql;
EXECUTE readingMetricsUpgrade;
DEALLOCATE PREPARE readingMetricsUpgrade;
