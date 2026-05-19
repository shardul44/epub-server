/**
 * bootstrapRoutes.js
 *
 * GET /app-bootstrap  — single bundled endpoint that returns all data
 *                       needed to hydrate the frontend on first load.
 *                       Uses Promise.all + in-memory cache (TTL 8 s).
 *
 * GET /conversion-status/:id — safe polling endpoint.
 *                       Always returns JSON (never 404).
 *                       { exists: false } when the job has been deleted.
 */

import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { ActivityService } from '../services/activityService.js';
import { LicenseService } from '../services/licenseService.js';
import { cacheWrap, cacheGet, cacheSet, TTL } from '../services/cacheService.js';
import pool from '../config/database.js';
import {
  successResponse,
  errorResponse,
} from '../utils/responseHandler.js';
import { mediaAssetWhereClause } from '../utils/tenantScope.js';

const router = express.Router();
router.use(authenticate);

/* ─── helpers ─────────────────────────────────────────────────── */

async function fetchMedia(req) {
  const w = mediaAssetWhereClause(req.user);
  const [rows] = await pool.execute(
    `SELECT * FROM media_assets WHERE ${w.sql} ORDER BY created_at DESC LIMIT 500`,
    w.params
  );
  return rows.map((row) => ({
    id:            row.id,
    filename:      row.filename,
    originalName:  row.original_name,
    mimeType:      row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes),
    url:           row.url || `${req.protocol}://${req.get('host')}/uploads/media/${row.filename}`,
    thumbnailUrl:  row.thumbnail_url || (row.mime_type?.startsWith('image/') ? (row.url || `${req.protocol}://${req.get('host')}/uploads/media/${row.filename}`) : null),
    createdAt:     row.created_at,
    uploadedAt:    row.created_at,
  }));
}

async function fetchLicense(req) {
  if (!req.user.organizationId) return null;
  return LicenseService.getOrgLicenseStatus(req.user.organizationId);
}

async function fetchActivities(req) {
  const rows = await ActivityService.listForRequest(req, 100);
  return rows.map((r) => {
    let meta = null;
    if (r.metadata != null) {
      if (typeof r.metadata === 'object' && !Buffer.isBuffer(r.metadata)) {
        meta = r.metadata;
      } else {
        try { meta = JSON.parse(String(r.metadata)); } catch { meta = null; }
      }
    }
    return {
      id:               r.id,
      userId:           r.user_id,
      organizationId:   r.organization_id,
      action:           r.action,
      entityType:       r.entity_type,
      entityId:         r.entity_id,
      summary:          r.summary,
      metadata:         meta,
      createdAt:        r.created_at,
      actorName:        r.actor_name ?? null,
      actorEmail:       r.actor_email ?? null,
      organizationName: r.organization_name ?? null,
    };
  });
}

async function fetchUsers(req) {
  const orgId = req.user.organizationId ?? null;
  if (!orgId) return [];
  const [rows] = await pool.execute(
    `SELECT id, name, email, role, status, phone_number AS phoneNumber,
            last_active AS lastActive, created_at AS createdAt
     FROM users WHERE organization_id = ? ORDER BY created_at DESC`,
    [orgId]
  );
  return rows;
}

async function fetchHealth() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { status: 'OK', database: 'connected', uptime: process.uptime() };
  } catch {
    return { status: 'SERVICE_UNAVAILABLE', database: 'disconnected', uptime: process.uptime() };
  }
}

/* ─── GET /app-bootstrap ──────────────────────────────────────── */
router.get('/app-bootstrap', async (req, res) => {
  // Cache key is scoped to the user so different users get their own data.
  const cacheKey = `bootstrap:${req.user.id}`;
  const TTL_BOOTSTRAP = 8; // seconds — short enough to feel fresh, long enough to deduplicate bursts

  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return successResponse(res, cached);
  }

  try {
    const [media, license, activities, users, health] = await Promise.allSettled([
      fetchMedia(req),
      fetchLicense(req),
      fetchActivities(req),
      fetchUsers(req),
      fetchHealth(),
    ]);

    const payload = {
      media:      media.status      === 'fulfilled' ? media.value      : [],
      license:    license.status    === 'fulfilled' ? license.value    : null,
      activities: activities.status === 'fulfilled' ? activities.value : [],
      users:      users.status      === 'fulfilled' ? users.value      : [],
      health:     health.status     === 'fulfilled' ? health.value     : { status: 'UNKNOWN' },
    };

    cacheSet(cacheKey, payload, TTL_BOOTSTRAP);
    res.setHeader('X-Cache', 'MISS');
    return successResponse(res, payload);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

/* ─── GET /conversion-status/:id ─────────────────────────────── */
router.get('/conversion-status/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  if (Number.isNaN(jobId)) {
    return res.json({ exists: false });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, status, created_at AS createdAt, updated_at AS updatedAt,
              completed_at AS completedAt, error_message AS errorMessage,
              pdf_document_id AS pdfDocumentId
       FROM conversion_jobs WHERE id = ? LIMIT 1`,
      [jobId]
    );

    if (!rows.length) {
      return res.json({ exists: false });
    }

    const job = rows[0];
    return res.json({
      exists: true,
      status: job.status,
      data:   job,
    });
  } catch (e) {
    // Never return 404 — always return JSON
    return res.json({ exists: false, error: e.message });
  }
});

export default router;
