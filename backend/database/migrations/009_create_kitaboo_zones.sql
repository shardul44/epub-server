-- Migration 009: Create kitaboo_zones table for FXL job zone storage
-- Run this if you get "Table 'kitaboo_zones' doesn't exist" errors.

CREATE TABLE IF NOT EXISTS kitaboo_zones (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id           VARCHAR(64)  NOT NULL,
  pdf_document_id  INT UNSIGNED NOT NULL,
  page_number      INT UNSIGNED NOT NULL DEFAULT 1,
  reading_order    INT UNSIGNED NOT NULL DEFAULT 0,
  zone_type        VARCHAR(64)  NOT NULL DEFAULT 'text',
  content          TEXT,
  x                FLOAT        NOT NULL DEFAULT 0,
  y                FLOAT        NOT NULL DEFAULT 0,
  width            FLOAT        NOT NULL DEFAULT 0,
  height           FLOAT        NOT NULL DEFAULT 0,
  metadata         JSON,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_job_id          (job_id),
  INDEX idx_pdf_document_id (pdf_document_id),
  INDEX idx_job_page        (job_id, page_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
