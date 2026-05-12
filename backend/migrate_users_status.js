import pool from './src/config/database.js';

async function migrate() {
  try {
    console.log('Migrating users table (status, last_active)...');
    const [rows] = await pool.execute('DESCRIBE users');
    const fields = rows.map((r) => r.Field);

    if (!fields.includes('status')) {
      await pool.execute(
        "ALTER TABLE users ADD COLUMN status ENUM('active','suspended','pending_verification') NOT NULL DEFAULT 'active' AFTER organization_id"
      );
      console.log('Added status column');
    } else {
      console.log('status column already present, skipping');
    }

    if (!fields.includes('last_active')) {
      await pool.execute(
        'ALTER TABLE users ADD COLUMN last_active DATETIME NULL AFTER status'
      );
      console.log('Added last_active column');
    } else {
      console.log('last_active column already present, skipping');
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}

migrate();
