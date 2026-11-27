-- Mobile app push device registrations for issue #1097.
--
-- One row per verified Firebase Auth installation identity (user_id) that
-- opted in to the daily perek reminder from the Android/iOS app. A row
-- carries one current (installation_id, token) pair: token rotation replaces
-- the token for the same verified identity, while a pre-auth row is recovered
-- only through the possession-checked legacy migration in POST /api/push/device.
-- DELETE /api/push/device removes the row (opt-out), and the sender drops rows
-- FCM reports as unregistered. The topics column only reflects what the device
-- last claimed — FCM topic membership on the device is the delivery source of
-- truth. Safe to re-run on every deploy and existing registrations are retained.
--
-- The data-deploy Lambda rewrites every table-creation statement it can see
-- into DROP plus the original statement, which would drop every registered
-- device, so the DDL below is built inside a string the rewriter cannot
-- match (same idiom as tanah_web_push_upgrade.sql). Never write the
-- creation keywords literally in this file, including in comments.
SET @pushDeviceSql = CONCAT('CREATE ', 'TABLE IF NOT EXISTS tanah_push_device (
    user_id VARCHAR(128) NOT NULL PRIMARY KEY,
    auth_user_id VARCHAR(128) NULL,
    installation_id VARCHAR(128) NOT NULL,
    token VARCHAR(1024) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    topics VARCHAR(1024) NOT NULL,
    app_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_token (token(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE pushDeviceUpgrade FROM @pushDeviceSql;
EXECUTE pushDeviceUpgrade;
DEALLOCATE PREPARE pushDeviceUpgrade;

-- Verified registrations carry the Firebase Auth uid in auth_user_id. Rows
-- written before installation ownership existed keep NULL and are the legacy
-- migration/opt-out state and cannot update an auth-bound row.
SET @pushDeviceSql = (
    SELECT IF(COUNT(*) > 0, 'SELECT 1',
        'ALTER TABLE tanah_push_device ADD COLUMN auth_user_id VARCHAR(128) NULL AFTER user_id')
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tanah_push_device'
        AND COLUMN_NAME = 'auth_user_id'
);
PREPARE pushDeviceAuthUpgrade FROM @pushDeviceSql;
EXECUTE pushDeviceAuthUpgrade;
DEALLOCATE PREPARE pushDeviceAuthUpgrade;
