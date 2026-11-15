-- Apply using devops/private-archive-db.mts, never the destructive data-populator Lambda
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

-- Named author homes and administrator-managed root folders. Folder paths are
-- immutable S3 prefixes. File bytes remain private and retain their existing keys.
CREATE TABLE IF NOT EXISTS private_archive_folder (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  parent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  path VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY sibling_folders (parent_id, name),
  INDEX parent_listing (parent_id, updated_at DESC, id DESC),
  FOREIGN KEY (parent_id) REFERENCES private_archive_folder(id),
  FOREIGN KEY (owner_id) REFERENCES private_upload_account(user_id)
) ENGINE=InnoDB;
INSERT IGNORE INTO private_archive_folder (id, parent_id, name, path, owner_id)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, '', '', NULL);
INSERT IGNORE INTO private_archive_folder (id, parent_id, name, path, owner_id)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'authors', 'authors/', NULL);

SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_account ADD home_directory_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_account' AND COLUMN_NAME = 'home_directory_id'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_account ADD account_kind ENUM(''author'', ''admin'') NOT NULL DEFAULT ''author''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_account' AND COLUMN_NAME = 'account_kind'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;

-- A UUID suffix retains every legacy account even when names collide. New
-- accounts receive the author's display name, with a suffix only on collision.
INSERT IGNORE INTO private_archive_folder (id, parent_id, name, path, owner_id)
SELECT user_id, '00000000-0000-0000-0000-000000000002',
  CONCAT(LEFT(REPLACE(REPLACE(username, '/', '_'), CHAR(92), '_'), 200), ' (', user_id, ')'),
  CONCAT('authors/', LEFT(REPLACE(REPLACE(username, '/', '_'), CHAR(92), '_'), 200), ' (', user_id, ')/'), user_id
FROM private_upload_account WHERE account_kind = 'author' AND home_directory_id IS NULL;
UPDATE private_upload_account SET home_directory_id = user_id
WHERE account_kind = 'author' AND home_directory_id IS NULL;

SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file ADD directory_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND COLUMN_NAME = 'directory_id'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file ADD object_key VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND COLUMN_NAME = 'object_key'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
UPDATE private_upload_file f JOIN private_upload_account a ON a.user_id = f.user_id
SET f.directory_id = COALESCE(f.directory_id, a.home_directory_id),
    f.object_key = COALESCE(f.object_key, CONCAT('users/', f.user_id, '/', f.id)),
    f.updated_at = f.updated_at
WHERE f.directory_id IS NULL OR f.object_key IS NULL;

SET @privateUploadSql = (
  SELECT IF(COUNT(*) = 3, 'SELECT 1',
    'ALTER TABLE private_upload_file MODIFY directory_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, MODIFY object_key VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL, MODIFY filename VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file'
    AND ((COLUMN_NAME IN ('directory_id', 'object_key') AND IS_NULLABLE = 'NO')
      OR (COLUMN_NAME = 'filename' AND COLLATION_NAME = 'utf8mb4_0900_bin'))
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;

SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file ADD CONSTRAINT private_upload_file_directory_fk FOREIGN KEY (directory_id) REFERENCES private_archive_folder(id)')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND CONSTRAINT_NAME = 'private_upload_file_directory_fk'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
SET @privateUploadSql = (
  SELECT IF(COUNT(*) > 0, 'SELECT 1',
    'ALTER TABLE private_upload_file ADD INDEX directory_files (directory_id, updated_at DESC, id DESC), ADD INDEX directory_names (directory_id, filename)')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'private_upload_file' AND INDEX_NAME = 'directory_files'
);
PREPARE privateUploadUpgrade FROM @privateUploadSql;
EXECUTE privateUploadUpgrade;
DEALLOCATE PREPARE privateUploadUpgrade;
