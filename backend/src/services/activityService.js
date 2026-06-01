import { UserActivityModel } from '../models/UserActivity.js';
import { getClientIpFromRequest } from '../utils/clientIp.js';

export class ActivityService {
  static async logFromRequest(req, { action, entityType, entityId, summary, metadata }) {
    if (!req.user?.id) return null;
    const baseMeta =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
    const ip = getClientIpFromRequest(req);
    if (ip && baseMeta.ipAddress == null && baseMeta.ip == null) {
      baseMeta.ipAddress = ip;
    }
    const mergedMetadata = Object.keys(baseMeta).length > 0 ? baseMeta : null;
    return UserActivityModel.insert({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? null,
      action,
      entityType,
      entityId,
      summary,
      metadata: mergedMetadata
    });
  }

  static async listForRequest(req, limit) {
    const u = req.user;
    if (!u) return [];
    return UserActivityModel.listForViewer({
      viewerRole: u.role,
      viewerId: u.id,
      viewerOrgId: u.organizationId ?? null,
      limit
    });
  }
}
