import pool from './src/config/database.js';

async function updateSchema() {
  try {
    console.log('Creating kitaboo_zones table...');
    
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS kitaboo_zones (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          job_id VARCHAR(64) DEFAULT NULL,
          pdf_document_id BIGINT NOT NULL,
          page_number INT NOT NULL,
          zone_id VARCHAR(100) NOT NULL,
          type VARCHAR(50),
          x DOUBLE NOT NULL,
          y DOUBLE NOT NULL,
          width DOUBLE NOT NULL,
          height DOUBLE NOT NULL,
          reading_order INT,
          content TEXT,
          enrichment_type VARCHAR(50),
          enrichment_value TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (pdf_document_id) REFERENCES pdf_documents(id) ON DELETE CASCADE,
          INDEX idx_pdf_page (pdf_document_id, page_number),
          INDEX idx_job_page (job_id, page_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    try {
      await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN job_id VARCHAR(64) DEFAULT NULL AFTER id');
    } catch (e) {
      if (!e.message?.includes('Duplicate')) throw e;
    }
    try {
      await pool.execute('ALTER TABLE kitaboo_zones ADD INDEX idx_job_page (job_id, page_number)');
    } catch (e) {
      if (!e.message?.includes('Duplicate')) throw e;
    }

    console.log('Successfully created/updated kitaboo_zones table.');
    process.exit(0);
  } catch (error) {
    console.error('Error updating schema:', error);
    process.exit(1);
  }
}

updateSchema();

