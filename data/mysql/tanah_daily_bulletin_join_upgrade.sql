-- Safe bulletin joining schema upgrade. Existing content and history are retained.
-- Build table DDL in separate fragments to avoid the deployment rewrite.

-- Admin-managed public join-link destinations for the stable /join/{channel} routes.
SET @joinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_join_link (
    channel VARCHAR(20) NOT NULL PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    destination VARCHAR(2048) NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_by VARCHAR(120) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE joinUpgrade FROM @joinSql;
EXECUTE joinUpgrade;
DEALLOCATE PREPARE joinUpgrade;

-- Append-only audit trail for join-link changes.
SET @joinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_join_link_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    channel VARCHAR(20) NOT NULL,
    enabled BOOLEAN NOT NULL,
    destination VARCHAR(2048) NULL,
    revision BIGINT UNSIGNED NOT NULL,
    changed_by VARCHAR(120) NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_bulletin_join_audit (channel, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE joinUpgrade FROM @joinSql;
EXECUTE joinUpgrade;
DEALLOCATE PREPARE joinUpgrade;

-- The verified public Telegram bulletin channel ships enabled. The WhatsApp
-- group invitation stays out of source control: the row is seeded disabled and
-- the verified destination is entered through the admin UI after deployment.
-- INSERT IGNORE preserves previously published destinations on re-run.
INSERT IGNORE INTO tanah_daily_bulletin_join_link (channel, enabled, destination) VALUES
    ('telegram', TRUE, 'https://t.me/alhaperek'),
    ('whatsapp', FALSE, NULL);

-- Durable public email-signup intents: each signup produces one outbox row. The
-- confirmation challenge is minted only when the mail is sent and is stored
-- exclusively as a hash. email_hash indexes throttling/idempotency lookups.
SET @joinSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_signup_intent (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    email_hash CHAR(64) NOT NULL,
    challenge_hash CHAR(64) NOT NULL,
    status ENUM(''pending'', ''sending'', ''sent'', ''confirmed'', ''failed'', ''uncertain'', ''superseded'', ''suppressed'', ''expired'') NOT NULL DEFAULT ''pending'',
    consent_text VARCHAR(500) NOT NULL,
    consent_version VARCHAR(40) NOT NULL,
    consent_source VARCHAR(120) NOT NULL,
    send_token CHAR(36) NULL,
    send_started_at DATETIME(3) NULL,
    message_id VARCHAR(255) NULL,
    ses_status ENUM(''pending'', ''subscribed'', ''opted_out'', ''failed'') NULL,
    ses_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ses_next_attempt_at DATETIME(3) NULL,
    subscriber_id BIGINT UNSIGNED NULL,
    expires_at DATETIME(3) NOT NULL,
    confirmed_at DATETIME(3) NULL,
    last_error VARCHAR(255) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_bulletin_signup_challenge (challenge_hash),
    KEY ix_bulletin_signup_email (email_hash, created_at),
    KEY ix_bulletin_signup_send (status, id),
    KEY ix_bulletin_signup_ses (status, ses_status, id),
    CONSTRAINT fk_bulletin_signup_subscriber FOREIGN KEY (subscriber_id)
        REFERENCES tanah_daily_bulletin_subscriber(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE joinUpgrade FROM @joinSql;
EXECUTE joinUpgrade;
DEALLOCATE PREPARE joinUpgrade;
