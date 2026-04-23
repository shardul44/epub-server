import pool from '../config/database.js';
import { OrganizationModel } from './Organization.js';

function normDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export class OrganizationSubscriptionModel {
  static async findByOrganizationId(organizationId) {
    const [rows] = await pool.execute(
      `SELECT id, organization_id, plan_id, status, valid_from, valid_until, created_at, updated_at
       FROM organization_subscriptions WHERE organization_id = ?`,
      [organizationId]
    );
    return rows[0] || null;
  }

  static async upsertForOrganization(organizationId, { planId, status = 'active', validFrom, validUntil }) {
    const existing = await this.findByOrganizationId(organizationId);
    const newFrom = validFrom ? String(validFrom).slice(0, 10) : null;
    const newUntil = validUntil ? String(validUntil).slice(0, 10) : null;
    const oldFrom = existing ? normDate(existing.valid_from) : null;
    const oldUntil = existing ? normDate(existing.valid_until) : null;
    const datesChanged = oldFrom !== newFrom || oldUntil !== newUntil;

    if (existing) {
      await pool.execute(
        `UPDATE organization_subscriptions
         SET plan_id = ?, status = ?, valid_from = ?, valid_until = ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ?`,
        [planId, status, validFrom ?? null, validUntil ?? null, organizationId]
      );
    } else {
      await pool.execute(
        `INSERT INTO organization_subscriptions (organization_id, plan_id, status, valid_from, valid_until)
         VALUES (?, ?, ?, ?, ?)`,
        [organizationId, planId, status, validFrom ?? null, validUntil ?? null]
      );
    }

    if (datesChanged) {
      await OrganizationModel.resetPdfPagesUsed(organizationId);
    }

    return await this.findByOrganizationId(organizationId);
  }
}
