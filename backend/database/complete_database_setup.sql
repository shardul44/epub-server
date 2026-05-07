-- =============================================================================
-- EPUB SERVER — FULL DATABASE SETUP (run once on a new / empty database)
-- =============================================================================
-- Option A — MySQL command line (Windows PowerShell), from this folder:
--   mysql -u root -p < complete_database_setup.sql
--
-- Option B — MySQL Workbench / DBeaver: open this file and execute all statements.
--
-- Creates: database epub_db, all app tables, licensing (orgs/plans/features),
-- default organization "default-org", default plan "Full access", seeded features.
--
-- After running: start the backend, open the app, Register (if ALLOW_PUBLIC_REGISTRATION=true)
-- or set PLATFORM_ADMIN_EMAIL in .env to promote an existing user.
--
-- If `users` already existed WITHOUT role/organization_id, CREATE TABLE IF NOT EXISTS
-- does not change it — run migrations/002_patch_users_add_multitenant_columns.sql next.
-- =============================================================================

-- Create database
CREATE DATABASE IF NOT EXISTS epub_db;
USE epub_db;

-- Organizations (tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    member_seat_limit INT NULL COMMENT 'Max member + org_admin users; NULL = unlimited',
    pdf_page_quota INT NULL COMMENT 'Total PDF pages allowed for the subscription period (see organization_subscriptions valid dates)',
    pdf_pages_used INT NOT NULL DEFAULT 0 COMMENT 'PDF pages consumed in the current subscription period',
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
    seat_limit INT NULL COMMENT 'Default max member+org_admin users when org.member_seat_limit is NULL; NULL=unlimited',
    monthly_page_limit INT NULL COMMENT 'PDF pages per calendar month; NULL=unlimited',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Feature catalog
CREATE TABLE IF NOT EXISTS features (
    feature_key VARCHAR(120) PRIMARY KEY,
    description VARCHAR(500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan features
CREATE TABLE IF NOT EXISTS plan_features (
    plan_id BIGINT NOT NULL,
    feature_key VARCHAR(120) NOT NULL,
    limits_json JSON NULL,
    PRIMARY KEY (plan_id, feature_key),
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_key) REFERENCES features(feature_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One subscription row per organization
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

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    role ENUM('platform_admin', 'org_admin', 'member') NOT NULL DEFAULT 'member',
    organization_id BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_users_org (organization_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_activities (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    organization_id BIGINT NULL,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id BIGINT NULL,
    summary VARCHAR(500) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_activities_user (user_id, created_at),
    INDEX idx_user_activities_org (organization_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDF Documents table
CREATE TABLE IF NOT EXISTS pdf_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(500) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    file_size BIGINT NOT NULL,
    total_pages INT NOT NULL,
    document_type ENUM('TEXTBOOK', 'WORKBOOK', 'TEACHER_GUIDE', 'ASSESSMENT', 'REFERENCE_MATERIAL', 'OTHER'),
    page_quality ENUM('SCANNED', 'DIGITAL_NATIVE', 'MIXED'),
    has_tables BOOLEAN DEFAULT FALSE,
    has_formulas BOOLEAN DEFAULT FALSE,
    has_multi_column BOOLEAN DEFAULT FALSE,
    scanned_pages_count INT DEFAULT 0,
    digital_pages_count INT DEFAULT 0,
    analysis_metadata TEXT,
    layout_type ENUM('REFLOWABLE', 'FIXED_LAYOUT') NOT NULL DEFAULT 'REFLOWABLE',
    zip_file_name VARCHAR(500),
    zip_file_group_id VARCHAR(255),
    audio_file_path VARCHAR(1000),
    audio_file_name VARCHAR(500),
    audio_synced BOOLEAN DEFAULT FALSE,
    user_id BIGINT NULL,
    organization_id BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_zip_group (zip_file_group_id),
    INDEX idx_created_at (created_at),
    INDEX idx_pdf_documents_user (user_id),
    INDEX idx_pdf_documents_org (organization_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PDF Languages table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS pdf_languages (
    pdf_document_id BIGINT NOT NULL,
    language VARCHAR(50) NOT NULL,
    PRIMARY KEY (pdf_document_id, language),
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    INDEX idx_language (language)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conversion Jobs table
CREATE TABLE IF NOT EXISTS conversion_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pdf_document_id BIGINT NOT NULL,
    status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    current_step ENUM('STEP_0_CLASSIFICATION', 'STEP_1_TEXT_EXTRACTION', 'STEP_2_LAYOUT_ANALYSIS', 
                      'STEP_3_SEMANTIC_STRUCTURING', 'STEP_4_ACCESSIBILITY', 'STEP_5_CONTENT_CLEANUP',
                      'STEP_6_SPECIAL_CONTENT', 'STEP_7_EPUB_GENERATION', 'STEP_8_QA_REVIEW'),
    progress_percentage INT DEFAULT 0,
    epub_file_path VARCHAR(1000),
    error_message TEXT,
    intermediate_data LONGTEXT,
    confidence_score DOUBLE,
    requires_review BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    INDEX idx_pdf_document_id (pdf_document_id),
    INDEX idx_status (status),
    INDEX idx_requires_review (requires_review),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Configurations table
CREATE TABLE IF NOT EXISTS ai_configurations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    api_key VARCHAR(500) NOT NULL,
    model_name VARCHAR(100) NOT NULL DEFAULT 'gemini-pro',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TTS Configurations table
CREATE TABLE IF NOT EXISTS tts_configurations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    credentials_path VARCHAR(1000),
    language_code VARCHAR(10) NOT NULL DEFAULT 'en-US',
    voice_name VARCHAR(100),
    ssml_gender ENUM('MALE', 'FEMALE', 'NEUTRAL') NOT NULL DEFAULT 'NEUTRAL',
    audio_encoding VARCHAR(20) NOT NULL DEFAULT 'MP3',
    speaking_rate DOUBLE DEFAULT 1.0,
    pitch DOUBLE DEFAULT 0.0,
    volume_gain_db DOUBLE DEFAULT 0.0,
    use_free_tts BOOLEAN NOT NULL DEFAULT FALSE,
    page_restrictions TEXT,
    exclusion_prompt TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audio Syncs table
CREATE TABLE IF NOT EXISTS audio_syncs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pdf_document_id BIGINT NOT NULL,
    conversion_job_id BIGINT NOT NULL,
    page_number INT NOT NULL,
    block_id VARCHAR(255),
    start_time DOUBLE NOT NULL,
    end_time DOUBLE NOT NULL,
    audio_file_path VARCHAR(1000) NOT NULL,
    notes TEXT,
    custom_text TEXT,
    is_custom_segment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (conversion_job_id) REFERENCES conversion_jobs(id) ON DELETE CASCADE,
    INDEX idx_pdf_document_id (pdf_document_id),
    INDEX idx_conversion_job_id (conversion_job_id),
    INDEX idx_page_number (page_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Interactive content (Kotobee-like blocks) — stored as JSON blocks
-- =============================================================================
CREATE TABLE IF NOT EXISTS interactive_books (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT NULL,
    created_by_user_id BIGINT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_interactive_books_org (organization_id),
    INDEX idx_interactive_books_created_by (created_by_user_id),
    CONSTRAINT fk_interactive_books_org
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactive_books_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interactive_chapters (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    book_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_interactive_chapters_book (book_id),
    INDEX idx_interactive_chapters_book_pos (book_id, position),
    CONSTRAINT fk_interactive_chapters_book
      FOREIGN KEY (book_id) REFERENCES interactive_books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interactive_blocks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    chapter_id BIGINT NOT NULL,
    type VARCHAR(50) NOT NULL,
    content_json JSON NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_interactive_blocks_chapter (chapter_id),
    INDEX idx_interactive_blocks_chapter_pos (chapter_id, position),
    INDEX idx_interactive_blocks_type (type),
    CONSTRAINT fk_interactive_blocks_chapter
      FOREIGN KEY (chapter_id) REFERENCES interactive_chapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed feature catalog and default plan / org (first boot)
INSERT IGNORE INTO features (feature_key, description) VALUES
    ('conversion.basic', 'PDF conversion and conversion jobs'),
    ('kitaboo.import', 'Kitaboo / FXL import and studio'),
    ('sync_studio', 'Sync studio and media overlay'),
    ('epub_tools', 'EPUB image editor and EPUB checker'),
    ('accessibility_tools', 'Accessibility remediation'),
    ('ai_config', 'AI configuration'),
    ('tts_management', 'TTS management'),
    ('interactive.content', 'Interactive books and editor');

INSERT INTO plans (name, description)
SELECT 'Full access', 'Default plan with all features'
FROM DUAL
WHERE (SELECT COUNT(*) FROM plans) = 0;

SET @seed_plan_id = (SELECT id FROM plans ORDER BY id ASC LIMIT 1);

INSERT IGNORE INTO plan_features (plan_id, feature_key, limits_json)
SELECT @seed_plan_id, f.feature_key, NULL FROM features f;

INSERT INTO organizations (name, slug, active)
SELECT 'Default organization', 'default-org', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'default-org' LIMIT 1);

SET @seed_org_id = (SELECT id FROM organizations WHERE slug = 'default-org' LIMIT 1);

INSERT INTO organization_subscriptions (organization_id, plan_id, status, valid_from, valid_until)
SELECT @seed_org_id, @seed_plan_id, 'active', CURDATE(), NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM organization_subscriptions WHERE organization_id = @seed_org_id
);
