-- Migration 012: Fix kitaboo_zones table to match application code expectations.
-- The original migration 009 created a minimal schema missing many columns that
-- KitabooZone.js requires. This migration adds all missing columns safely.

USE epub_db;

-- Add zone_id (the zone identifier like "p1_w0", "p1_z1_s0")
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS zone_id VARCHAR(100) NOT NULL DEFAULT '' AFTER page_number;

-- Add type (zone type: "text", "image", etc.)
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS type VARCHAR(50) NULL AFTER zone_id;

-- Add enrichment columns
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS enrichment_type VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS enrichment_value TEXT NULL;

-- Add font/style columns
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS font_size DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS font_family VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS color VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS is_bold TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_italic TINYINT(1) NOT NULL DEFAULT 0;

-- Add glyph/layout columns
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS origin JSON NULL,
  ADD COLUMN IF NOT EXISTS ascender DOUBLE NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS descender DOUBLE NOT NULL DEFAULT -0.2,
  ADD COLUMN IF NOT EXISTS font_file VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS stroke_color VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS stroke_width DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS text_shadow VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS letter_spacing DOUBLE NULL;

-- Add polygon/line columns
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS `lines` JSON NULL,
  ADD COLUMN IF NOT EXISTS `points` JSON NULL;

-- Add style_runs for multi-style text spans
ALTER TABLE kitaboo_zones
  ADD COLUMN IF NOT EXISTS style_runs JSON NULL;

-- Drop the old zone_type column if it exists (replaced by zone_id + type)
-- We do this carefully: only drop if zone_type exists AND zone_id now exists
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'kitaboo_zones'
    AND COLUMN_NAME = 'zone_type'
);
-- Use a prepared statement to conditionally drop
SET @drop_sql = IF(@col_exists > 0,
  'ALTER TABLE kitaboo_zones DROP COLUMN zone_type',
  'SELECT 1'
);
PREPARE drop_stmt FROM @drop_sql;
EXECUTE drop_stmt;
DEALLOCATE PREPARE drop_stmt;

-- Drop the old metadata column if it exists (replaced by per-field columns)
SET @meta_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'kitaboo_zones'
    AND COLUMN_NAME = 'metadata'
);
SET @drop_meta = IF(@meta_exists > 0,
  'ALTER TABLE kitaboo_zones DROP COLUMN metadata',
  'SELECT 1'
);
PREPARE drop_meta_stmt FROM @drop_meta;
EXECUTE drop_meta_stmt;
DEALLOCATE PREPARE drop_meta_stmt;

-- Ensure indexes exist
ALTER TABLE kitaboo_zones
  ADD INDEX IF NOT EXISTS idx_job_id (job_id),
  ADD INDEX IF NOT EXISTS idx_pdf_document_id (pdf_document_id),
  ADD INDEX IF NOT EXISTS idx_job_page (job_id, page_number);
