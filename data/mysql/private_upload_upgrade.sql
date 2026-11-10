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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX user_files (user_id, id),
  FOREIGN KEY (user_id) REFERENCES private_upload_account(user_id)
) ENGINE=InnoDB;
