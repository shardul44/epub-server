import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

/**
 * If PLATFORM_ADMIN_EMAIL is set, promote that user to platform_admin (no org).
 */
async function usersHasRoleColumn() {
  try {
    await pool.query('SELECT role FROM users LIMIT 0');
    return true;
  } catch (e) {
    const n = typeof e?.errno === 'number' ? e.errno : null;
    if (n === 1054) return false;
    if (n === 1146) return false;
    return false;
  }
}

export async function ensurePlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  if (!email || !String(email).trim()) return;

  if (!(await usersHasRoleColumn())) {
    console.warn(
      '[bootstrap] `users.role` missing. If you ran complete_database_setup.sql but had an OLD `users` table, MySQL skipped recreating it — run: backend/database/migrations/002_patch_users_add_multitenant_columns.sql (after `organizations` exists). Or see migrations/001_multitenant_licensing.sql for a full upgrade.'
    );
    return;
  }

  try {
    const [result] = await pool.execute(
      'UPDATE users SET role = ?, organization_id = NULL WHERE email = ?',
      [ROLES.PLATFORM_ADMIN, email.trim()]
    );
    if (result.affectedRows > 0) {
      console.log(`[bootstrap] Platform admin role applied to ${email.trim()}`);
    }
  } catch (e) {
    console.warn('[bootstrap] ensurePlatformAdmin failed:', e.message);
  }
}
