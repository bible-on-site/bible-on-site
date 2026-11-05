-- מועדים על הפרק schema for issue #3101: a persistent DB catalogue of moadim,
-- their ordered scripture reading sections/ranges, and the optional
-- many-to-many article <-> moed link the shared article-relationship registry
-- exposes as the `moadim` relationship (#3102).
--
-- Existing articles and content are retained. Safe to re-run on every deploy.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus CREATE, which would destroy admin-authored content, so the
-- DDL below is built inside a string the rewriter cannot match (same idiom as
-- tanah_article_covering_source_upgrade.sql). Never write the creation
-- keywords literally in this file, including in comments.

-- One moed row per catalogue entry. `slug` is the canonical Hebrew name-based
-- URL segment (spaces -> ASCII hyphen, quote marks dropped). It stays stable
-- across display-name edits so existing links survive. `annual_order` is the
-- placement of the moed inside the מעגל השנה wheel — an ordering number, NOT a
-- Hebrew-calendar rule, a Gregorian month, or a leap-year month ordinal.
-- `hebrew_month`/`date_label` are honest display metadata for the wheel and
-- detail page. They never drive date computation.
SET @moedSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_moed (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(191) NOT NULL COMMENT ''Canonical Hebrew URL segment for /moadim/{slug}'',
    name VARCHAR(255) NOT NULL COMMENT ''Hebrew display name'',
    summary TEXT NULL COMMENT ''Short editorial description shown on the detail page'',
    hebrew_month VARCHAR(32) NULL COMMENT ''Display-only Hebrew month anchor (e.g. תשרי)'',
    date_label VARCHAR(64) NULL COMMENT ''Display-only date range label (e.g. א-ב בתשרי)'',
    annual_order SMALLINT NOT NULL COMMENT ''Wheel/display ordering, not calendar math'',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_moed_slug (slug),
    UNIQUE KEY uk_moed_annual_order (annual_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE moedUpgrade FROM @moedSql;
EXECUTE moedUpgrade;
DEALLOCATE PREPARE moedUpgrade;

-- One labelled reading section of a moed (e.g. מגילת איכה, הפטרת שחרית of a
-- given custom). `position` is the display order inside the moed — kept
-- separate from canonical scripture identity so a section never pretends to
-- be a single parent sefer.
SET @moedSectionSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_moed_section (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    moed_id SMALLINT UNSIGNED NOT NULL,
    label VARCHAR(255) NOT NULL,
    position SMALLINT NOT NULL COMMENT ''1-based display order inside the moed'',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_moed_section_position (moed_id, position),
    CONSTRAINT fk_moed_section_moed FOREIGN KEY (moed_id)
        REFERENCES tanah_moed (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE moedSectionUpgrade FROM @moedSectionSql;
EXECUTE moedSectionUpgrade;
DEALLOCATE PREPARE moedSectionUpgrade;

-- One inclusive canonical range inside a section. Multiple rows per section
-- express noncontiguous ranges (and jumps across sefarim) in display order,
-- both bound perek ids are FK checked against the canonical corpus so every range is
-- renderable. Pasuk upper bounds are validated against tanah_perek.pasuk_count
-- by the write paths (MySQL has no per-row dynamic CHECK).
SET @moedRangeSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_moed_range (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    section_id INT UNSIGNED NOT NULL,
    position SMALLINT NOT NULL COMMENT ''1-based order inside the section'',
    perek_id_start INT NOT NULL,
    pasuk_start SMALLINT NOT NULL COMMENT ''1-based inclusive start pasuk'',
    perek_id_end INT NOT NULL,
    pasuk_end SMALLINT NOT NULL COMMENT ''1-based inclusive end pasuk'',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_moed_range_position (section_id, position),
    KEY idx_moed_range_pereks (perek_id_start, perek_id_end),
    CONSTRAINT fk_moed_range_section FOREIGN KEY (section_id)
        REFERENCES tanah_moed_section (id) ON DELETE CASCADE,
    CONSTRAINT fk_moed_range_perek_start FOREIGN KEY (perek_id_start)
        REFERENCES tanah_perek (id),
    CONSTRAINT fk_moed_range_perek_end FOREIGN KEY (perek_id_end)
        REFERENCES tanah_perek (id),
    CONSTRAINT chk_moed_range_pasuk_start CHECK (pasuk_start >= 1),
    CONSTRAINT chk_moed_range_pasuk_end CHECK (pasuk_end >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE moedRangeUpgrade FROM @moedRangeSql;
EXECUTE moedRangeUpgrade;
DEALLOCATE PREPARE moedRangeUpgrade;

-- Optional many-to-many article <-> moed link: a moed may carry zero/one/many
-- articles and an article may link to several moadim. The composite primary
-- key rejects duplicate pairs. Both FK cascades remove links without touching
-- the article or the moed row.
SET @articleMoedSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_article_moed (
    article_id MEDIUMINT NOT NULL,
    moed_id SMALLINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, moed_id),
    KEY idx_article_moed_moed (moed_id),
    CONSTRAINT fk_article_moed_article FOREIGN KEY (article_id)
        REFERENCES tanah_article (id) ON DELETE CASCADE,
    CONSTRAINT fk_article_moed_moed FOREIGN KEY (moed_id)
        REFERENCES tanah_moed (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE articleMoedUpgrade FROM @articleMoedSql;
EXECUTE articleMoedUpgrade;
DEALLOCATE PREPARE articleMoedUpgrade;
