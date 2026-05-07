/**
 * fix-kitaboo-zones-schema.js
 * Applies migration 012 — adds all missing columns to kitaboo_zones.
 * Run once: node fix-kitaboo-zones-schema.js
 */
import pool from './src/config/database.js';

async function fixSchema() {
  const conn = await pool.getConnection();
  try {
    console.log('Checking kitaboo_zones table...');

    // Helper: check if a column exists
    async function hasColumn(col) {
      const [rows] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kitaboo_zones' AND COLUMN_NAME = ?`,
        [col]
      );
      return rows[0].cnt > 0;
    }

    // Helper: add column if missing
    async function addColumn(col, definition) {
      if (!(await hasColumn(col))) {
        console.log(`  Adding column: ${col}`);
        await conn.execute(`ALTER TABLE kitaboo_zones ADD COLUMN ${col} ${definition}`);
      } else {
        console.log(`  Column already exists: ${col}`);
      }
    }

    // Helper: drop column if present
    async function dropColumn(col) {
      if (await hasColumn(col)) {
        console.log(`  Dropping obsolete column: ${col}`);
        await conn.execute(`ALTER TABLE kitaboo_zones DROP COLUMN \`${col}\``);
      }
    }

    // Add all columns the code expects
    await addColumn('zone_id',          'VARCHAR(100) NOT NULL DEFAULT ""');
    await addColumn('type',             'VARCHAR(50) NULL');
    await addColumn('enrichment_type',  'VARCHAR(50) NULL');
    await addColumn('enrichment_value', 'TEXT NULL');
    await addColumn('font_size',        'DOUBLE NULL');
    await addColumn('font_family',      'VARCHAR(255) NULL');
    await addColumn('color',            'VARCHAR(50) NULL');
    await addColumn('is_bold',          'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumn('is_italic',        'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumn('origin',           'JSON NULL');
    await addColumn('ascender',         'DOUBLE NOT NULL DEFAULT 0.8');
    await addColumn('descender',        'DOUBLE NOT NULL DEFAULT -0.2');
    await addColumn('font_file',        'VARCHAR(500) NULL');
    await addColumn('stroke_color',     'VARCHAR(50) NULL');
    await addColumn('stroke_width',     'DOUBLE NULL');
    await addColumn('text_shadow',      'VARCHAR(255) NULL');
    await addColumn('letter_spacing',   'DOUBLE NULL');
    await addColumn('`lines`',          'JSON NULL');
    await addColumn('`points`',         'JSON NULL');
    await addColumn('style_runs',       'JSON NULL');

    // Drop obsolete columns from old migration 009
    await dropColumn('zone_type');
    await dropColumn('metadata');

    // Ensure indexes
    const [idxRows] = await conn.execute(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kitaboo_zones'`
    );
    const existingIndexes = new Set(idxRows.map(r => r.INDEX_NAME));

    if (!existingIndexes.has('idx_job_id')) {
      console.log('  Adding index: idx_job_id');
      await conn.execute('ALTER TABLE kitaboo_zones ADD INDEX idx_job_id (job_id)');
    }
    if (!existingIndexes.has('idx_pdf_document_id')) {
      console.log('  Adding index: idx_pdf_document_id');
      await conn.execute('ALTER TABLE kitaboo_zones ADD INDEX idx_pdf_document_id (pdf_document_id)');
    }
    if (!existingIndexes.has('idx_job_page')) {
      console.log('  Adding index: idx_job_page');
      await conn.execute('ALTER TABLE kitaboo_zones ADD INDEX idx_job_page (job_id, page_number)');
    }

    console.log('\n✓ kitaboo_zones schema is now up to date.');

    // Show final column list
    const [cols] = await conn.execute('DESCRIBE kitaboo_zones');
    console.log('\nFinal columns:');
    cols.forEach(c => console.log(`  ${c.Field.padEnd(20)} ${c.Type}`));

  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

fixSchema();
