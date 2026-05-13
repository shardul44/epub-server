CREATE TABLE IF NOT EXISTS platform_api_keys (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    environment ENUM('production','staging') NOT NULL DEFAULT 'staging',
    token_hash CHAR(64) NOT NULL,
    last_four CHAR(4) NOT NULL,
    expires_at DATE NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_platform_api_keys_env (environment),
    INDEX idx_platform_api_keys_revoked (revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
