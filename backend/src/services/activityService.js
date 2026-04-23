import { UserActivityModel } from '../models/UserActivity.js';

export class ActivityService {
  static async logFromRequest(req, { action, entityType, entityId, summary, metadata }) {
    if (!req.user?.id) return null;
    return UserActivityModel.insert({
      userId: req.user.id,
      organizationId: req.user.organizationId ?? null,
      action,
      entityType,
      entityId,
      summary,
      metadata
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
