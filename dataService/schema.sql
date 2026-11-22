-- Grid Massing Studio 云存储表结构
-- 服务启动时会自动执行；也可以在 MySQL 中手动执行本文件。

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 每个用户固定 10 个存储位置（slot 1-10），每个位置保存一份场景快照
CREATE TABLE IF NOT EXISTS storage_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  slot TINYINT UNSIGNED NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  scene_json LONGTEXT NOT NULL,
  scene_size INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_user_slot (user_id, slot),
  KEY idx_storage_user (user_id),
  CONSTRAINT fk_storage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 分享链接：实时链接保存当前场景与 revision；冻结链接不再递增 revision
CREATE TABLE IF NOT EXISTS share_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token CHAR(16) NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  project_key VARCHAR(32) NOT NULL DEFAULT '',
  title VARCHAR(64) NOT NULL DEFAULT '',
  scene_json LONGTEXT NOT NULL,
  scene_size INT UNSIGNED NOT NULL DEFAULT 0,
  scene_version INT UNSIGNED NOT NULL DEFAULT 1,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  live_mode TINYINT(1) NOT NULL DEFAULT 1,
  allow_comment TINYINT(1) NOT NULL DEFAULT 1,
  allow_download TINYINT(1) NOT NULL DEFAULT 0,
  revoked_at DATETIME NULL,
  view_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_share_token (token),
  KEY idx_share_owner (owner_user_id),
  KEY idx_share_project (project_key),
  CONSTRAINT fk_share_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评审评论：anchor_json 保存世界坐标、对象引用与对象原点，用于实时场景下跟随对象
CREATE TABLE IF NOT EXISTS share_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  share_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  anchor_json TEXT NOT NULL,
  scene_version INT UNSIGNED NOT NULL DEFAULT 1,
  author_token CHAR(32) NOT NULL DEFAULT '',
  author_name VARCHAR(32) NOT NULL DEFAULT '',
  author_user_id BIGINT UNSIGNED NULL,
  reply_to_user_id BIGINT UNSIGNED NULL,
  reply_to_name VARCHAR(32) NOT NULL DEFAULT '',
  content VARCHAR(1000) NOT NULL,
  resolved_at DATETIME NULL,
  resolved_by VARCHAR(32) NOT NULL DEFAULT '',
  deleted_at DATETIME NULL,
  client_id VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comment_share (share_id, parent_id),
  KEY idx_comment_created (share_id, created_at),
  CONSTRAINT fk_comment_share FOREIGN KEY (share_id) REFERENCES share_links (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
