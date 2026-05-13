-- Platform-wide settings (single row, id = 1)
CREATE TABLE IF NOT EXISTS platform_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
    platform_name VARCHAR(255) NOT NULL DEFAULT 'PDF to EPUB Converter',
    default_plan_id BIGINT NULL COMMENT 'Suggested default plan for new organizations (UI / future automation)',
    max_upload_mb INT NOT NULL DEFAULT 100,
    session_timeout_minutes INT NOT NULL DEFAULT 60,
    smtp_host VARCHAR(255) NOT NULL DEFAULT '',
    smtp_port INT NOT NULL DEFAULT 587,
    smtp_from_email VARCHAR(255) NOT NULL DEFAULT '',
    smtp_admin_alert_email VARCHAR(255) NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (id) VALUES (1);
