-- Safe bulletin engagement schema upgrade (#3707). Existing subscribers, consent
-- records, jobs and delivery history are retained.
-- Build table DDL in separate fragments to avoid the deployment rewrite.
--
-- Tracked open and click engagement on delivery attempts:
--   recipient opened_at/open_count/clicked_at/click_count - latest tracked
--     activity and the per-edition event count for that recipient
--   job tracked - whether SES engagement collection was enabled at enqueue,
--     so untracked history stays distinguishable from a measured zero
--   job tracking_gap_at - latest instant of a known collection outage
--     that affected this edition regardless of when it was sent
--   subscriber admin_action/admin_actor/admin_action_at - the recorded admin
--     inactivity-review unsubscribe
--   recipient delivered_at - the earliest timestamp that first proved
--     delivery, so a backdated edition sent later cannot fake a year of
--     delivery history
--   tanah_daily_bulletin_email_notification - one durable row per consumed
--     queue notification so SQS redelivery can never inflate engagement
--     counters or reapply an event
-- Engagement lives on the retained delivery attempt itself, so retention
-- matches delivery history and always covers the one-year review window.

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_recipient ADD COLUMN opened_at DATETIME(3) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
        AND COLUMN_NAME = 'opened_at'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_recipient ADD COLUMN open_count INT UNSIGNED NOT NULL DEFAULT 0')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
        AND COLUMN_NAME = 'open_count'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_recipient ADD COLUMN clicked_at DATETIME(3) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
        AND COLUMN_NAME = 'clicked_at'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_recipient ADD COLUMN click_count INT UNSIGNED NOT NULL DEFAULT 0')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
        AND COLUMN_NAME = 'click_count'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_job ADD COLUMN tracked TINYINT(1) NOT NULL DEFAULT 0')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_job'
        AND COLUMN_NAME = 'tracked'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_job ADD COLUMN tracking_gap_at DATETIME(3) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_job'
        AND COLUMN_NAME = 'tracking_gap_at'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_subscriber ADD COLUMN admin_action VARCHAR(120) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_subscriber'
        AND COLUMN_NAME = 'admin_action'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_subscriber ADD COLUMN admin_actor VARCHAR(120) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_subscriber'
        AND COLUMN_NAME = 'admin_actor'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_subscriber ADD COLUMN admin_action_at DATETIME(3) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_subscriber'
        AND COLUMN_NAME = 'admin_action_at'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_daily_bulletin_email_recipient ADD COLUMN delivered_at DATETIME(3) NULL')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
        AND COLUMN_NAME = 'delivered_at'
);
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;

SET @engagementSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_daily_bulletin_email_notification (
    notification_id VARCHAR(255) NOT NULL PRIMARY KEY,
    recipient_id BIGINT UNSIGNED NULL,
    kind VARCHAR(40) NOT NULL,
    applied_at DATETIME(3) NOT NULL,
    KEY ix_bulletin_email_notification_recipient (recipient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE engagementUpgrade FROM @engagementSql;
EXECUTE engagementUpgrade;
DEALLOCATE PREPARE engagementUpgrade;
