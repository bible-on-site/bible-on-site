-- Add WhatsApp audit and cached verification without changing existing history.
-- Split creation keywords so the legacy deployment rewriter stays additive.
SET @whatsappSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_whatsapp_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    audience ENUM(''test'', ''real'') NOT NULL DEFAULT ''test'',
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    group_lookup_token CHAR(36) NULL,
    group_lookup_until DATETIME(3) NULL,
    next_group_lookup_at DATETIME(3) NULL,
    message_check_month CHAR(7) NULL,
    message_checks_used SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    next_message_check_at DATETIME(3) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE whatsappUpgrade FROM @whatsappSql;
EXECUTE whatsappUpgrade;
DEALLOCATE PREPARE whatsappUpgrade;
INSERT IGNORE INTO tanah_daily_bulletin_whatsapp_settings (id) VALUES (1);

SET @whatsappSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_whatsapp_verification (
    audience ENUM(''test'', ''real'') NOT NULL PRIMARY KEY,
    config_sha256 CHAR(64) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    connection_state ENUM(''authorized'', ''notAuthorized'', ''blocked'', ''suspended'', ''sleepMode'', ''starting'', ''unknown'') NOT NULL,
    group_id VARCHAR(80) NULL,
    title VARCHAR(255) NULL,
    member_count INT UNSIGNED NULL,
    sender_id VARCHAR(80) NULL,
    sender_phone VARCHAR(20) NULL,
    participant_digest CHAR(71) NULL,
    checked_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE whatsappUpgrade FROM @whatsappSql;
EXECUTE whatsappUpgrade;
DEALLOCATE PREPARE whatsappUpgrade;

SET @whatsappSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_whatsapp_job (
    id CHAR(36) NOT NULL PRIMARY KEY,
    bulletin_date DATE NOT NULL,
    audience ENUM(''test'', ''real'') NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL,
    settings_revision BIGINT UNSIGNED NOT NULL,
    instance_id VARCHAR(20) NOT NULL,
    target_group_id VARCHAR(80) NOT NULL,
    sender_id VARCHAR(80) NOT NULL,
    sender_phone VARCHAR(20) NOT NULL,
    participant_digest CHAR(71) NOT NULL,
    config_sha256 CHAR(64) NOT NULL,
    pdf_sha256 CHAR(64) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    caption TEXT NOT NULL,
    status ENUM(''queued'', ''sending'', ''accepted'', ''sent'', ''failed'', ''uncertain'', ''suppressed'') NOT NULL DEFAULT ''queued'',
    attempt_token CHAR(36) NULL,
    started_at DATETIME(3) NULL,
    upload_started_at DATETIME(3) NULL,
    available_after DATETIME(3) NULL,
    provider_message_id VARCHAR(128) NULL,
    provider_status VARCHAR(20) NULL,
    reconcile_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    reconcile_token CHAR(36) NULL,
    reconcile_until DATETIME(3) NULL,
    next_reconcile_at DATETIME(3) NULL,
    last_error VARCHAR(255) NULL,
    sent_at DATETIME(3) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bulletin_whatsapp_job (bulletin_date, audience, idempotency_key),
    UNIQUE KEY uq_bulletin_whatsapp_message (instance_id, target_group_id, provider_message_id),
    KEY ix_bulletin_whatsapp_outbox (status, available_after, id),
    KEY ix_bulletin_whatsapp_reconciliation (status, next_reconcile_at, id),
    CONSTRAINT fk_bulletin_whatsapp_job_bulletin FOREIGN KEY (bulletin_date)
        REFERENCES tanah_daily_bulletin(bulletin_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE whatsappUpgrade FROM @whatsappSql;
EXECUTE whatsappUpgrade;
DEALLOCATE PREPARE whatsappUpgrade;
