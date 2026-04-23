import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { ActivityService } from '../services/activityService.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const raw = req.query.limit;
    const limit = raw != null ? parseInt(String(raw), 10) : 100;
    if (Number.isNaN(limit) || limit < 1) {
      return badRequestResponse(res, 'Invalid limit');
    }
    const rows = await ActivityService.listForRequest(req, limit);
    const data = rows.map((r) => {
      let meta = null;
      if (r.metadata != null) {
        if (typeof r.metadata === 'object' && !Buffer.isBuffer(r.metadata)) {
          meta = r.metadata;
        } else {
          try {
            meta = JSON.parse(String(r.metadata));
          } catch {
            meta = null;
          }
        }
      }
      return {
        id: r.id,
        userId: r.user_id,
        organizationId: r.organization_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: r.summary,
        metadata: meta,
        createdAt: r.created_at,
        actorName: r.actor_name ?? null,
        actorEmail: r.actor_email ?? null,
        organizationName: r.organization_name ?? null
      };
    });
    return successResponse(res, data);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

export default router;
