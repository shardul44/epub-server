-- =============================================================================
-- 015 — H5P interactive authoring integration
-- Extends interactive books with H5P content storage and block positioning.
-- Run after 004_interactive_blocks.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS h5p_contents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NULL,
  created_by_user_id BIGINT NULL,
  h5p_content_id VARCHAR(64) NOT NULL COMMENT 'H5P server content id (string)',
  title VARCHAR(500) NOT NULL DEFAULT 'Untitled',
  library_name VARCHAR(255) NOT NULL,
  main_library_version VARCHAR(32) NULL,
  content_json JSON NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_h5p_contents_h5p_id (h5p_content_id),
  INDEX idx_h5p_contents_org (organization_id),
  INDEX idx_h5p_contents_created_by (created_by_user_id),
  INDEX idx_h5p_contents_library (library_name),
  CONSTRAINT fk_h5p_contents_org
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_h5p_contents_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS h5p_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  h5p_content_id BIGINT NOT NULL,
  asset_type VARCHAR(64) NOT NULL DEFAULT 'file',
  file_path VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(128) NULL,
  file_size BIGINT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_h5p_assets_content (h5p_content_id),
  CONSTRAINT fk_h5p_assets_content
    FOREIGN KEY (h5p_content_id) REFERENCES h5p_contents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional FK from blocks to h5p_contents (content_json may also store h5pContentId)
ALTER TABLE interactive_blocks
  ADD COLUMN IF NOT EXISTS h5p_content_id BIGINT NULL AFTER content_json,
  ADD COLUMN IF NOT EXISTS layout_json JSON NULL COMMENT 'Fixed layout: x,y,width,height,zIndex' AFTER h5p_content_id;

-- MySQL 8.0.12+ supports IF NOT EXISTS on ADD COLUMN; fallback for older servers:
-- Run manually if ALTER fails: skip duplicate column errors.

ALTER TABLE interactive_blocks
  ADD INDEX IF NOT EXISTS idx_interactive_blocks_h5p (h5p_content_id);

ALTER TABLE interactive_blocks
  ADD CONSTRAINT fk_interactive_blocks_h5p
    FOREIGN KEY (h5p_content_id) REFERENCES h5p_contents(id) ON DELETE SET NULL;
