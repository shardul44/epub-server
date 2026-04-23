-- =============================================================================
-- Use this when you already had a `users` table BEFORE multitenant was added.
-- `complete_database_setup.sql` uses CREATE TABLE IF NOT EXISTS — so an OLD
-- `users` table is left unchanged (no `role` / `organization_id`).
--
-- Prerequisites (run full script or 001 migration first if missing):
--   - `organizations` table must exist (FK target).
--
-- Usage:
--   mysql -u root -p epub_db < migrations/002_patch_users_add_multitenant_columns.sql
-- =============================================================================

USE epub_db;

ALTER TABLE users
  ADD COLUMN role ENUM('platform_admin', 'org_admin', 'member') NOT NULL DEFAULT 'member' AFTER phone_number;

ALTER TABLE users
  ADD COLUMN organization_id BIGINT NULL AFTER role;

ALTER TABLE users
  ADD INDEX idx_users_org (organization_id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_organization
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Attach existing users to default org as org_admin (same as migration 001)
SET @default_org_id = (SELECT id FROM organizations WHERE slug = 'default-org' LIMIT 1);

UPDATE users u
SET u.role = 'org_admin', u.organization_id = @default_org_id
WHERE u.organization_id IS NULL AND u.role = 'member';
