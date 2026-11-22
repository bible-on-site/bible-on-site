-- Safe bulletin engagement schema upgrade (#3707). Existing subscribers, consent
-- records, jobs and delivery history are retained.
-- Build table DDL in separate fragments to avoid the deployment rewrite.
--
-- Tracked open and click engagement on delivery attempts:
--   recipient opened_at/open_count/clicked_at/click_count - latest tracked
--     activity and the per-edition event count for that recipient
--   job tracked - whether SES engagement collection was enabled at enqueue,
--     so untracked history stays distinguishable from a measured zero
--   subscriber admin_action/admin_actor/admin_action_at - the recorded admin
--     inactivity-review unsubscribe
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
