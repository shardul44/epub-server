import pool from '../config/database.js';

/**
 * Idempotent H5P schema setup (MySQL versions without ADD COLUMN IF NOT EXISTS).
 */
export async function ensureH5pSchema() {
  await pool.execute(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const alterColumns = [
    'ADD COLUMN h5p_content_id BIGINT NULL',
    'ADD COLUMN layout_json JSON NULL'
  ];
  for (const clause of alterColumns) {
    try {
      await pool.execute(`ALTER TABLE interactive_blocks ${clause}`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
  }

  try {
    await pool.execute(
      'ALTER TABLE h5p_assets ADD CONSTRAINT fk_h5p_assets_content FOREIGN KEY (h5p_content_id) REFERENCES h5p_contents(id) ON DELETE CASCADE'
    );
  } catch (e) {
    if (e.code !== 'ER_CANT_CREATE_TABLE' && e.code !== 'ER_DUP_KEYNAME' && e.errno !== 1826) {
      // ignore duplicate FK
      if (!String(e.message).includes('Duplicate')) throw e;
    }
  }
}
