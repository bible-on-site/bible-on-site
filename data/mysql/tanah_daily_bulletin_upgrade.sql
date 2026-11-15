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

-- Keep audience selection explicit and default to the test audience.
SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    audience ENUM(''test'', ''real'') NOT NULL DEFAULT ''test'',
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    next_send_at DATETIME(3) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;
INSERT IGNORE INTO tanah_daily_bulletin_email_settings (id) VALUES (1);

-- Preserve consent and suppression separately for each subscription topic.
SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_subscriber (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    audience ENUM(''test'', ''real'') NOT NULL,
    consent_status ENUM(''pending'', ''confirmed'', ''unsubscribed'', ''bounced'', ''complained'') NOT NULL DEFAULT ''pending'',
    consent_source VARCHAR(120) NULL,
    consented_at DATETIME(3) NULL,
    last_event_at DATETIME(3) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bulletin_subscriber (email, audience)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_job (
    id CHAR(36) NOT NULL PRIMARY KEY,
    bulletin_date DATE NOT NULL,
    audience ENUM(''test'', ''real'') NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL,
    settings_revision BIGINT UNSIGNED NOT NULL,
    status ENUM(''queued'', ''sending'', ''accepted'', ''delivered'', ''failed'', ''uncertain'', ''suppressed'') NOT NULL DEFAULT ''queued'',
    cnt_queued INT NOT NULL DEFAULT 0,
    cnt_sending INT NOT NULL DEFAULT 0,
    cnt_accepted INT NOT NULL DEFAULT 0,
    cnt_delivered INT NOT NULL DEFAULT 0,
    cnt_uncertain INT NOT NULL DEFAULT 0,
    cnt_failed INT NOT NULL DEFAULT 0,
    cnt_suppressed INT NOT NULL DEFAULT 0,
    last_error VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bulletin_email_job (bulletin_date, audience, idempotency_key),
    CONSTRAINT fk_bulletin_email_job FOREIGN KEY (bulletin_date) REFERENCES tanah_daily_bulletin(bulletin_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

SET @bulletinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_recipient (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    job_id CHAR(36) NOT NULL,
    subscriber_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(254) NOT NULL,
    status ENUM(''queued'', ''sending'', ''accepted'', ''delivered'', ''failed'', ''uncertain'', ''suppressed'', ''bounced'', ''complained'') NOT NULL DEFAULT ''queued'',
    attempt_token CHAR(36) NULL,
    message_id VARCHAR(255) NULL,
    started_at DATETIME(3) NULL,
    event_at DATETIME(3) NULL,
    last_error VARCHAR(255) NULL,
    UNIQUE KEY uq_bulletin_job_recipient (job_id, email),
    UNIQUE KEY uq_bulletin_message (message_id),
    KEY ix_bulletin_email_outbox (status, id),
    CONSTRAINT fk_bulletin_recipient_job FOREIGN KEY (job_id) REFERENCES tanah_daily_bulletin_email_job(id),
    CONSTRAINT fk_bulletin_recipient_subscription FOREIGN KEY (subscriber_id) REFERENCES tanah_daily_bulletin_subscriber(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

-- Per status recipient counters on the job row so each send and event updates
-- the aggregate in place instead of rescanning every recipient row
SET @bulletinCountersAdded = (
    SELECT IF(COUNT(*) > 0, 0, 1)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_job'
        AND COLUMN_NAME = 'cnt_queued'
);
SET @bulletinSql = (
    SELECT IF(@bulletinCountersAdded = 1,
        'ALTER TABLE tanah_daily_bulletin_email_job
            ADD COLUMN cnt_queued INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_sending INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_accepted INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_delivered INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_uncertain INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_failed INT NOT NULL DEFAULT 0,
            ADD COLUMN cnt_suppressed INT NOT NULL DEFAULT 0',
        'SELECT 1')
);
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;

-- Backfill the counters once from the recipient table when the columns are added
SET @bulletinSql = (
    SELECT IF(@bulletinCountersAdded = 1,
        'UPDATE tanah_daily_bulletin_email_job j LEFT JOIN (
            SELECT job_id,
                SUM(status = ''queued'') AS q,
                SUM(status = ''sending'') AS s,
                SUM(status = ''accepted'') AS a,
                SUM(status = ''delivered'') AS d,
                SUM(status = ''uncertain'') AS u,
                SUM(status IN (''failed'', ''bounced'', ''complained'')) AS f,
                SUM(status = ''suppressed'') AS x
            FROM tanah_daily_bulletin_email_recipient GROUP BY job_id
        ) c ON c.job_id = j.id
        SET j.cnt_queued = COALESCE(c.q, 0),
            j.cnt_sending = COALESCE(c.s, 0),
            j.cnt_accepted = COALESCE(c.a, 0),
            j.cnt_delivered = COALESCE(c.d, 0),
            j.cnt_uncertain = COALESCE(c.u, 0),
            j.cnt_failed = COALESCE(c.f, 0),
            j.cnt_suppressed = COALESCE(c.x, 0)',
        'SELECT 1')
);
PREPARE bulletinUpgrade FROM @bulletinSql;
EXECUTE bulletinUpgrade;
DEALLOCATE PREPARE bulletinUpgrade;
