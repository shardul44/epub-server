import pool from './src/config/database.js';

async function migrate() {
    try {
        console.log('Migrating kitaboo_zones table for artistic styles (stroke, shadow)...');
        const [rows] = await pool.execute('DESCRIBE kitaboo_zones');
        const fields = rows.map(r => r.Field);

        if (!fields.includes('stroke_color')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN stroke_color VARCHAR(20) DEFAULT NULL');
            console.log('Added stroke_color column');
        }
        if (!fields.includes('stroke_width')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN stroke_width FLOAT DEFAULT NULL');
            console.log('Added stroke_width column');
        }
        if (!fields.includes('text_shadow')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN text_shadow VARCHAR(255) DEFAULT NULL');
            console.log('Added text_shadow column');
        }
        if (!fields.includes('letter_spacing')) {
            await pool.execute('ALTER TABLE kitaboo_zones ADD COLUMN letter_spacing FLOAT DEFAULT NULL');
            console.log('Added letter_spacing column');
        }
        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        process.exit();
    }
}

migrate();
