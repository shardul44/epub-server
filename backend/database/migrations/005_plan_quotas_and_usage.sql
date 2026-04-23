-- Plan-level default seat & monthly PDF page quotas; per-org PDF usage by calendar month.
-- Run: mysql -u user -p epub_db < migrations/005_plan_quotas_and_usage.sql

USE epub_db;

ALTER TABLE plans
  ADD COLUMN seat_limit INT NULL
    COMMENT 'Default max member+org_admin users when org.member_seat_limit is NULL; NULL=unlimited'
    AFTER description,
  ADD COLUMN monthly_page_limit INT NULL
    COMMENT 'PDF pages per calendar month; NULL=unlimited'
    AFTER seat_limit;

CREATE TABLE IF NOT EXISTS usage_tracking (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  year SMALLINT NOT NULL,
  month TINYINT NOT NULL,
  pages_used INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usage_org_period (organization_id, year, month),
  INDEX idx_usage_org (organization_id),
  CONSTRAINT fk_usage_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
