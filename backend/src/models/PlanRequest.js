import pool from '../config/database.js';

export class PlanRequestModel {
  /** Creates plan_requests if missing (migrations/014_plan_requests.sql). */
  static async ensureSchema() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS plan_requests (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT NOT NULL,
        requested_by_user_id BIGINT NOT NULL,
        request_type ENUM('upgrade', 'addon') NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        plan_id BIGINT NULL,
        addon_key VARCHAR(64) NULL,
        request_label VARCHAR(255) NOT NULL,
        member_note TEXT NULL,
        admin_note TEXT NULL,
        reviewed_by_user_id BIGINT NULL,
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_plan_requests_status (status),
        INDEX idx_plan_requests_org (organization_id),
        INDEX idx_plan_requests_created (created_at),
        CONSTRAINT fk_plan_requests_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_plan_requests_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_plan_requests_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
        CONSTRAINT fk_plan_requests_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  static async create({
    organizationId,
    requestedByUserId,
    requestType,
    planId = null,
    addonKey = null,
    requestLabel,
    memberNote = null,
  }) {
    const [result] = await pool.execute(
      `INSERT INTO plan_requests
        (organization_id, requested_by_user_id, request_type, plan_id, addon_key, request_label, member_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        organizationId,
        requestedByUserId,
        requestType,
        planId,
        addonKey,
        requestLabel,
        memberNote,
      ],
    );
    return this.findById(result.insertId);
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT pr.*,
              o.name AS organization_name,
              u.name AS requester_name,
              u.email AS requester_email,
              p.name AS plan_name
       FROM plan_requests pr
       JOIN organizations o ON o.id = pr.organization_id
       JOIN users u ON u.id = pr.requested_by_user_id
       LEFT JOIN plans p ON p.id = pr.plan_id
       WHERE pr.id = ?`,
      [id],
    );
    return rows[0] || null;
  }

  static async findPendingDuplicate({ organizationId, requestType, planId, addonKey }) {
    const [rows] = await pool.execute(
      `SELECT id FROM plan_requests
       WHERE organization_id = ? AND request_type = ? AND status = 'pending'
         AND (plan_id <=> ?) AND (addon_key <=> ?)
       LIMIT 1`,
      [organizationId, requestType, planId, addonKey],
    );
    return rows[0] || null;
  }

  static async countPending() {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM plan_requests WHERE status = 'pending'`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  static async findAll({ status } = {}) {
    let sql = `SELECT pr.*,
                      o.name AS organization_name,
                      u.name AS requester_name,
                      u.email AS requester_email,
                      p.name AS plan_name
               FROM plan_requests pr
               JOIN organizations o ON o.id = pr.organization_id
               JOIN users u ON u.id = pr.requested_by_user_id
               LEFT JOIN plans p ON p.id = pr.plan_id`;
    const params = [];
    if (status) {
      sql += ' WHERE pr.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY pr.created_at DESC';
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  static async findByOrganizationId(organizationId, { limit = 20 } = {}) {
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const [rows] = await pool.execute(
      `SELECT pr.*, p.name AS plan_name
       FROM plan_requests pr
       LEFT JOIN plans p ON p.id = pr.plan_id
       WHERE pr.organization_id = ?
       ORDER BY pr.created_at DESC
       LIMIT ${lim}`,
      [organizationId],
    );
    return rows;
  }

  static async updateStatus(id, { status, adminNote, reviewedByUserId }) {
    await pool.execute(
      `UPDATE plan_requests
       SET status = ?, admin_note = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, adminNote ?? null, reviewedByUserId ?? null, id],
    );
    return this.findById(id);
  }
}
