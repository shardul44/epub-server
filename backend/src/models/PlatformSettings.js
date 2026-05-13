import pool from '../config/database.js';

let uploadBytesCache = { bytes: null, at: 0 };
const UPLOAD_CACHE_MS = 60_000;

export class PlatformSettingsModel {
  /**
   * Creates `platform_settings` if missing (same shape as migrations/012_platform_settings.sql).
   * Called on server startup so admins do not have to run SQL manually.
   */
  static async ensureSchema() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
        platform_name VARCHAR(255) NOT NULL DEFAULT 'PDF to EPUB Converter',
        default_plan_id BIGINT NULL COMMENT 'Suggested default plan for new organizations (UI / future automation)',
        max_upload_mb INT NOT NULL DEFAULT 100,
        session_timeout_minutes INT NOT NULL DEFAULT 60,
        smtp_host VARCHAR(255) NOT NULL DEFAULT '',
        smtp_port INT NOT NULL DEFAULT 587,
        smtp_from_email VARCHAR(255) NOT NULL DEFAULT '',
        smtp_admin_alert_email VARCHAR(255) NOT NULL DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.execute(`INSERT IGNORE INTO platform_settings (id) VALUES (1)`);
  }

  static invalidateUploadCache() {
    uploadBytesCache = { bytes: null, at: 0 };
  }

  static async ensureRow() {
    try {
      await pool.execute(`INSERT IGNORE INTO platform_settings (id) VALUES (1)`);
    } catch {
      /* table may not exist until migration */
    }
  }

  static async getRow() {
    try {
      await this.ensureRow();
      const [rows] = await pool.execute(
        `SELECT id, platform_name, default_plan_id, max_upload_mb, session_timeout_minutes,
                smtp_host, smtp_port, smtp_from_email, smtp_admin_alert_email, updated_at
         FROM platform_settings WHERE id = 1 LIMIT 1`
      );
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  static async getMaxUploadBytesCached() {
    const now = Date.now();
    if (uploadBytesCache.bytes != null && now - uploadBytesCache.at < UPLOAD_CACHE_MS) {
      return uploadBytesCache.bytes;
    }
    try {
      const row = await this.getRow();
      const mb = row?.max_upload_mb != null ? Number(row.max_upload_mb) : 100;
      const safeMb = Number.isFinite(mb) && mb >= 1 && mb <= 2048 ? mb : 100;
      const bytes = safeMb * 1024 * 1024;
      uploadBytesCache = { bytes, at: now };
      return bytes;
    } catch {
      const fallback = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10);
      uploadBytesCache = { bytes: fallback, at: now };
      return fallback;
    }
  }

  static async getSessionTimeoutMinutes() {
    try {
      const row = await this.getRow();
      const m = row?.session_timeout_minutes != null ? Number(row.session_timeout_minutes) : 60;
      if (!Number.isFinite(m)) return 60;
      return Math.min(Math.max(Math.round(m), 5), 60 * 24 * 30);
    } catch {
      return 60;
    }
  }

  static async updateGeneral({
    platformName,
    defaultPlanId,
    maxUploadMb,
    sessionTimeoutMinutes
  }) {
    const name = String(platformName || '').trim().slice(0, 255) || 'PDF to EPUB Converter';
    const planSql =
      defaultPlanId === '' || defaultPlanId === undefined || defaultPlanId === null
        ? null
        : Number(defaultPlanId);
    if (planSql != null && Number.isNaN(planSql)) {
      throw new Error('Invalid default plan id');
    }
    const mb = Math.min(2048, Math.max(1, Math.round(Number(maxUploadMb) || 100)));
    const sess = Math.min(60 * 24 * 30, Math.max(5, Math.round(Number(sessionTimeoutMinutes) || 60)));

    await pool.execute(
      `INSERT INTO platform_settings (id, platform_name, default_plan_id, max_upload_mb, session_timeout_minutes)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         platform_name = ?,
         default_plan_id = ?,
         max_upload_mb = ?,
         session_timeout_minutes = ?`,
      [name, planSql, mb, sess, name, planSql, mb, sess]
    );
    this.invalidateUploadCache();
    return this.getRow();
  }

  static async updateEmail({ smtpHost, smtpPort, smtpFromEmail, smtpAdminAlertEmail }) {
    const port = Math.min(65535, Math.max(1, Math.round(Number(smtpPort) || 587)));
    const host = String(smtpHost ?? '').trim().slice(0, 255);
    const fromE = String(smtpFromEmail ?? '').trim().slice(0, 255);
    const adminE = String(smtpAdminAlertEmail ?? '').trim().slice(0, 255);

    await pool.execute(
      `INSERT INTO platform_settings (id, smtp_host, smtp_port, smtp_from_email, smtp_admin_alert_email)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         smtp_host = ?,
         smtp_port = ?,
         smtp_from_email = ?,
         smtp_admin_alert_email = ?`,
      [host, port, fromE, adminE, host, port, fromE, adminE]
    );
    return this.getRow();
  }
}
