import pool from '../config/database.js';

export class PlanModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT id, name, description, seat_limit, monthly_page_limit, created_at, updated_at FROM plans ORDER BY name ASC'
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT id, name, description, seat_limit, monthly_page_limit, created_at, updated_at FROM plans WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async create({ name, description, seatLimit, monthlyPageLimit }) {
    const [result] = await pool.execute(
      'INSERT INTO plans (name, description, seat_limit, monthly_page_limit) VALUES (?, ?, ?, ?)',
      [
        name,
        description || null,
        seatLimit === undefined ? null : seatLimit,
        monthlyPageLimit === undefined ? null : monthlyPageLimit
      ]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { name, description, seatLimit, monthlyPageLimit }) {
    const updates = [];
    const values = [];
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (seatLimit !== undefined) {
      updates.push('seat_limit = ?');
      values.push(seatLimit === null || seatLimit === '' ? null : Number(seatLimit));
    }
    if (monthlyPageLimit !== undefined) {
      updates.push('monthly_page_limit = ?');
      values.push(monthlyPageLimit === null || monthlyPageLimit === '' ? null : Number(monthlyPageLimit));
    }
    if (!updates.length) return await this.findById(id);
    values.push(id);
    await pool.execute(
      `UPDATE plans SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async countOrganizationSubscriptions(planId) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM organization_subscriptions WHERE plan_id = ?',
      [planId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM plans WHERE id = ?', [id]);
  }

  static async listFeatures(planId) {
    const [rows] = await pool.execute(
      'SELECT feature_key, limits_json FROM plan_features WHERE plan_id = ? ORDER BY feature_key',
      [planId]
    );
    return rows;
  }

  static async setPlanFeature(planId, featureKey, limitsJson = null) {
    let lj = null;
    if (limitsJson !== null && limitsJson !== undefined) {
      lj = typeof limitsJson === 'string' ? limitsJson : JSON.stringify(limitsJson);
    }
    await pool.execute(
      `INSERT INTO plan_features (plan_id, feature_key, limits_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE limits_json = VALUES(limits_json)`,
      [planId, featureKey, lj]
    );
  }

  static async removePlanFeature(planId, featureKey) {
    await pool.execute('DELETE FROM plan_features WHERE plan_id = ? AND feature_key = ?', [
      planId,
      featureKey
    ]);
  }
}
