-- Migration 011: Media Assets table for the Media Library feature
CREATE TABLE IF NOT EXISTS media_assets (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT NULL,
    user_id       BIGINT NULL,
    filename      VARCHAR(500)  NOT NULL,
    original_name VARCHAR(500)  NOT NULL,
    mime_type     VARCHAR(120)  NOT NULL,
    file_size_bytes BIGINT      NOT NULL DEFAULT 0,
    storage_path  VARCHAR(1000) NOT NULL,
    url           VARCHAR(1000) NULL,
    thumbnail_url VARCHAR(1000) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_media_assets_org  (organization_id),
    INDEX idx_media_assets_user (user_id),
    INDEX idx_media_assets_created (created_at),
    CONSTRAINT fk_media_assets_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
    CONSTRAINT fk_media_assets_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
