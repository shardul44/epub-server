import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { noCache } from '../middlewares/httpCache.js';
import {
  handleGetJob,
  handleGetCoords,
  handleGetEpub,
} from './pdfPipelineRoutes.js';

/**
 * PDF Pipeline job status routes mounted at /jobs/:id
 * Only handles UUID-based pipeline job IDs to avoid conflicting with integer conversion job IDs.
 */
const router = express.Router();

router.get('/:id', authenticate, noCache, async (req, res, next) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return next('route');
  }
  return handleGetJob(req, res);
});

router.get('/:id/coords', authenticate, noCache, async (req, res, next) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return next('route');
  }
  return handleGetCoords(req, res);
});

router.get('/:id/epub', authenticate, async (req, res, next) => {
  const { id } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return next('route');
  }
  return handleGetEpub(req, res);
});

export default router;
