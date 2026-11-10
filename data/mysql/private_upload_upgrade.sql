-- Apply using devops/private-upload-db.mts, never the destructive data-populator Lambda
CREATE TABLE IF NOT EXISTS private_upload_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  quota_bytes BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO private_upload_settings (id, quota_bytes) VALUES (1, 1000000000000);

CREATE TABLE IF NOT EXISTS private_upload_account (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  quota_bytes BIGINT UNSIGNED NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS private_upload_file (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  filename VARCHAR(255) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  part_size INT UNSIGNED NOT NULL,
  upload_id TEXT NULL,
  status ENUM('initializing', 'uploading', 'ready', 'deleting') NOT NULL DEFAULT 'initializing',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX user_files (user_id, updated_at DESC, id DESC),
  FOREIGN KEY (user_id) REFERENCES private_upload_account(user_id)
) ENGINE=InnoDB;

-- Upgrade earlier upload schemas without losing files, reservations or user quotas.
-- Each step is guarded so a retry also recovers an interrupted upgrade.
SET @privateUploadSql = (
  SELECT IF(COUNT(*) = 2, 'SELECT 1',
    'ALTER TABLE private_upload_file MODIFY status ENUM(''initializing'', ''uploading'', ''ready'', ''deleting'') NOT NULL DEFAULT ''initializing'', MODIFY created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file'
    AND ((COLUMN_NAME = 'status'
      AND COLUMN_TYPE = 'enum(''initializing'',''uploading'',''ready'',''deleting'')'
      AND COLUMN_DEFAULT = 'initializing')
    OR (COLUMN_NAME = 'created_at' AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = 6))
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;

SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file ADD updated_at DATETIME(6) NULL AFTER created_at')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND COLUMN_NAME = 'updated_at'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;

UPDATE private_upload_file SET updated_at = created_at WHERE updated_at IS NULL;

SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file MODIFY updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND COLUMN_NAME = 'updated_at'
    AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = 6 AND IS_NULLABLE = 'NO'
    AND LOWER(COLUMN_DEFAULT) = 'current_timestamp(6)' AND LOWER(EXTRA) LIKE '%on update current_timestamp(6)%'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;

SET @privateUploadSql = (
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 'ALTER TABLE private_upload_file ADD INDEX user_files (user_id, updated_at DESC, id DESC)'
    WHEN COUNT(*) = 3 AND SUM(
      (SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id' AND COLLATION = 'A')
      OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'updated_at' AND COLLATION = 'D')
      OR (SEQ_IN_INDEX = 3 AND COLUMN_NAME = 'id' AND COLLATION = 'D')
    ) = 3 THEN 'SELECT 1'
    ELSE 'ALTER TABLE private_upload_file DROP INDEX user_files, ADD INDEX user_files (user_id, updated_at DESC, id DESC)'
  END
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND INDEX_NAME = 'user_files'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
