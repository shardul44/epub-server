-- Member/org plan upgrade and add-on requests for platform admin review.
-- Run: mysql -u user -p epub_db < migrations/014_plan_requests.sql

USE epub_db;

CREATE TABLE IF NOT EXISTS plan_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  requested_by_user_id BIGINT NOT NULL,
  request_type ENUM('upgrade', 'addon') NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  plan_id BIGINT NULL COMMENT 'Target plan when request_type = upgrade',
  addon_key VARCHAR(64) NULL COMMENT 'e.g. pages-500, seats-5',
  request_label VARCHAR(255) NOT NULL COMMENT 'Human-readable summary',
  member_note TEXT NULL,
  admin_note TEXT NULL,
  reviewed_by_user_id BIGINT NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_plan_requests_status (status),
  INDEX idx_plan_requests_org (organization_id),
  INDEX idx_plan_requests_created (created_at),
  CONSTRAINT fk_plan_requests_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_requests_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_requests_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
  CONSTRAINT fk_plan_requests_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
