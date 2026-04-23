import pool from '../config/database.js';

const cols =
  'id, organization_id, created_by_user_id, title, description, metadata_json, created_at, updated_at';

export class InteractiveBookModel {
  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM interactive_books WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async findAll() {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM interactive_books ORDER BY created_at DESC, id DESC`
    );
    return rows;
  }

  static async findByOrganizationId(organizationId) {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM interactive_books WHERE organization_id = ? ORDER BY created_at DESC, id DESC`,
      [organizationId]
    );
    return rows;
  }

  static async create({ organizationId = null, createdByUserId = null, title, description = null, metadataJson = null }) {
    const [result] = await pool.execute(
      'INSERT INTO interactive_books (organization_id, created_by_user_id, title, description, metadata_json) VALUES (?, ?, ?, ?, ?)',
      [organizationId, createdByUserId, title, description, metadataJson]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { title, description, metadataJson }) {
    const updates = [];
    const values = [];
    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (metadataJson !== undefined) {
      updates.push('metadata_json = ?');
      values.push(metadataJson);
    }
    if (updates.length === 0) return await this.findById(id);
    values.push(id);
    await pool.execute(
      `UPDATE interactive_books SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM interactive_books WHERE id = ?', [id]);
  }
}

