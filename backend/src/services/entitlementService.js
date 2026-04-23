import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

/**
 * Online entitlements only: loads plan features from the database; JWT carries a snapshot for authorization.
 */
export class EntitlementService {
  static async getAllFeatureKeys() {
    const [rows] = await pool.execute('SELECT feature_key FROM features ORDER BY feature_key');
    return rows.map((r) => r.feature_key);
  }

  /**
   * @param {object} userRow - row from users with role, organization_id
   * @returns {Promise<string[]>} use ['*'] for platform admin (all features)
   */
  static async getFeatureKeysForUser(userRow) {
    if (!userRow) return [];
    if (userRow.role === ROLES.PLATFORM_ADMIN) {
      return [];
    }
    const orgId = userRow.organization_id;
    if (!orgId) return [];

    const [orgs] = await pool.execute(
      'SELECT active FROM organizations WHERE id = ? LIMIT 1',
      [orgId]
    );
    if (!orgs.length || !orgs[0].active) return [];

    const [rows] = await pool.execute(
      `SELECT pf.feature_key
       FROM organization_subscriptions os
       INNER JOIN plan_features pf ON pf.plan_id = os.plan_id
       WHERE os.organization_id = ?
         AND os.status = 'active'
         AND (os.valid_until IS NULL OR os.valid_until >= CURDATE())
         AND (os.valid_from IS NULL OR os.valid_from <= CURDATE())`,
      [orgId]
    );
    return [...new Set(rows.map((r) => r.feature_key))];
  }
}
