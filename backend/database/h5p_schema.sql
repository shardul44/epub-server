-- =============================================================================
-- H5P Interactive EPUB — standalone CREATE TABLE scripts
-- Maps to existing interactive_books / interactive_chapters as "books" / "chapters"
-- =============================================================================

-- Books (alias: interactive_books — already exists)
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
  INDEX idx_interactive_books_created_by (created_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chapters (alias: interactive_chapters)
CREATE TABLE IF NOT EXISTS interactive_chapters (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  book_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_interactive_chapters_book (book_id),
  INDEX idx_interactive_chapters_book_pos (book_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interactive blocks (text, image, video, h5p, …)
CREATE TABLE IF NOT EXISTS interactive_blocks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chapter_id BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,
  content_json JSON NOT NULL,
  h5p_content_id BIGINT NULL,
  layout_json JSON NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_interactive_blocks_chapter (chapter_id),
  INDEX idx_interactive_blocks_chapter_pos (chapter_id, position),
  INDEX idx_interactive_blocks_type (type),
  INDEX idx_interactive_blocks_h5p (h5p_content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- H5P content registry (metadata + JSON mirror)
CREATE TABLE IF NOT EXISTS h5p_contents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NULL,
  created_by_user_id BIGINT NULL,
  h5p_content_id VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT 'Untitled',
  library_name VARCHAR(255) NOT NULL,
  main_library_version VARCHAR(32) NULL,
  content_json JSON NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_h5p_contents_h5p_id (h5p_content_id),
  INDEX idx_h5p_contents_org (organization_id),
  INDEX idx_h5p_contents_created_by (created_by_user_id),
  INDEX idx_h5p_contents_library (library_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- H5P uploaded assets (images, video, audio used inside H5P)
CREATE TABLE IF NOT EXISTS h5p_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  h5p_content_id BIGINT NOT NULL,
  asset_type VARCHAR(64) NOT NULL DEFAULT 'file',
  file_path VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(128) NULL,
  file_size BIGINT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_h5p_assets_content (h5p_content_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
