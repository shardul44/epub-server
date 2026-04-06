import pool from './src/config/database.js';

async function checkSchema() {
    try {
        const [rows] = await pool.execute('DESCRIBE kitaboo_zones');
        for (const row of rows) {
            console.log(`${row.Field} | ${row.Type}`);
        }
    } catch (err) {
        console.warn('Error checking schema:', err.message);
    } finally {
        process.exit();
    }
}

checkSchema();
