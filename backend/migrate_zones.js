import pool from './src/config/database.js';

async function migrate() {
    try {
        console.log('Migrating kitaboo_zones table...');
        const [rows] = await pool.execute('DESCRIBE kitaboo_zones');
        const fields = rows.map(r => r.Field);

        if (!fields.includes('font_size')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN font_size DOUBLE DEFAULT NULL');
            console.log('Added font_size column');
        }
        if (!fields.includes('font_family')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN font_family VARCHAR(255) DEFAULT NULL');
            console.log('Added font_family column');
        }
        if (!fields.includes('color')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN color VARCHAR(50) DEFAULT NULL');
            console.log('Added color column');
        }
        if (!fields.includes('style_runs')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN style_runs JSON DEFAULT NULL COMMENT "Word-level style runs: [{start,end,bold,italic,color}]"');
            console.log('Added style_runs column (word-level styles in sentence sync)');
        }
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        process.exit();
    }
}

migrate();
