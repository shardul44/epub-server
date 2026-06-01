import pool from '../config/database.js';

function serializeMetadata(metadata) {
  if (metadata == null) return null;
  if (typeof metadata === 'string') return metadata;
  if (typeof metadata === 'object') return JSON.stringify(metadata);
  return null;
}

export class UserActivityModel {
  static async insert({ userId, organizationId, action, entityType, entityId, summary, metadata }) {
    const [result] = await pool.execute(
      `INSERT INTO user_activities (user_id, organization_id, action, entity_type, entity_id, summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        organizationId ?? null,
        action,
        entityType ?? null,
        entityId ?? null,
        summary ?? null,
        serializeMetadata(metadata)
      ]
    );
    return result.insertId;
  }

  /**
   * @param {object} opts
   * @param {'member'|'org_admin'|'platform_admin'} opts.viewerRole
   * @param {number} opts.viewerId
   * @param {number|null} opts.viewerOrgId
   * @param {number} [opts.limit]
   */
  static async listForViewer(opts) {
    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
    const { viewerRole, viewerId, viewerOrgId } = opts;

    if (viewerRole === 'member') {
      const [rows] = await pool.execute(
        `SELECT id, user_id, organization_id, action, entity_type, entity_id, summary, metadata, created_at
         FROM user_activities
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ${limit}`,
        [viewerId]
      );
      return rows;
    }

    if (viewerRole === 'org_admin') {
      if (viewerOrgId == null) return [];
      const [rows] = await pool.execute(
        `SELECT ua.id, ua.user_id, ua.organization_id, ua.action, ua.entity_type, ua.entity_id, ua.summary, ua.metadata, ua.created_at,
                u.name AS actor_name, u.email AS actor_email
         FROM user_activities ua
         LEFT JOIN users u ON u.id = ua.user_id
         WHERE ua.organization_id = ?
         ORDER BY ua.created_at DESC
         LIMIT ${limit}`,
        [viewerOrgId]
      );
      return rows;
    }

    if (viewerRole === 'platform_admin') {
      const [rows] = await pool.execute(
        `SELECT ua.id, ua.user_id, ua.organization_id, ua.action, ua.entity_type, ua.entity_id, ua.summary, ua.metadata, ua.created_at,
                u.name AS actor_name, u.email AS actor_email,
                o.name AS organization_name
         FROM user_activities ua
         LEFT JOIN users u ON u.id = ua.user_id
         LEFT JOIN organizations o ON o.id = ua.organization_id
         ORDER BY ua.created_at DESC
         LIMIT ${limit}`
      );
      return rows;
    }

    return [];
  }
}
