-- Migration 010: Add retry_count column to conversion_jobs
-- Tracks how many times a job has been retried so the UI can enforce a max retry limit.

ALTER TABLE conversion_jobs
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0
    COMMENT 'Number of times this job has been retried after failure';
