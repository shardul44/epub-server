import pool from '../config/database.js';

export class OrganizationModel {
  /** @returns {number|null} null = unlimited */
  static normalizeMemberSeatLimit(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 1) {
      throw new Error('memberSeatLimit must be a positive integer or empty for unlimited');
    }
    return n;
  }

  /** @returns {number|null} null = unlimited */
  static normalizePdfPageQuota(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(value, 10);
    if (Number.isNaN(n) || n < 1) {
      throw new Error('pdfPageQuota must be a positive integer or empty for unlimited');
    }
    return n;
  }

  static async resetPdfPagesUsed(id) {
    await pool.execute(
      'UPDATE organizations SET pdf_pages_used = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
  }

  static async findAll() {
    const [rows] = await pool.execute(
      `SELECT id, name, slug, active, member_seat_limit, pdf_page_quota, pdf_pages_used, created_at, updated_at FROM organizations ORDER BY name ASC`
    );
    return rows;
  }

  /** Includes current subscription plan (if any) and subscription validity dates. */
  static async findAllWithPlan() {
    const [rows] = await pool.execute(
      `SELECT o.id, o.name, o.slug, o.active, o.member_seat_limit, o.pdf_page_quota, o.pdf_pages_used,
              o.created_at, o.updated_at,
              os.plan_id, p.name AS plan_name,
              os.valid_from AS sub_valid_from, os.valid_until AS sub_valid_until
       FROM organizations o
       LEFT JOIN organization_subscriptions os ON os.organization_id = o.id
       LEFT JOIN plans p ON p.id = os.plan_id
       ORDER BY o.name ASC`
    );
    return rows;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      'SELECT id, name, slug, active, member_seat_limit, pdf_page_quota, pdf_pages_used, created_at, updated_at FROM organizations WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  static async findBySlug(slug) {
    const [rows] = await pool.execute(
      'SELECT id, name, slug, active, member_seat_limit, pdf_page_quota, pdf_pages_used, created_at, updated_at FROM organizations WHERE slug = ?',
      [slug]
    );
    return rows[0] || null;
  }

  static async create({ name, slug, active = true, memberSeatLimit, pdfPageQuota }) {
    const msl = OrganizationModel.normalizeMemberSeatLimit(memberSeatLimit);
    const pq = OrganizationModel.normalizePdfPageQuota(pdfPageQuota);
    const [result] = await pool.execute(
      'INSERT INTO organizations (name, slug, active, member_seat_limit, pdf_page_quota, pdf_pages_used) VALUES (?, ?, ?, ?, ?, 0)',
      [name, slug, active ? 1 : 0, msl, pq]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { name, slug, active, memberSeatLimit, pdfPageQuota }) {
    const updates = [];
    const values = [];
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (slug !== undefined) {
      updates.push('slug = ?');
      values.push(slug);
    }
    if (active !== undefined) {
      updates.push('active = ?');
      values.push(active ? 1 : 0);
    }
    if (memberSeatLimit !== undefined) {
      updates.push('member_seat_limit = ?');
      values.push(
        memberSeatLimit === null || memberSeatLimit === ''
          ? null
          : OrganizationModel.normalizeMemberSeatLimit(memberSeatLimit)
      );
    }
    if (pdfPageQuota !== undefined) {
      updates.push('pdf_page_quota = ?');
      values.push(
        pdfPageQuota === null || pdfPageQuota === ''
          ? null
          : OrganizationModel.normalizePdfPageQuota(pdfPageQuota)
      );
    }
    if (!updates.length) return await this.findById(id);
    values.push(id);
    await pool.execute(
      `UPDATE organizations SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM organizations WHERE id = ?', [id]);
  }
}
