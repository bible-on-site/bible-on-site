-- Add Telegram delivery audit without changing saved bulletins or email history.
-- Split table-creation keywords so the legacy deployment rewriter stays additive.
SET @telegramSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_telegram_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    audience ENUM(''test'', ''real'') NOT NULL DEFAULT ''test'',
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    next_send_at DATETIME(3) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE telegramUpgrade FROM @telegramSql;
EXECUTE telegramUpgrade;
DEALLOCATE PREPARE telegramUpgrade;
INSERT IGNORE INTO tanah_daily_bulletin_telegram_settings (id) VALUES (1);

SET @telegramSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_telegram_job (
    id CHAR(36) NOT NULL PRIMARY KEY,
    bulletin_date DATE NOT NULL,
    audience ENUM(''test'', ''real'') NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL,
    settings_revision BIGINT UNSIGNED NOT NULL,
    bot_id BIGINT UNSIGNED NOT NULL,
    target_chat_id BIGINT NOT NULL,
    pdf_sha256 CHAR(64) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    caption TEXT NOT NULL,
    status ENUM(''queued'', ''sending'', ''sent'', ''failed'', ''uncertain'', ''suppressed'') NOT NULL DEFAULT ''queued'',
    attempt_token CHAR(36) NULL,
    started_at DATETIME(3) NULL,
    provider_message_id BIGINT UNSIGNED NULL,
    provider_file_id VARCHAR(255) NULL,
    last_error VARCHAR(255) NULL,
    sent_at DATETIME(3) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bulletin_telegram_job (bulletin_date, audience, idempotency_key),
    UNIQUE KEY uq_bulletin_telegram_message (target_chat_id, provider_message_id),
    KEY ix_bulletin_telegram_outbox (status, id),
    CONSTRAINT fk_bulletin_telegram_job_bulletin FOREIGN KEY (bulletin_date)
        REFERENCES tanah_daily_bulletin(bulletin_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE telegramUpgrade FROM @telegramSql;
EXECUTE telegramUpgrade;
DEALLOCATE PREPARE telegramUpgrade;
