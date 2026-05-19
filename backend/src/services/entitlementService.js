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

  static async isOrganizationActive(orgId) {
    const [orgs] = await pool.execute(
      'SELECT active FROM organizations WHERE id = ? LIMIT 1',
      [orgId]
    );
    return orgs.length > 0 && !!orgs[0].active;
  }

  static async hasActiveSubscription(orgId) {
    const [rows] = await pool.execute(
      `SELECT 1 FROM organization_subscriptions os
       WHERE os.organization_id = ?
         AND os.status = 'active'
         AND (os.valid_until IS NULL OR os.valid_until >= CURDATE())
         AND (os.valid_from IS NULL OR os.valid_from <= CURDATE())
       LIMIT 1`,
      [orgId]
    );
    return rows.length > 0;
  }

  static async fetchPlanFeatureKeys(orgId) {
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

  /** Plan feature keys only — no fallback to the full catalog. */
  static async resolveTenantFeatureKeys(orgId) {
    if (!orgId) return [];
    if (!(await EntitlementService.isOrganizationActive(orgId))) return [];
    if (!(await EntitlementService.hasActiveSubscription(orgId))) return [];
    return EntitlementService.fetchPlanFeatureKeys(orgId);
  }

  /**
   * @param {object} userRow - row from users with role, organization_id
   * @returns {Promise<string[]>} ['*'] for platform / org admins; otherwise plan features from DB
   */
  static async getFeatureKeysForUser(userRow) {
    if (!userRow) return [];
    if (userRow.role === ROLES.PLATFORM_ADMIN) {
      return ['*'];
    }
    // Org admins manage the tenant; plan rows are often incomplete in dev / legacy DBs.
    if (userRow.role === ROLES.ORG_ADMIN) {
      return ['*'];
    }

    const orgId = userRow.organization_id;
    if (!orgId) return [];

    if (userRow.role === ROLES.MEMBER) {
      return EntitlementService.resolveTenantFeatureKeys(orgId);
    }

    return [];
  }
}
