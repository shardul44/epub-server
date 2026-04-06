import pool from './src/config/database.js';

async function migrate() {
    try {
        console.log('Migrating kitaboo_zones table for bold/italic...');
        const [rows] = await pool.execute('DESCRIBE kitaboo_zones');
        const fields = rows.map(r => r.Field);

        if (!fields.includes('is_bold')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN is_bold TINYINT(1) DEFAULT 0');
            console.log('Added is_bold column');
        }
        if (!fields.includes('is_italic')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN is_italic TINYINT(1) DEFAULT 0');
            console.log('Added is_italic column');
        }
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        process.exit();
    }
}

migrate();
