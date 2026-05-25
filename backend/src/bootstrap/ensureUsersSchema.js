import { UserModel } from '../models/User.js';

/**
 * Ensures users.status and users.last_active exist (login / findById depend on them).
 * Runs once at server startup (see server.js).
 */
export async function ensureUsersSchema() {
  try {
    await UserModel.ensureSchema();
    console.log('[bootstrap] users schema OK');
  } catch (e) {
    console.warn('[bootstrap] ensureUsersSchema failed:', e.message);
  }
}
