import pool from '../config/database.js';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants/roles.js';

const userCols =
  'id, name, email, phone_number, role, organization_id, status, last_active, created_at, updated_at';

export class UserModel {
  static async findAll() {
    const [rows] = await pool.execute(`SELECT ${userCols} FROM users ORDER BY id ASC`);
    return rows;
  }

  static async findByOrganizationId(organizationId) {
    const [rows] = await pool.execute(
      `SELECT ${userCols} FROM users WHERE organization_id = ? ORDER BY name ASC`,
      [organizationId]
    );
    return rows;
  }

  /** Member and org_admin users in the org (each consumes one seat). */
  static async countMembersByOrganizationId(organizationId) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM users WHERE organization_id = ? AND role IN (?, ?)`,
      [organizationId, ROLES.MEMBER, ROLES.ORG_ADMIN]
    );
    return rows[0]?.cnt ?? 0;
  }

  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${userCols} FROM users WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async findByEmail(email) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  }

  static async existsByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM users WHERE email = ?',
      [email]
    );
    return rows[0].count > 0;
  }

  static async create(userData) {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const role = userData.role || ROLES.MEMBER;
    const orgId = userData.organizationId !== undefined ? userData.organizationId : null;
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, phone_number, role, organization_id) VALUES (?, ?, ?, ?, ?, ?)',
      [userData.name, userData.email, hashedPassword, userData.phoneNumber || null, role, orgId]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, userData) {
    const updates = [];
    const values = [];

    if (userData.name) {
      updates.push('name = ?');
      values.push(userData.name);
    }
    if (userData.email) {
      updates.push('email = ?');
      values.push(userData.email);
    }
    if (userData.phoneNumber !== undefined) {
      updates.push('phone_number = ?');
      values.push(userData.phoneNumber);
    }
    if (userData.password) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      updates.push('password = ?');
      values.push(hashedPassword);
    }
    if (userData.role !== undefined) {
      updates.push('role = ?');
      values.push(userData.role);
    }
    if (userData.organizationId !== undefined) {
      updates.push('organization_id = ?');
      values.push(userData.organizationId);
    }
    if (userData.status !== undefined) {
      updates.push('status = ?');
      values.push(userData.status);
    }
    if (userData.lastActive !== undefined) {
      updates.push('last_active = ?');
      values.push(userData.lastActive);
    }

    if (updates.length === 0) {
      return await this.findById(id);
    }

    values.push(id);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  /** Set all non-suspended users in an org to suspended (e.g. when org is deactivated). */
  static async deactivateUsersByOrganizationId(organizationId) {
    const [result] = await pool.execute(
      `UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND status != 'suspended'`,
      [organizationId]
    );
    return result.affectedRows ?? 0;
  }

  static async delete(id) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }

  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}
