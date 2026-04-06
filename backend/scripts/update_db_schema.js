import pool from '../src/config/database.js';

async function updateSchema() {
    console.log('Checking database schema...');
    try {
        const [columns] = await pool.execute('SHOW COLUMNS FROM kitaboo_zones');
        const existing = columns.map(c => c.Field);

        if (!existing.includes('origin')) {
            console.log('Adding origin column...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN origin TEXT');
        }
        if (!existing.includes('ascender')) {
            console.log('Adding ascender column...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN ascender FLOAT DEFAULT 0.8');
        }
        if (!existing.includes('descender')) {
            console.log('Adding descender column...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN descender FLOAT DEFAULT -0.2');
        }
        if (!existing.includes('font_file')) {
            console.log('Adding font_file column...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN font_file VARCHAR(255)');
        }
        if (!existing.includes('lines')) {
            console.log('Adding lines column (multi-line sentence layout)...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN `lines` TEXT DEFAULT NULL');
        }
        if (!existing.includes('points')) {
            console.log('Adding points column (polygon/multi-line zone shape)...');
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN `points` TEXT DEFAULT NULL');
        }

        console.log('Schema update complete.');
        process.exit(0);
    } catch (err) {
        console.error('Schema update failed:', err);
        process.exit(1);
    }
}

updateSchema();
