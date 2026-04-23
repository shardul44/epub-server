-- Multi-tenant licensing (run against existing epub_db)
-- mysql -u user -p epub_db < migrations/001_multitenant_licensing.sql

USE epub_db;

-- Organizations (tenants / clients)
CREATE TABLE IF NOT EXISTS organizations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_organizations_slug (slug),
    INDEX idx_organizations_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan templates
CREATE TABLE IF NOT EXISTS plans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Feature catalog (capability keys enforced in code)
CREATE TABLE IF NOT EXISTS features (
    feature_key VARCHAR(120) PRIMARY KEY,
    description VARCHAR(500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan ↔ feature (optional per-plan limits in JSON)
CREATE TABLE IF NOT EXISTS plan_features (
    plan_id BIGINT NOT NULL,
    feature_key VARCHAR(120) NOT NULL,
    limits_json JSON NULL,
    PRIMARY KEY (plan_id, feature_key),
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_key) REFERENCES features(feature_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One subscription row per organization (current plan)
CREATE TABLE IF NOT EXISTS organization_subscriptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT NOT NULL UNIQUE,
    plan_id BIGINT NOT NULL,
    status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
    valid_from DATE NULL,
    valid_until DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
    INDEX idx_org_sub_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users: role + tenant
ALTER TABLE users
    ADD COLUMN role ENUM('platform_admin', 'org_admin', 'member') NOT NULL DEFAULT 'member' AFTER phone_number,
    ADD COLUMN organization_id BIGINT NULL AFTER role,
    ADD INDEX idx_users_org (organization_id),
    ADD CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Seed catalog features
INSERT IGNORE INTO features (feature_key, description) VALUES
    ('conversion.basic', 'PDF conversion and conversion jobs'),
    ('kitaboo.import', 'Kitaboo / FXL import and studio'),
    ('sync_studio', 'Sync studio and media overlay'),
    ('epub_tools', 'EPUB image editor and EPUB checker'),
    ('accessibility_tools', 'Accessibility remediation'),
    ('ai_config', 'AI configuration'),
    ('tts_management', 'TTS management');

-- Default plan + org for existing deployments
INSERT INTO plans (name, description)
SELECT 'Full access', 'Default plan with all features'
FROM DUAL
WHERE (SELECT COUNT(*) FROM plans) = 0;

SET @default_plan_id = (SELECT id FROM plans ORDER BY id ASC LIMIT 1);

INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
SELECT @default_plan_id, f.feature_key, NULL FROM features f;

INSERT INTO organizations (name, slug, active)
SELECT 'Default organization', 'default-org', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'default-org' LIMIT 1);

SET @default_org_id = (SELECT id FROM organizations WHERE slug = 'default-org' LIMIT 1);

INSERT INTO organization_subscriptions (organization_id, plan_id, status, valid_from, valid_until)
SELECT @default_org_id, @default_plan_id, 'active', CURDATE(), NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM organization_subscriptions WHERE organization_id = @default_org_id
);

-- Existing users → default org as org_admin (preserve product access)
UPDATE users u
SET u.role = 'org_admin', u.organization_id = @default_org_id
WHERE u.organization_id IS NULL AND u.role = 'member';
