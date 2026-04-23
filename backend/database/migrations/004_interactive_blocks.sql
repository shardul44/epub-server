-- =============================================================================
-- 004 — Interactive content (Kotobee-like blocks)
-- Adds:
--   - interactive_books
--   - interactive_chapters
--   - interactive_blocks
--
-- Notes:
-- - Blocks are stored as JSON for flexible interactive types (text/audio/quiz/dragdrop/...).
-- - Access control is enforced at the API layer (org-scoped).
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

