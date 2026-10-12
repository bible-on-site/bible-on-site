-- Safe bulletin schema upgrade. Existing content and delivery history are retained.
-- Build table DDL in separate fragments to avoid the deployment rewrite.
SET @bulletinSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_article ADD COLUMN distributable BOOLEAN NOT NULL DEFAULT FALSE')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_article'
        AND COLUMN_NAME = 'distributable'
);
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin (
    bulletin_date DATE NOT NULL PRIMARY KEY,
    perek_id SMALLINT UNSIGNED NOT NULL,
    article_id MEDIUMINT NULL,
    input_json JSON NOT NULL,
    subject VARCHAR(700) NOT NULL,
    source VARCHAR(255) NOT NULL,
    email_html MEDIUMTEXT NOT NULL,
    pdf_data MEDIUMBLOB NOT NULL,
    filename VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_delivery (
    bulletin_date DATE NOT NULL,
    channel ENUM(''email'', ''telegram'', ''whatsapp'') NOT NULL,
    status ENUM(''pending'', ''sending'', ''sent'', ''failed'', ''uncertain'') NOT NULL DEFAULT ''pending'',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    lease_token CHAR(36) NULL,
    lease_until DATETIME NULL,
    provider_message_id VARCHAR(255) NULL,
    last_error TEXT NULL,
    sent_at DATETIME NULL,
    PRIMARY KEY (bulletin_date, channel),
    CONSTRAINT fk_bulletin_delivery FOREIGN KEY (bulletin_date)
        REFERENCES tanah_daily_bulletin(bulletin_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;
