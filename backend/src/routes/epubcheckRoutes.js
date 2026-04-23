import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import { runEpubcheck, isJavaAvailable } from '../services/epubcheckService.js';
import { renderEpubcheckReportPdf } from '../services/epubcheckPdfService.js';
import {
  runAiRepairPipeline,
  runAiRepairSuggestionsOnly,
  applyApprovedEpubRepairs
} from '../services/epubAiRepairService.js';
import { runEpubAutoFixOnBuffer } from '../services/epubAutoFixEngine.js';
import { authenticate, requireFeature } from '../middlewares/auth.js';

const router = express.Router();
router.use(authenticate, requireFeature('epub_tools'));
const jsonBody = express.json({ limit: '20mb' });
const repairJsonBody = express.json({ limit: '100mb' });

/** Persisted EPUB buffer for human-in-the-loop repair (same idea as accessibility job). */
const repairSessions = new Map();
const REPAIR_SESSION_TTL_MS = 60 * 60 * 1000;

function pruneRepairSessions() {
  const now = Date.now();
  for (const [id, entry] of repairSessions.entries()) {
    if (now - entry.created > REPAIR_SESSION_TTL_MS) repairSessions.delete(id);
  }
  if (repairSessions.size > 200) {
    const keys = [...repairSessions.keys()].slice(0, repairSessions.size - 100);
    keys.forEach((k) => repairSessions.delete(k));
  }
}

/** One-time download tokens for repaired EPUB buffers (in-memory). */
const aiRepairDownloads = new Map();
const AI_REPAIR_TTL_MS = 60 * 60 * 1000;

function pruneAiRepairDownloads() {
  const now = Date.now();
  for (const [id, entry] of aiRepairDownloads.entries()) {
    if (now - entry.created > AI_REPAIR_TTL_MS) aiRepairDownloads.delete(id);
  }
  if (aiRepairDownloads.size > 200) {
    const ids = [...aiRepairDownloads.keys()].slice(0, aiRepairDownloads.size - 100);
    ids.forEach((id) => aiRepairDownloads.delete(id));
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');
const uploadsRoot = path.resolve(backendRoot, 'uploads', 'epub_epubcheck');

fs.ensureDirSync(uploadsRoot);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.epub';
    const id = uuidv4();
    cb(null, `${id}${ext.toLowerCase()}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_EPUB_SIZE || '52428800', 10)
  },
  fileFilter: (_req, file, cb) => {
    const isEpub =
      file.mimetype === 'application/epub+zip' ||
      file.originalname.toLowerCase().endsWith('.epub');
    if (!isEpub) {
      return cb(new Error('Only .epub files are allowed'));
    }
    cb(null, true);
  }
});

// GET /epubcheck/status — Java available for EPUBCheck
router.get('/status', (_req, res) => {
  return successResponse(res, {
    javaAvailable: isJavaAvailable(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    checker: 'epubchecker (W3C EPUBCheck)',
    note: 'This API runs W3C EPUBCheck programmatically.'
  });
});

// POST /epubcheck/check — multipart field "file"
router.post('/check', upload.single('file'), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) {
      return badRequestResponse(res, 'EPUB file is required (field name: file)');
    }
    uploadedPath = req.file.path;

    const includeWarnings = String(req.query.includeWarnings ?? 'true').toLowerCase() !== 'false';
    const includeNotices = String(req.query.includeNotices ?? 'false').toLowerCase() === 'true';

    const result = await runEpubcheck(uploadedPath, {
      includeWarnings,
      includeNotices
    });

    return successResponse(res, {
      valid: result.valid,
      summary: result.summary,
      engine: result.engine,
      note: result.note,
      messages: result.report?.messages ?? [],
      publicationTitle: result.report?.publicationTitle ?? null,
      checkerVersion: result.report?.checker?.version ?? result.report?.epubcheckVersion ?? null
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes('Java') || message.includes('java')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  } finally {
    if (uploadedPath) {
      await fs.remove(uploadedPath).catch(() => {});
    }
  }
});

// POST /epubcheck/repair-session — store EPUB for AI suggest / apply (accessibility-style job)
router.post('/repair-session', upload.single('file'), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) {
      return badRequestResponse(res, 'EPUB file is required (field name: file)');
    }
    uploadedPath = req.file.path;
    const buf = await fs.readFile(uploadedPath);
    pruneRepairSessions();
    const sessionId = uuidv4();
    repairSessions.set(sessionId, { buffer: buf, created: Date.now() });
    return successResponse(res, { sessionId });
  } catch (error) {
    console.error('[epubcheck/repair-session]', error);
    return errorResponse(res, error?.message || 'Failed to create repair session.', 500);
  } finally {
    if (uploadedPath) {
      await fs.remove(uploadedPath).catch(() => {});
    }
  }
});

// POST /epubcheck/repair-session/:sessionId/epubcheck — run EPUBCheck on session EPUB (after apply, without re-upload)
router.post('/repair-session/:sessionId/epubcheck', async (req, res) => {
  let tmpPath = null;
  try {
    pruneRepairSessions();
    const entry = repairSessions.get(req.params.sessionId);
    if (!entry?.buffer) {
      return errorResponse(res, 'Repair session not found or expired.', 404);
    }
    const includeWarnings = String(req.query.includeWarnings ?? 'true').toLowerCase() !== 'false';
    const includeNotices = String(req.query.includeNotices ?? 'false').toLowerCase() === 'true';
    tmpPath = path.join(tmpdir(), `epubcheck-sess-${uuidv4()}.epub`);
    await fs.writeFile(tmpPath, entry.buffer);
    const result = await runEpubcheck(tmpPath, {
      includeWarnings,
      includeNotices
    });
    return successResponse(res, {
      valid: result.valid,
      summary: result.summary,
      engine: result.engine,
      note: result.note,
      messages: result.report?.messages ?? [],
      publicationTitle: result.report?.publicationTitle ?? null,
      checkerVersion: result.report?.checker?.version ?? result.report?.epubcheckVersion ?? null
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes('Java') || message.includes('java')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  } finally {
    if (tmpPath) {
      await fs.remove(tmpPath).catch(() => {});
    }
  }
});

// POST /epubcheck/repair-session/:sessionId/auto-fix — deterministic parse→fix→serialize (no AI), updates session EPUB
// Body (optional JSON): { messages?: EPUBCheck[] } — if present, only handlers mapped to those codes run; [] = no changes. Omit = full safe run.
router.post('/repair-session/:sessionId/auto-fix', repairJsonBody, async (req, res) => {
  try {
    pruneRepairSessions();
    const entry = repairSessions.get(req.params.sessionId);
    if (!entry?.buffer) {
      return errorResponse(res, 'Repair session not found or expired.', 404);
    }
    const includeWarnings = String(req.query.includeWarnings ?? 'true').toLowerCase() !== 'false';
    const includeNotices = String(req.query.includeNotices ?? 'false').toLowerCase() === 'true';
    const messages = req.body?.messages;
    const out = await runEpubAutoFixOnBuffer(entry.buffer, {
      messages,
      includeWarnings,
      includeNotices
    });
    repairSessions.set(req.params.sessionId, { buffer: out.epubBuffer, created: Date.now() });

    pruneAiRepairDownloads();
    const downloadId = uuidv4();
    aiRepairDownloads.set(downloadId, {
      buffer: out.epubBuffer,
      created: Date.now()
    });

    return successResponse(res, {
      engine: 'deterministic',
      mode: out.mode,
      appliedHandlers: out.appliedHandlers,
      stats: out.stats,
      classification: out.classification,
      fallbackFromEmptyTarget: out.fallbackFromEmptyTarget === true,
      written: out.written,
      changes: out.changes,
      opfPath: out.opfPath,
      after: out.after,
      downloadId,
      downloadPath: `/epubcheck/ai-repair-download/${downloadId}`
    });
  } catch (error) {
    console.error('[epubcheck/auto-fix]', error);
    const message = error?.message || String(error);
    if (message.includes('Java') || message.includes('java')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  }
});

// POST /epubcheck/repair-session/:sessionId/ai-suggest — parallel Gemini, returns drafts only (no write)
router.post('/repair-session/:sessionId/ai-suggest', repairJsonBody, async (req, res) => {
  try {
    pruneRepairSessions();
    const entry = repairSessions.get(req.params.sessionId);
    if (!entry?.buffer) {
      return errorResponse(res, 'Repair session not found or expired.', 404);
    }
    const { messages, includeWarnings, includeNotices } = req.body || {};
    if (!Array.isArray(messages)) {
      return badRequestResponse(res, 'JSON body must include messages (array).');
    }
    const result = await runAiRepairSuggestionsOnly(entry.buffer, messages, {
      includeWarnings: includeWarnings !== false,
      includeNotices: includeNotices === true
    });
    return successResponse(res, result);
  } catch (error) {
    console.error('[epubcheck/ai-suggest]', error);
    const message = error?.message || String(error);
    if (message.includes('GEMINI_API_KEY')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  }
});

// POST /epubcheck/repair-session/:sessionId/apply — apply approved full files, re-package, EPUBCheck
router.post('/repair-session/:sessionId/apply', repairJsonBody, async (req, res) => {
  try {
    pruneRepairSessions();
    const entry = repairSessions.get(req.params.sessionId);
    if (!entry?.buffer) {
      return errorResponse(res, 'Repair session not found or expired.', 404);
    }
    const { approvedFiles, includeWarnings, includeNotices } = req.body || {};
    if (!Array.isArray(approvedFiles) || approvedFiles.length === 0) {
      return badRequestResponse(res, 'approvedFiles must be a non-empty array of { path, content }.');
    }
    const out = await applyApprovedEpubRepairs(entry.buffer, approvedFiles, {
      includeWarnings: includeWarnings !== false,
      includeNotices: includeNotices === true
    });
    repairSessions.set(req.params.sessionId, { buffer: out.epubBuffer, created: Date.now() });

    pruneAiRepairDownloads();
    const downloadId = uuidv4();
    aiRepairDownloads.set(downloadId, {
      buffer: out.epubBuffer,
      created: Date.now()
    });

    return successResponse(res, {
      after: out.after,
      written: out.written,
      downloadId,
      downloadPath: `/epubcheck/ai-repair-download/${downloadId}`
    });
  } catch (error) {
    console.error('[epubcheck/apply]', error);
    const message = error?.message || String(error);
    if (message.includes('Java') || message.includes('java')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  }
});

// POST /epubcheck/pdf — JSON body (same fields as check response + optional sourceFileName)
router.post('/pdf', jsonBody, async (req, res) => {
  try {
    const body = req.body;
    if (body == null || typeof body.valid !== 'boolean' || !Array.isArray(body.messages)) {
      return badRequestResponse(res, 'Invalid body: expected valid (boolean) and messages (array).');
    }
    const pdfBuffer = await renderEpubcheckReportPdf(body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="epubcheck-report.pdf"');
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('[epubcheck/pdf]', error);
    return errorResponse(res, error?.message || 'PDF generation failed', 500);
  }
});

// POST /epubcheck/ai-repair — multipart: file (epub), repair (JSON string: { messages, includeWarnings?, includeNotices? })
router.post('/ai-repair', upload.single('file'), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) {
      return badRequestResponse(res, 'EPUB file is required (field name: file)');
    }
    uploadedPath = req.file.path;

    let repair;
    try {
      const raw = req.body?.repair ?? req.body?.repairJson;
      repair = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return badRequestResponse(res, 'Field "repair" must be JSON: { messages: [...], includeWarnings?, includeNotices? }');
    }
    if (!repair || !Array.isArray(repair.messages)) {
      return badRequestResponse(res, 'repair.messages (array) is required');
    }

    const buf = await fs.readFile(uploadedPath);
    const result = await runAiRepairPipeline(buf, repair.messages, {
      includeWarnings: repair.includeWarnings !== false,
      includeNotices: repair.includeNotices === true
    });

    pruneAiRepairDownloads();
    const downloadId = uuidv4();
    aiRepairDownloads.set(downloadId, {
      buffer: result.epubBuffer,
      created: Date.now()
    });

    return successResponse(res, {
      before: result.before,
      after: result.after,
      notes: result.notes,
      written: result.written,
      downloadId,
      downloadPath: `/epubcheck/ai-repair-download/${downloadId}`,
      fileResults: result.fileResults ?? [],
      capped: Boolean(result.capped),
      skippedPaths: result.skippedPaths ?? []
    });
  } catch (error) {
    console.error('[epubcheck/ai-repair]', error);
    const message = error?.message || String(error);
    if (message.includes('GEMINI_API_KEY')) {
      return errorResponse(res, message, 503);
    }
    if (message.includes('Java') || message.includes('java')) {
      return errorResponse(res, message, 503);
    }
    return errorResponse(res, message, 500);
  } finally {
    if (uploadedPath) {
      await fs.remove(uploadedPath).catch(() => {});
    }
  }
});

// GET /epubcheck/ai-repair-download/:id — one-time EPUB download
router.get('/ai-repair-download/:id', (req, res) => {
  const entry = aiRepairDownloads.get(req.params.id);
  if (!entry?.buffer) {
    return res.status(404).json({
      success: false,
      error: 'Download not found or already used.',
      timestamp: new Date().toISOString()
    });
  }
  aiRepairDownloads.delete(req.params.id);
  res.setHeader('Content-Type', 'application/epub+zip');
  res.setHeader('Content-Disposition', 'attachment; filename="epub-repaired.epub"');
  return res.send(entry.buffer);
});

export default router;
