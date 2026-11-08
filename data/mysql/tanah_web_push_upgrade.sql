-- Website push notification subscriptions for issue #1096.
--
-- One row per browser push subscription that opted in to the daily perek
-- reminder. Removing the row is the opt-out, and the website deletes rows the
-- push service reports as gone (HTTP 404 or 410). Safe to re-run on every
-- deploy and existing subscriptions are retained.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus the original statement, which would drop every subscriber,
-- so the DDL below is built inside a string the rewriter cannot match (same
-- idiom as tanah_reading_metrics_upgrade.sql). Never write the creation
-- keywords literally in this file, including in comments.
--
-- endpoint_hash is the sha256 hex of the endpoint URL. Endpoints can exceed
-- the InnoDB index prefix limit, so the hash is the primary key instead.
SET @webPushSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_web_push_subscription (
    endpoint_hash CHAR(64) NOT NULL PRIMARY KEY,
    endpoint VARCHAR(1024) NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE webPushUpgrade FROM @webPushSql;
EXECUTE webPushUpgrade;
DEALLOCATE PREPARE webPushUpgrade;
