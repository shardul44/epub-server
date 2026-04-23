import pool from '../config/database.js';
import { UserModel } from '../models/User.js';

/**
 * Org license: subscription dates, plan features, seats, subscription-period PDF page quota.
 * PDF quota is total pages for the current subscription window (valid_from … valid_until), not monthly.
 */
export class LicenseService {
  /**
   * Active subscription window (same rules as EntitlementService for org features).
   * @param {number} organizationId
   */
  static async isSubscriptionWindowValid(organizationId) {
    const [rows] = await pool.execute(
      `SELECT 1
       FROM organization_subscriptions os
       WHERE os.organization_id = ?
         AND os.status = 'active'
         AND (os.valid_until IS NULL OR os.valid_until >= CURDATE())
         AND (os.valid_from IS NULL OR os.valid_from <= CURDATE())
       LIMIT 1`,
      [organizationId]
    );
    return rows.length > 0;
  }

  /**
   * Effective seat cap: organizations.member_seat_limit overrides plan.seat_limit when set.
   * @returns {number|null} null = unlimited
   */
  static async resolveSeatLimit(organizationId) {
    const [rows] = await pool.execute(
      `SELECT o.member_seat_limit AS org_limit, p.seat_limit AS plan_limit
       FROM organizations o
       LEFT JOIN organization_subscriptions os
         ON os.organization_id = o.id
         AND os.status = 'active'
         AND (os.valid_until IS NULL OR os.valid_until >= CURDATE())
         AND (os.valid_from IS NULL OR os.valid_from <= CURDATE())
       LEFT JOIN plans p ON p.id = os.plan_id
       WHERE o.id = ?
       LIMIT 1`,
      [organizationId]
    );
    if (!rows.length) return null;
    const { org_limit: orgLimit, plan_limit: planLimit } = rows[0];
    if (orgLimit != null) return Number(orgLimit);
    if (planLimit != null) return Number(planLimit);
    return null;
  }

  /**
   * Total PDF pages allowed for the subscription period (org quota overrides plan default).
   * @returns {number|null} null = unlimited
   */
  static async resolvePdfPageQuota(organizationId) {
    const [rows] = await pool.execute(
      `SELECT o.pdf_page_quota AS org_quota, p.monthly_page_limit AS plan_quota
       FROM organizations o
       LEFT JOIN organization_subscriptions os
         ON os.organization_id = o.id
         AND os.status = 'active'
         AND (os.valid_until IS NULL OR os.valid_until >= CURDATE())
         AND (os.valid_from IS NULL OR os.valid_from <= CURDATE())
       LEFT JOIN plans p ON p.id = os.plan_id
       WHERE o.id = ?
       LIMIT 1`,
      [organizationId]
    );
    if (!rows.length) return null;
    const { org_quota: orgQuota, plan_quota: planQuota } = rows[0];
    if (orgQuota != null) return Number(orgQuota);
    if (planQuota != null) return Number(planQuota);
    return null;
  }

  /**
   * @param {number} organizationId
   * @returns {Promise<object>}
   */
  static async getOrgLicenseStatus(organizationId) {
    const [orgs] = await pool.execute(
      'SELECT id, active, pdf_page_quota, pdf_pages_used FROM organizations WHERE id = ? LIMIT 1',
      [organizationId]
    );
    if (!orgs.length) {
      return {
        isActive: false,
        seats: { used: 0, limit: null, available: null },
        usage: { used: 0, limit: null, remaining: null },
        validity: { validFrom: null, validUntil: null, isExpired: true }
      };
    }

    const orgRow = orgs[0];
    const orgActive = Boolean(orgRow.active);
    const [subs] = await pool.execute(
      `SELECT valid_from, valid_until, status
       FROM organization_subscriptions
       WHERE organization_id = ?
       LIMIT 1`,
      [organizationId]
    );
    const sub = subs[0] || null;

    const windowOk = await this.isSubscriptionWindowValid(organizationId);
    const dateExpired = !sub || sub.status !== 'active' || !windowOk;

    const usedSeats = Number(await UserModel.countMembersByOrganizationId(organizationId));
    const seatLimit = await this.resolveSeatLimit(organizationId);
    const pageLimit = await this.resolvePdfPageQuota(organizationId);
    const pagesUsed = Number(orgRow.pdf_pages_used ?? 0);

    const isActive = orgActive && !dateExpired;

    return {
      isActive,
      seats: {
        used: usedSeats,
        limit: seatLimit,
        available: seatLimit != null ? Math.max(0, seatLimit - usedSeats) : null
      },
      usage: {
        used: pagesUsed,
        limit: pageLimit,
        remaining: pageLimit != null ? Math.max(0, pageLimit - pagesUsed) : null
      },
      validity: {
        validFrom: sub?.valid_from ?? null,
        validUntil: sub?.valid_until ?? null,
        isExpired: dateExpired
      }
    };
  }

  /**
   * Checks subscription-period quota and increments organizations.pdf_pages_used.
   * @param {number|null|undefined} organizationId
   * @param {number} pages
   */
  static async assertAndConsumePdfPages(organizationId, pages) {
    if (organizationId == null || pages <= 0) return;

    const limit = await this.resolvePdfPageQuota(organizationId);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute(
        `SELECT pdf_page_quota, pdf_pages_used FROM organizations WHERE id = ? FOR UPDATE`,
        [organizationId]
      );
      if (!rows.length) {
        await conn.rollback();
        throw new Error('Organization not found');
      }

      const current = Number(rows[0].pdf_pages_used ?? 0);

      if (limit != null && current + pages > limit) {
        await conn.rollback();
        const err = new Error(
          'PDF page quota exceeded for this subscription period. Renew the subscription or increase the quota.'
        );
        err.code = 'USAGE_LIMIT';
        throw err;
      }

      await conn.execute(
        `UPDATE organizations SET pdf_pages_used = pdf_pages_used + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [pages, organizationId]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /**
   * Best-effort rollback if PDF persistence failed after quota was consumed.
   * @param {number|null|undefined} organizationId
   * @param {number} pages
   */
  static async refundPdfPages(organizationId, pages) {
    if (organizationId == null || pages <= 0) return;
    await pool.execute(
      `UPDATE organizations SET pdf_pages_used = GREATEST(0, pdf_pages_used - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [pages, organizationId]
    );
  }
}
