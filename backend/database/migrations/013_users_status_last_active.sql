-- Account status and last activity for user management / bootstrap.
-- Safe to run once; if columns already exist, skip or remove duplicate ALTERs.

ALTER TABLE users
  ADD COLUMN status ENUM('active', 'suspended', 'pending_verification') NOT NULL DEFAULT 'active'
  AFTER organization_id;

ALTER TABLE users
  ADD COLUMN last_active DATETIME NULL AFTER status;
