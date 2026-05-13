import crypto from 'crypto';
import pool from '../config/database.js';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function keyPrefix(environment) {
  return environment === 'production' ? 'sk-prod-' : 'sk-stg-';
}

function displayStatus(row) {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at) {
    const end = new Date(row.expires_at);
    if (Number.isNaN(end.getTime())) return 'active';
    const now = new Date();
    const days = (end.getTime() - now.getTime()) / 86400000;
    if (days < 0) return 'expired';
    if (days <= 14) return 'expiring';
  }
  return 'active';
}

function toDto(row) {
  const env = row.environment === 'production' ? 'production' : 'staging';
  const last = String(row.last_four || '').slice(-4).padStart(4, 'x');
  const masked = `${keyPrefix(env)}${'.'.repeat(20)}${last}`;
  return {
    id: Number(row.id),
    name: row.name,
    environment: env,
    maskedKey: masked,
    status: displayStatus(row),
    expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
    createdAt: row.created_at,
  };
}

export class PlatformApiKeyModel {
  static async ensureSchema() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS platform_api_keys (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        environment ENUM('production','staging') NOT NULL DEFAULT 'staging',
        token_hash CHAR(64) NOT NULL,
        last_four CHAR(4) NOT NULL,
        expires_at DATE NULL,
        revoked_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_platform_api_keys_env (environment),
        INDEX idx_platform_api_keys_revoked (revoked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  static async listForAdmin() {
    await this.ensureSchema();
    const [rows] = await pool.execute(
      `SELECT id, name, environment, last_four, expires_at, revoked_at, created_at
       FROM platform_api_keys
       ORDER BY created_at DESC`
    );
    return rows.map(toDto);
  }

  /**
   * @returns {{ dto: object, plainSecret: string }}
   */
  static async create({ name, environment }) {
    await this.ensureSchema();
    const env = environment === 'production' ? 'production' : 'staging';
    const label = String(name || '').trim().slice(0, 120);
    if (!label) throw new Error('name is required');
    const prefix = keyPrefix(env);
    const body = crypto.randomBytes(18).toString('hex');
    const plainSecret = `${prefix}${body}`;
    const tokenHash = sha256Hex(plainSecret);
    const lastFour = plainSecret.slice(-4);
    const days = env === 'production' ? 365 : 180;
    const [result] = await pool.execute(
      `INSERT INTO platform_api_keys (name, environment, token_hash, last_four, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), NULL)`,
      [label, env, tokenHash, lastFour, days]
    );
    const id = result.insertId;
    const [rows] = await pool.execute(
      `SELECT id, name, environment, last_four, expires_at, revoked_at, created_at FROM platform_api_keys WHERE id = ?`,
      [id]
    );
    return { dto: toDto(rows[0]), plainSecret };
  }

  static async revoke(id) {
    await this.ensureSchema();
    const [r] = await pool.execute(
      `UPDATE platform_api_keys SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revoked_at IS NULL`,
      [id]
    );
    return r.affectedRows > 0;
  }

  static async renew(id) {
    await this.ensureSchema();
    const [rows] = await pool.execute(
      `SELECT id, revoked_at, expires_at FROM platform_api_keys WHERE id = ? LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) throw new Error('API key not found');
    if (row.revoked_at) throw new Error('Cannot renew a revoked key');
    await pool.execute(
      `UPDATE platform_api_keys
       SET expires_at = DATE_ADD(GREATEST(CURDATE(), IFNULL(expires_at, CURDATE())), INTERVAL 90 DAY),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );
    const [out] = await pool.execute(
      `SELECT id, name, environment, last_four, expires_at, revoked_at, created_at FROM platform_api_keys WHERE id = ?`,
      [id]
    );
    return toDto(out[0]);
  }
}
