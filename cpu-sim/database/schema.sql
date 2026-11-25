-- CPU Scheduling Simulator: MySQL schema.
-- The API creates this automatically on first request; run this manually
-- only if your MySQL user cannot create databases.
CREATE DATABASE IF NOT EXISTS cpu_scheduler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cpu_scheduler;

CREATE TABLE IF NOT EXISTS simulation_history (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  algorithm      VARCHAR(10) NOT NULL,
  algorithm_name VARCHAR(64) NOT NULL,
  process_count  SMALLINT UNSIGNED NOT NULL,
  awt            DECIMAL(12,4) NOT NULL,
  att            DECIMAL(12,4) NOT NULL,
  art            DECIMAL(12,4) NOT NULL,
  cpu_util       DECIMAL(7,4) NOT NULL,
  makespan       INT UNSIGNED NOT NULL,
  payload        JSON NOT NULL,          -- { processes: [...], config: {...} }
  PRIMARY KEY (id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- About Us: development team. photo holds a resized image as a data URL.
CREATE TABLE IF NOT EXISTS team_members (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  role        VARCHAR(80) NOT NULL DEFAULT '',
  bio         VARCHAR(300) NOT NULL DEFAULT '',
  photo       MEDIUMTEXT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
