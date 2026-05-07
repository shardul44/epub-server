-- Migration 008: Add layout_type column to pdf_documents
-- Run this if your database was set up from complete_database_setup.sql before this fix,
-- or from the original schema.sql which was missing this column.

ALTER TABLE pdf_documents
  ADD COLUMN IF NOT EXISTS layout_type ENUM('REFLOWABLE', 'FIXED_LAYOUT') NOT NULL DEFAULT 'REFLOWABLE'
  AFTER analysis_metadata;
