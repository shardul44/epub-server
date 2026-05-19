/**
 * Media Library routes
 * GET    /media          — list assets (member: own uploads; org_admin: org library)
 * POST   /media/upload   — upload a new asset
 * DELETE /media/:id      — delete an asset
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';
import { authenticate } from '../middlewares/auth.js';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
  forbiddenResponse,
} from '../utils/responseHandler.js';
import { canAccessMediaAsset, mediaAssetWhereClause } from '../utils/tenantScope.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MEDIA_DIR  = path.resolve(__dirname, '../../uploads/media');

const router = express.Router();
router.use(authenticate);

/* ── ensure upload dir exists ── */
async function ensureMediaDir() {
  try { await fs.mkdir(MEDIA_DIR, { recursive: true }); } catch (_) { /* already exists */ }
}
ensureMediaDir();

/* ── multer config (disk storage) ── */
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await ensureMediaDir();
    cb(null, MEDIA_DIR);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 52_428_800 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio)\//;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image, video, and audio files are allowed'));
  },
});

/* ── helpers ── */
function buildUrl(req, filename) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/uploads/media/${filename}`;
}

function toDto(row, req) {
  return {
    id:            row.id,
    filename:      row.filename,
    originalName:  row.original_name,
    mimeType:      row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes),
    url:           row.url || buildUrl(req, row.filename),
    thumbnailUrl:  row.thumbnail_url || (row.mime_type?.startsWith('image/') ? (row.url || buildUrl(req, row.filename)) : null),
    createdAt:     row.created_at,
    uploadedAt:    row.created_at,
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* GET /media                                                       */
/* ─────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const w = mediaAssetWhereClause(req.user);
    const [rows] = await pool.execute(
      `SELECT * FROM media_assets
       WHERE ${w.sql}
       ORDER BY created_at DESC
       LIMIT 500`,
      w.params
    );

    return successResponse(res, rows.map((r) => toDto(r, req)));
  } catch (err) {
    console.error('[media] GET /media error:', err);
    return errorResponse(res, err.message, 500);
  }
});

/* ─────────────────────────────────────────────────────────────── */
/* POST /media/upload                                               */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Wrap multer middleware so its errors are caught and returned as
 * proper JSON responses instead of falling through to the global
 * error handler as unhandled 500s.
 */
function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

router.post('/upload', async (req, res) => {
  // ── 1. Run multer and handle its errors explicitly ──────────────
  try {
    await runUpload(req, res);
  } catch (multerErr) {
    console.error('[media] POST /media/upload multer error:', multerErr.stack || multerErr);

    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      return badRequestResponse(res, 'File too large. Maximum allowed size is 50 MB.');
    }
    if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
      return badRequestResponse(res, 'Unexpected field name. Use "file" as the form field.');
    }
    // fileFilter rejection or any other multer error
    return badRequestResponse(res, multerErr.message || 'File upload rejected.');
  }

  // ── 2. Validate that a file was actually received ───────────────
  if (!req.file) {
    return badRequestResponse(res, 'No file provided. Include a "file" field in the multipart form.');
  }

  // ── 3. Validate req.user (should always be set by authenticate) ─
  if (!req.user || !req.user.id) {
    console.error('[media] POST /media/upload: req.user is missing or has no id', req.user);
    return errorResponse(res, 'Authentication context missing. Please log in again.', 401);
  }

  const { originalname, filename, mimetype, size } = req.file;

  // Guard against undefined file properties
  if (!filename || !originalname || !mimetype) {
    console.error('[media] POST /media/upload: incomplete file metadata', req.file);
    try { await fs.unlink(path.join(MEDIA_DIR, filename || '')); } catch (_) { /* ignore */ }
    return errorResponse(res, 'Incomplete file metadata received from upload.', 500);
  }

  const orgId  = req.user.organizationId ?? null;
  const userId = req.user.id;
  const url    = buildUrl(req, filename);

  // ── 4. Persist to database ──────────────────────────────────────
  try {
    const [result] = await pool.execute(
      `INSERT INTO media_assets
         (organization_id, user_id, filename, original_name, mime_type, file_size_bytes, storage_path, url, thumbnail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orgId,
        userId,
        filename,
        originalname,
        mimetype,
        size ?? 0,
        path.join(MEDIA_DIR, filename),
        url,
        mimetype.startsWith('image/') ? url : null,
      ]
    );

    if (!result || !result.insertId) {
      throw new Error('Database insert did not return an insertId.');
    }

    const [rows] = await pool.execute(
      'SELECT * FROM media_assets WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    if (!rows || rows.length === 0) {
      throw new Error(`Inserted asset (id=${result.insertId}) could not be retrieved.`);
    }

    return successResponse(res, toDto(rows[0], req), 201);
  } catch (err) {
    // Clean up the uploaded file so we don't leave orphaned files on disk
    try { await fs.unlink(path.join(MEDIA_DIR, filename)); } catch (_) { /* ignore */ }
    console.error('[media] POST /media/upload DB error:', err.stack || err);
    return errorResponse(res, `Upload failed: ${err.message}`, 500);
  }
});

/* ─────────────────────────────────────────────────────────────── */
/* DELETE /media/:id                                                */
/* ─────────────────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) return badRequestResponse(res, 'Invalid id');

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM media_assets WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) return notFoundResponse(res, 'Asset not found');

    const asset = rows[0];

    if (!canAccessMediaAsset(req.user, asset)) {
      return forbiddenResponse(res, 'You do not have permission to delete this asset');
    }

    // Delete file from disk
    try {
      await fs.unlink(asset.storage_path);
    } catch (_) { /* file may already be gone */ }

    await pool.execute('DELETE FROM media_assets WHERE id = ?', [id]);

    return res.status(204).send();
  } catch (err) {
    console.error('[media] DELETE /media/:id error:', err);
    return errorResponse(res, err.message, 500);
  }
});

export default router;
