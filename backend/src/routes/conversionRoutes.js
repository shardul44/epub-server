import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import multer from 'multer';
import { ConversionService } from '../services/conversionService.js';
import { ActivityService } from '../services/activityService.js';
import { EpubService } from '../services/epubService.js';
import { EpubDirectImportService } from '../services/epubDirectImportService.js';
import { PdfService } from '../services/pdfService.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { isEpubImportStubDocument } from '../utils/pdfDocumentSource.js';
import { successResponse, errorResponse, notFoundResponse, badRequestResponse, forbiddenResponse } from '../utils/responseHandler.js';
import { getHtmlIntermediateDir } from '../config/fileStorage.js';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import { paramJobTenantAccess, paramPdfTenantAccess } from '../middlewares/tenantAccess.js';
import { cacheWrap, cacheDel, cacheDelByPrefix, TTL } from '../services/cacheService.js';
import { httpCache, noCache } from '../middlewares/httpCache.js';
import { validateXhtmlStrict, extractCanonicalFromXhtml } from '../utils/sanitizeXhtml.js';
import { resolveListScope, listScopeKey } from '../utils/tenantScope.js';

async function resolveDocumentPageCount(jobId) {
  const htmlIntermediateDir = getHtmlIntermediateDir();
  const pngDir = path.join(htmlIntermediateDir, `job_${jobId}_png`);
  const jobDir = path.join(htmlIntermediateDir, `job_${jobId}`);
  const htmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
  let maxPage = 0;
  const bump = async (dir, re) => {
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        const m = f.match(re);
        if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
      }
    } catch (_) { /* missing dir */ }
  };
  await bump(pngDir, /^page_(\d+)\.png$/i);
  await bump(path.join(htmlIntermediateDir, `job_${jobId}_images`), /^page_(\d+)_/i);
  await bump(htmlDir, /^page_(\d+)\.xhtml$/i);
  try {
    const raw = await fs.readFile(path.join(jobDir, `text_data_${jobId}.json`), 'utf8');
    const td = JSON.parse(raw);
    const tp = Number(td.totalPages) || (Array.isArray(td.pages) ? td.pages.length : 0);
    if (tp > 0) maxPage = Math.max(maxPage, tp);
  } catch (_) { /* optional */ }
  return maxPage;
}

const router = express.Router();

function userHasAnyFeature(user, keys = []) {
  const f = user?.features || [];
  return f.includes('*') || keys.some((k) => f.includes(k));
}

function canAccessLayoutForCurrentPlan(user, layoutOrJobType) {
  const value = String(layoutOrJobType || '').toUpperCase();
  const isFixed = value === 'FIXED_LAYOUT' || value === 'FXL';
  if (isFixed) {
    return userHasAnyFeature(user, ['kitaboo.import', 'hifi_fxl.pdf_to_epub', 'hifi_fxl.audio_sync']);
  }
  return userHasAnyFeature(user, ['conversion.basic', 'reflowable.pdf_to_epub', 'reflowable.audio_sync']);
}

router.use(authenticate);
router.use((req, res, next) => {
  const isEpubSyncPath =
    req.path === '/import-epub-for-sync' ||
    req.path === '/epub-sync-sessions' ||
    req.path.startsWith('/epub-import-meta/') ||
    /^\/\d+\/epub-(sections|text|section\/[^/]+\/xhtml|css|image\/[^/]+)$/i.test(req.path);
  if (isEpubSyncPath) return requireFeature('sync_studio')(req, res, next);
  const isReadOnlyListPath = req.method === 'GET' && req.path === '/';
  if (isReadOnlyListPath) {
    const features = req.user?.features || [];
    const canReadForFxlPlan =
      features.includes('*') ||
      features.includes('kitaboo.import') ||
      features.includes('hifi_fxl.pdf_to_epub');
    if (canReadForFxlPlan) return next();
  }
  return requireFeature('conversion.basic')(req, res, next);
});

router.param('jobId', paramJobTenantAccess);
router.param('pdfDocumentId', paramPdfTenantAccess);

const epubImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const base = path.basename(file.originalname || 'book.epub').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `epub_import_${Date.now()}_${base}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.epub')) return cb(null, true);
    cb(new Error('Only .epub files are allowed'));
  }
});

// GET /api/conversions - Get all conversions (?scope=own = only jobs for PDFs this user created)
// IMPORTANT: this endpoint powers the UI polling that shows IN_PROGRESS jobs.
// Do NOT cache it aggressively (server-side or via HTTP headers), otherwise the
// frontend keeps seeing stale job states until the cache TTL expires.
router.get('/', noCache, async (req, res) => {
  try {
    const scope = resolveListScope(req.user, req.query.scope);
    const jobs = await ConversionService.getAllConversions(req.user, scope);
    const filtered = jobs.filter((job) =>
      canAccessLayoutForCurrentPlan(req.user, job.layoutType || job.jobType)
    );
    return successResponse(res, filtered);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/start/:pdfDocumentId - Start conversion
router.post('/start/:pdfDocumentId', async (req, res) => {
  try {
    const chapterPlan = Array.isArray(req.body.chapterPlan) ? req.body.chapterPlan : null;
    const job = await ConversionService.startConversion(parseInt(req.params.pdfDocumentId), {
      chapterPlan,
      user: req.user
    });
    // Invalidate conversion caches so next poll sees the new job
    cacheDelByPrefix('conversions:');
    return successResponse(res, job, 201);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    if (error.code === 'PLAN_FEATURE_REQUIRED') {
      return forbiddenResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

router.get('/check', async (req, res) =>
{
  try{
    const a = 1;
    const b = 2;
    const c = 3;
    const z = a * b + c;
    return successResponse(res, z);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
})

// POST /api/conversions/start/bulk - Start bulk conversion
router.post('/start/bulk', async (req, res) => {
  try {
    const { pdfIds } = req.body;
    if (!pdfIds || !Array.isArray(pdfIds)) {
      return badRequestResponse(res, 'pdfIds array is required');
    }

    const jobs = [];
    const errors = [];

    for (const pdfId of pdfIds) {
      try {
        const job = await ConversionService.startConversion(pdfId, { user: req.user });
        jobs.push(job);
      } catch (error) {
        errors.push({
          pdfId,
          error: error.message
        });
      }
    }

    return successResponse(res, {
      totalStarted: jobs.length,
      totalFailed: errors.length,
      jobs,
      errors
    }, 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/pdf/:pdfDocumentId - Get conversions by PDF
router.get('/pdf/:pdfDocumentId', async (req, res) => {
  try {
    const jobs = await ConversionService.getConversionsByPdf(parseInt(req.params.pdfDocumentId), req.user);
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/status/:status - Get conversions by status
router.get('/status/:status', httpCache(TTL.SHORT), async (req, res) => {
  try {
    const status = req.params.status.toUpperCase();
    const validStatuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REVIEW_REQUIRED', 'CANCELLED'];

    if (!validStatuses.includes(status)) {
      return badRequestResponse(res, 'Invalid status');
    }

    const scope = resolveListScope(req.user, req.query.scope);
    const userId  = req.user?.id ?? 'anon';
    const orgId   = req.user?.organizationId ?? 'none';
    const scopeKey = listScopeKey(req.user, req.query.scope);
    const cacheKey = `conversions:status:${status}:${orgId}:${userId}:${scopeKey}`;

    // Active jobs change frequently — use SHORT TTL; terminal jobs can use MEDIUM
    const ttl = ['IN_PROGRESS', 'PENDING'].includes(status) ? TTL.SHORT : TTL.MEDIUM;
    const jobs = await cacheWrap(cacheKey, () => ConversionService.getConversionsByStatus(status, req.user, scope), ttl);

    return successResponse(res, jobs);
  } catch (error) {
    // Return empty array instead of 500 for non-critical status queries
    console.warn(`[ConversionRoute] GET /status/${req.params.status} failed:`, error.message);
    return successResponse(res, []);
  }
});

// GET /api/conversions/review-required - Get jobs requiring review
router.get('/review-required', async (req, res) => {
  try {
    const scope = resolveListScope(req.user, req.query.scope);
    const jobs = await ConversionService.getReviewRequired(req.user, scope);
    return successResponse(res, jobs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /conversions/epub-sync-sessions
 * List direct EPUB → Audio Sync imports (pdf_documents stubs, no conversion_jobs row).
 */
router.get('/epub-sync-sessions', noCache, async (req, res) => {
  try {
    const scope = resolveListScope(req.user, req.query.scope);
    const scopeOpts = scope.onlyOwn ? { onlyOwn: true } : {};
    const pdfs = await PdfService.getAllPdfs(req.user, scopeOpts);
    const sessions = pdfs
      .filter((p) =>
        isEpubImportStubDocument({
          file_path: p.filePath,
          filePath: p.filePath,
          file_name: p.fileName,
          fileName: p.fileName,
          original_file_name: p.originalFileName,
          originalFileName: p.originalFileName,
        }) ||
        String(p.fileName || p.originalFileName || '')
          .toLowerCase()
          .endsWith('.epub')
      )
      .filter((p) => canAccessLayoutForCurrentPlan(req.user, p.layoutType))
      .map((p) => {
        const isFxl = String(p.layoutType || '').toUpperCase() === 'FIXED_LAYOUT';
        const createdAt = p.createdAt || null;
        return {
          id: p.id,
          jobId: p.id,
          pdfDocumentId: p.id,
          pdfId: p.id,
          jobType: isFxl ? 'FXL' : 'REFLOW',
          status: 'COMPLETED',
          progressPercentage: 100,
          currentStep: 'COMPLETE',
          pdfFilename: p.originalFileName || p.fileName,
          originalFileName: p.originalFileName,
          fileName: p.fileName,
          totalPages: p.totalPages ?? null,
          fileSizeBytes: p.fileSize ?? null,
          fileSize: p.fileSize ?? null,
          layoutType: p.layoutType,
          source: 'epub_direct_import',
          sourceType: 'epub',
          createdAt,
          updatedAt: createdAt,
          completedAt: createdAt,
        };
      });
    return successResponse(res, sessions);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /conversions/epub-import-meta/:pdfDocumentId
 * Metadata for a direct EPUB import (no conversion_jobs row).
 */
router.get('/epub-import-meta/:pdfDocumentId', async (req, res) => {
  try {
    const pdfId = parseInt(req.params.pdfDocumentId, 10);
    if (Number.isNaN(pdfId)) return badRequestResponse(res, 'Invalid EPUB import id');

    const pdf = await PdfDocumentModel.findById(pdfId);
    if (!pdf) return notFoundResponse(res, 'EPUB import not found');

    return successResponse(res, {
      epubImportId: pdf.id,
      pdfDocumentId: pdf.id,
      pdfFilename: pdf.original_file_name || pdf.originalFileName || pdf.file_name || pdf.fileName,
      fileSizeBytes: pdf.file_size ?? pdf.fileSize ?? null,
      pages: pdf.total_pages ?? pdf.totalPages ?? null,
      layoutType: pdf.layout_type ?? pdf.layoutType ?? null,
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/conversions/:jobId/review - Mark as reviewed
router.put('/:jobId/review', async (req, res) => {
  try {
    const { reviewedBy } = req.query;
    const job = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      requiresReview: false,
      reviewedBy: reviewedBy || 'System',
      reviewedAt: new Date()
    });
    return successResponse(res, job);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/stop - Stop conversion
router.post('/:jobId/stop', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    if (job.status !== 'IN_PROGRESS' && job.status !== 'PENDING') {
      return badRequestResponse(res, 'Can only stop IN_PROGRESS or PENDING jobs');
    }

    const updatedJob = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      status: 'CANCELLED'
    });
    cacheDelByPrefix('conversions:');
    return successResponse(res, updatedJob);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/retry - Retry conversion
router.post('/:jobId/retry', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    // Allow retrying FAILED, CANCELLED, or stuck IN_PROGRESS jobs
    // IN_PROGRESS jobs might be stuck if server restarted during conversion
    if (job.status !== 'FAILED' && job.status !== 'CANCELLED' && job.status !== 'IN_PROGRESS') {
      return badRequestResponse(res, 'Can only retry FAILED, CANCELLED, or IN_PROGRESS jobs');
    }

    // If job is IN_PROGRESS, check if it's been stuck for more than 5 minutes
    if (job.status === 'IN_PROGRESS') {
      const updatedAt = new Date(job.updatedAt || job.updated_at);
      const now = new Date();
      const minutesSinceUpdate = (now - updatedAt) / (1000 * 60);
      
      if (minutesSinceUpdate < 5) {
        return badRequestResponse(res, `Job is still in progress (updated ${Math.round(minutesSinceUpdate)} minutes ago). Wait a bit longer or check if conversion is still running.`);
      }
      
      console.log(`[Job ${req.params.jobId}] Retrying stuck IN_PROGRESS job (stuck for ${Math.round(minutesSinceUpdate)} minutes)`);
    }

    // Increment retry counter and reset job state from scratch
    const newRetryCount = (job.retryCount ?? 0) + 1;

    const updatedJob = await ConversionService.updateJobStatus(parseInt(req.params.jobId), {
      status: 'PENDING',
      currentStep: 'STEP_0_CLASSIFICATION',
      progressPercentage: 0,
      // Clear previous error so the UI shows a clean slate
      errorMessage: null,
      retryCount: newRetryCount
    });

    console.log(`[Job ${req.params.jobId}] Retry #${newRetryCount} — restarting full conversion pipeline`);

    // Restart conversion from the beginning
    ConversionService.processConversion(parseInt(req.params.jobId)).catch(error => {
      console.error('Retry conversion error:', error);
    });

    cacheDelByPrefix('conversions:');
    return successResponse(res, updatedJob);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/download - Download EPUB (must come before /:jobId route)
router.get('/:jobId/download', async (req, res) => {
  try {
    console.log('Download request for jobId:', req.params.jobId);
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) return badRequestResponse(res, 'Invalid job ID');

    // 1) Normal conversion jobs (conversion_jobs table)
    try {
      const job = await ConversionService.getConversionJob(jobId);
      if (!canAccessLayoutForCurrentPlan(req.user, job.layoutType || job.jobType)) {
        return forbiddenResponse(res, 'This job layout is not enabled in your current plan');
      }
      if (!job?.epubFilePath) {
        console.warn('EPUB file path not available for conversion job:', jobId);
        return notFoundResponse(res, 'EPUB file not available. Conversion may not be completed yet.');
      }

      const exists = await fs.access(job.epubFilePath).then(() => true).catch(() => false);
      if (!exists) {
        console.error('EPUB file does not exist on server:', job.epubFilePath);
        return notFoundResponse(res, 'EPUB file not found on server.');
      }

      const fileName = path.basename(job.epubFilePath);
      const fileBuffer = await fs.readFile(job.epubFilePath);

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Length', fileBuffer.length.toString());
      res.setHeader('Cache-Control', 'no-cache');

      return res.end(fileBuffer, 'binary');
    } catch (_) {
      // 2) EPUB direct-import stubs (no conversion_job row)
      const pdf = await PdfDocumentModel.findById(jobId);
      if (!pdf) return notFoundResponse(res, 'EPUB import not found');
      if (!canAccessLayoutForCurrentPlan(req.user, pdf.layout_type || pdf.layoutType)) {
        return forbiddenResponse(res, 'This EPUB layout is not enabled in your current plan');
      }

      const filePath = pdf.file_path || pdf.filePath;
      if (!filePath) return notFoundResponse(res, 'EPUB file path not available');

      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) return notFoundResponse(res, 'EPUB file not found on server');

      const fileName = path.basename(filePath);
      const fileBuffer = await fs.readFile(filePath);

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Length', fileBuffer.length.toString());
      res.setHeader('Cache-Control', 'no-cache');

      return res.end(fileBuffer, 'binary');
    }
  } catch (error) {
    console.error('Error in download route:', error);
    if (error.message && error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message || 'Failed to download EPUB', 500);
  }
});

// POST /api/conversions/:jobId/regenerate - Regenerate EPUB with updated syncs
router.post('/:jobId/regenerate', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { granularity } = req.body || {}; // Optional: 'word', 'sentence', 'paragraph'
    
    const job = await ConversionService.getConversionJob(jobId);
    
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }
    
    // Allow regeneration for both COMPLETED and IN_PROGRESS jobs
    // IN_PROGRESS allows users to regenerate EPUB while working in Sync Studio
    if (job.status !== 'COMPLETED' && job.status !== 'IN_PROGRESS') {
      console.log(`[Regenerate] Job ${jobId} status is '${job.status}', must be 'COMPLETED' or 'IN_PROGRESS'`);
      return badRequestResponse(res, `Can only regenerate EPUB for completed or in-progress conversions. Current status: ${job.status}`);
    }
    
    const { playbackSpeed } = req.body || {};
    
    console.log(`[API] Regenerating EPUB for job ${jobId}${granularity ? ` with ${granularity}-level audio` : ''}${playbackSpeed ? ` at ${playbackSpeed}x speed` : ''}`);
    
    // Regenerate EPUB with updated sync files and granularity option
    const result = await ConversionService.regenerateEpub(jobId, { granularity, playbackSpeed });
    return successResponse(res, result);
  } catch (error) {
    console.error('Error regenerating EPUB:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId - Get conversion job (must come after more specific routes)
router.get('/:jobId', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    // Set cache-control headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    return successResponse(res, job);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-sections - Get EPUB sections
router.get('/:jobId/epub-sections', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const job = await ConversionService.getConversionJob(jobId);
    
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    // Check job status first - provide appropriate error messages
    if (job.status === 'IN_PROGRESS' || job.status === 'PENDING') {
      return badRequestResponse(res, `Conversion is still in progress (Status: ${job.status}, Step: ${job.currentStep || 'N/A'}, Progress: ${job.progressPercentage || 0}%). Please wait for the conversion to complete before accessing EPUB sections.`);
    }
    
    if (job.status === 'FAILED' || job.status === 'CANCELLED') {
      const errorMsg = job.errorMessage ? ` Error: ${job.errorMessage}` : '';
      return badRequestResponse(res, `Conversion ${job.status.toLowerCase()}.${errorMsg} Please check the conversion status or start a new conversion.`);
    }

    // Let EpubService handle file finding logic (it checks multiple possible locations)
    // This is more robust than checking a single path
    const { EpubService } = await import('../services/epubService.js');
    const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
    
    try {
      const sections = await EpubService.getEpubSections(jobId);
      return successResponse(res, sections);
    } catch (epubError) {
      // If EPUB file not found, check if we can regenerate it
      console.error(`[EPUB Sections] Error for job ${jobId}:`, epubError.message);
      
      // Check if intermediate HTML files exist (for regeneration suggestion)
      let canRegenerate = false;
      try {
        const htmlIntermediateDir = getHtmlIntermediateDir();
        const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
        await fs.access(jobHtmlDir);
        const files = await fs.readdir(jobHtmlDir);
        canRegenerate = files.some(f => f.endsWith('.html') || f.endsWith('.xhtml'));
      } catch {
        // Intermediate files don't exist
      }
      
      let errorMessage = `EPUB file not available. Status: ${job.status || 'UNKNOWN'}. ${epubError.message}`;
      if (canRegenerate && job.status === 'COMPLETED') {
        errorMessage += ' The EPUB file appears to be missing, but intermediate files exist. You can try regenerating the EPUB using the regenerate endpoint.';
      } else if (job.status === 'COMPLETED') {
        errorMessage += ' The conversion shows as completed, but the EPUB file is missing. You may need to re-run the conversion.';
      } else {
        errorMessage += ' Please ensure the conversion is complete.';
      }
      
      return badRequestResponse(res, errorMessage);
    }
  } catch (error) {
    console.error('Error getting EPUB sections:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-text - Get EPUB text content
router.get('/:jobId/epub-text', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const textContent = await EpubService.getEpubTextContent(parseInt(req.params.jobId));
    return successResponse(res, textContent);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-section/:sectionId/xhtml - Get section XHTML
router.get('/:jobId/epub-section/:sectionId/xhtml', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const jobId = parseInt(req.params.jobId);
    const sectionId = req.params.sectionId; // Keep as string, don't parse as int
    
    console.log(`[EPUB Route] Requesting section XHTML for job ${jobId}, sectionId: ${sectionId}`);
    
    const xhtml = await EpubService.getSectionXhtml(jobId, sectionId);
    res.setHeader('Content-Type', 'application/xhtml+xml');
    return res.send(xhtml);
  } catch (error) {
    console.error('[EPUB Route] Error getting section XHTML:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-css - Get EPUB CSS
router.get('/:jobId/epub-css', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const css = await EpubService.getEpubCss(parseInt(req.params.jobId));
    res.setHeader('Content-Type', 'text/css');
    return res.send(css);
  } catch (error) {
    console.error('[EPUB Route] Error getting CSS:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/epub-image/:imageName - Get EPUB image
router.get('/:jobId/epub-image/:imageName', async (req, res) => {
  try {
    const { EpubService } = await import('../services/epubService.js');
    const imageName = decodeURIComponent(req.params.imageName);
    const imageBuffer = await EpubService.getEpubImage(parseInt(req.params.jobId), imageName);
    
    // Determine content type from file extension
    const ext = path.extname(imageName).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        ext === '.gif' ? 'image/gif' :
                        ext === '.svg' ? 'image/svg+xml' :
                        'image/png';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return res.send(imageBuffer);
  } catch (error) {
    console.error('[EPUB Route] Error getting image:', error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/text-blocks - Get PDF text blocks for audio sync
router.get('/:jobId/text-blocks', async (req, res) => {
  try {
    const job = await ConversionService.getConversionJob(parseInt(req.params.jobId));
    
    if (!job.pdfDocumentId) {
      return badRequestResponse(res, 'PDF document not found for this job');
    }

    const { PdfDocumentModel } = await import('../models/PdfDocument.js');
    const pdf = await PdfDocumentModel.findById(job.pdfDocumentId || job.pdf_document_id);
    
    if (!pdf) {
      return notFoundResponse(res, 'PDF document not found');
    }

    // Get file path - handle both camelCase and snake_case
    const pdfFilePath = pdf.file_path || pdf.filePath;
    if (!pdfFilePath) {
      return notFoundResponse(res, 'PDF file path not found in database');
    }

    // Re-extract text blocks from PDF (or get from intermediate_data if stored)
    const { PdfExtractionService } = await import('../services/pdfExtractionService.js');
    const { getUploadDir } = await import('../config/fileStorage.js');
    
    // Resolve PDF file path (same logic as conversionService)
    let resolvedPdfPath = pdfFilePath;
    try {
      await fs.access(resolvedPdfPath);
    } catch (accessError) {
      // Try resolving relative to uploads directory
      const uploadDir = getUploadDir();
      const fileName = path.basename(pdfFilePath);
      const resolvedPath = path.join(uploadDir, fileName);
      try {
        await fs.access(resolvedPath);
        resolvedPdfPath = resolvedPath;
        console.log(`[Text Blocks] Resolved PDF path: ${resolvedPdfPath}`);
      } catch (resolvedError) {
        console.error(`[Text Blocks] PDF file not found at ${pdfFilePath} or ${resolvedPath}`);
        return errorResponse(res, `PDF file not found at ${pdfFilePath} or ${resolvedPath}`, 404);
      }
    }
    
    const textData = await PdfExtractionService.extractText(resolvedPdfPath);
    
    // Format text blocks for frontend with proper coordinate extraction
    // CRITICAL: Convert PDF coordinates (bottom-left origin) to image/HTML coordinates (top-left origin)
    const textBlocks = [];
    textData.pages.forEach((page, pageIndex) => {
      const pageHeight = page.height || 792; // Default page height in points
      (page.textBlocks || []).forEach((block, blockIndex) => {
        // Extract coordinates from boundingBox (primary) or direct properties (fallback)
        const bbox = block.boundingBox || {};
        const x = bbox.x || block.x || 0;
        const yBottom = bbox.y || block.y || 0; // PDF Y from bottom
        const width = bbox.width || block.width || 0;
        const height = bbox.height || block.height || 0;
        
        // Convert Y from bottom-left (PDF) to top-left (HTML/image)
        // Formula: yTop = pageHeight - (yBottom + height)
        const yTop = pageHeight - (yBottom + height);
        
        textBlocks.push({
          id: block.id || `page_${page.pageNumber}_block_${blockIndex}`,
          pageNumber: page.pageNumber,
          text: block.text || '',
          x: x,
          y: yTop, // Converted to top-left origin
          width: width,
          height: height,
          fontSize: block.fontSize || 12,
          fontName: block.fontName || 'Arial',
          // Include full boundingBox for reference (with original PDF coordinates)
          boundingBox: bbox,
          // Include normalized coordinates (0-1 range) for overlay positioning (top-left origin)
          normalizedX: page.width ? x / page.width : 0,
          normalizedY: page.height ? yTop / page.height : 0,
          normalizedWidth: page.width ? width / page.width : 0,
          normalizedHeight: page.height ? height / page.height : 0
        });
      });
    });
    
    return successResponse(res, {
      pages: textData.pages.map(p => ({
        pageNumber: p.pageNumber,
        text: p.text,
        width: p.width || 612, // Default page width in points
        height: p.height || 792, // Default page height in points
        textBlocks: (p.textBlocks || []).map((block, idx) => {
          // Extract coordinates from boundingBox (primary) or direct properties (fallback)
          const bbox = block.boundingBox || {};
          const x = bbox.x || block.x || 0;
          const yBottom = bbox.y || block.y || 0; // PDF Y from bottom
          const width = bbox.width || block.width || 0;
          const height = bbox.height || block.height || 0;
          const pageWidth = p.width || 612;
          const pageHeight = p.height || 792;
          
          // Convert Y from bottom-left (PDF) to top-left (HTML/image)
          // Formula: yTop = pageHeight - (yBottom + height)
          const yTop = pageHeight - (yBottom + height);
          
          return {
            id: block.id || `page_${p.pageNumber}_block_${idx}`,
            pageNumber: p.pageNumber,
            text: block.text || '',
            x: x,
            y: yTop, // Converted to top-left origin
            width: width,
            height: height,
            fontSize: block.fontSize || 12,
            fontName: block.fontName || 'Arial',
            // Include full boundingBox for reference (with original PDF coordinates)
            boundingBox: bbox,
            // Include normalized coordinates (0-1 range) for overlay positioning (top-left origin)
            normalizedX: pageWidth ? x / pageWidth : 0,
            normalizedY: pageHeight ? yTop / pageHeight : 0,
            normalizedWidth: pageWidth ? width / pageWidth : 0,
            normalizedHeight: pageHeight ? height / pageHeight : 0
          };
        })
      }))
    });
  } catch (error) {
    console.error('Error getting text blocks:', error);
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/conversions/:jobId - Delete conversion job
router.delete('/:jobId', async (req, res) => {
  try {
    await ConversionService.deleteConversionJob(parseInt(req.params.jobId));
    cacheDelByPrefix('conversions:');
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/regenerate-page/:pageNumber - Regenerate XHTML for a specific page
router.post('/:jobId/regenerate-page/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    
    const job = await ConversionService.getConversionJob(jobId);
    
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }
    
    if (job.status !== 'COMPLETED' && job.status !== 'IN_PROGRESS') {
      return badRequestResponse(res, `Can only regenerate pages for completed or in-progress conversions. Current status: ${job.status}`);
    }
    
    console.log(`[API] Regenerating XHTML for job ${jobId}, page ${pageNumber}...`);
    
    const result = await ConversionService.regeneratePageXhtml(jobId, pageNumber);
    
    res.setHeader('Content-Type', 'application/json');
    return successResponse(res, {
      message: `Page ${pageNumber} XHTML regenerated successfully`,
      pageNumber: result.pageNumber,
      xhtml: result.xhtml
    });
  } catch (error) {
    console.error(`[API] Error regenerating page XHTML:`, error);
    return errorResponse(res, error.message, 500);
  }
});

// POST /api/conversions/:jobId/regenerate-chapter/:pageNumber - Regenerate XHTML for the chapter that contains this page
router.post('/:jobId/regenerate-chapter/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);

    const job = await ConversionService.getConversionJob(jobId);
    if (!job) {
      return notFoundResponse(res, 'Conversion job not found');
    }

    if (job.status !== 'COMPLETED' && job.status !== 'IN_PROGRESS') {
      return badRequestResponse(res, `Can only regenerate chapters for completed or in-progress conversions. Current status: ${job.status}`);
    }

    console.log(`[API] Regenerating CHAPTER XHTML for job ${jobId}, containing page ${pageNumber}...`);

    const result = await ConversionService.regenerateChapterXhtmlByPage(jobId, pageNumber);

    res.setHeader('Content-Type', 'application/json');
    return successResponse(res, {
      message: `Chapter XHTML regenerated successfully (pages ${result.startPage}-${result.endPage})`,
      chapterNumber: result.chapterNumber,
      startPage: result.startPage,
      endPage: result.endPage,
      xhtml: result.xhtml,
      xhtmlFilePageNumber: result.xhtmlFilePageNumber
    });
  } catch (error) {
    console.error(`[API] Error regenerating chapter XHTML:`, error);
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/xhtml/:pageNumber - Get XHTML file for a specific page
router.get('/:jobId/xhtml/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    const xhtmlFilePath = path.join(jobHtmlDir, `page_${pageNumber}.xhtml`);
    
    try {
      await fs.access(xhtmlFilePath);
      const xhtmlContent = await fs.readFile(xhtmlFilePath, 'utf8');
      res.setHeader('Content-Type', 'application/xhtml+xml');
      return res.send(xhtmlContent);
    } catch (fileError) {
      return notFoundResponse(res, `XHTML file for page ${pageNumber} not found`);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/images - Get list of extracted images for a job
router.get('/:jobId/images', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}_images`);
    
    try {
      await fs.access(jobImagesDir);
      const files = await fs.readdir(jobImagesDir);
      const imageFiles = files
        .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
        .map(f => ({
          fileName: f,
          url: `/api/conversions/${jobId}/images/${f}`
        }));
      
      return successResponse(res, imageFiles);
    } catch (dirError) {
      return successResponse(res, []); // Return empty array if directory doesn't exist
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// OPTIONS /api/conversions/:jobId/images/:fileName - Handle CORS preflight
router.options('/:jobId/images/:fileName', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.status(204).send();
});

// GET /api/conversions/:jobId/images/:fileName - Get a specific image file
router.get('/:jobId/images/:fileName', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const fileName = req.params.fileName;
    
    // Security: prevent directory traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return badRequestResponse(res, 'Invalid file name');
    }
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobImagesDir = path.join(htmlIntermediateDir, `job_${jobId}_images`);
    const imagePath = path.join(jobImagesDir, fileName);
    
    try {
      await fs.access(imagePath);
      const imageBuffer = await fs.readFile(imagePath);
      
      // Determine content type
      const ext = path.extname(fileName).toLowerCase();
      let contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.webp') contentType = 'image/webp';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for images
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return res.send(imageBuffer);
    } catch (fileError) {
      return notFoundResponse(res, `Image file ${fileName} not found`);
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/conversions/:jobId/pages - Get list of all XHTML pages for a job
router.get('/:jobId/pages', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    
    try {
      await fs.access(jobHtmlDir);
      const files = await fs.readdir(jobHtmlDir);
      const xhtmlFiles = files
        .filter(f => f.endsWith('.xhtml'))
        .map(f => {
          const match = f.match(/page_(\d+)\.xhtml/);
          return {
            pageNumber: match ? parseInt(match[1]) : null,
            fileName: f,
            url: `/api/conversions/${jobId}/xhtml/${match ? match[1] : ''}`
          };
        })
        .filter(f => f.pageNumber !== null)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      
      const documentPageCount = await resolveDocumentPageCount(jobId);
      const maxSpine = xhtmlFiles.length ? Math.max(...xhtmlFiles.map((p) => p.pageNumber)) : 0;
      return successResponse(res, {
        spine: xhtmlFiles,
        documentPageCount: Math.max(documentPageCount, maxSpine),
        chapterSpineCount: xhtmlFiles.length
      });
    } catch (dirError) {
      const documentPageCount = await resolveDocumentPageCount(jobId);
      return successResponse(res, {
        spine: [],
        documentPageCount,
        chapterSpineCount: 0
      });
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// PUT /api/conversions/:jobId/xhtml/:pageNumber - Save modified XHTML for a page
router.put('/:jobId/xhtml/:pageNumber', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const pageNumber = parseInt(req.params.pageNumber);
    let { xhtml } = req.body;
    
    if (!xhtml || typeof xhtml !== 'string') {
      return badRequestResponse(res, 'XHTML content is required');
    }
    
    // Check if XHTML has proper document structure
    const hasDoctype = xhtml.trim().startsWith('<!DOCTYPE');
    const hasHtmlTag = xhtml.includes('<html');
    const hasHeadTag = xhtml.includes('<head>');
    const hasBodyTag = xhtml.includes('<body>');
    
    // If missing proper structure, wrap content in proper XHTML document
    if (!hasDoctype || !hasHtmlTag || !hasHeadTag || !hasBodyTag) {
      console.log(`[Save XHTML] Page ${pageNumber} missing document structure, wrapping content...`);
      
      // Extract all CSS from <style> tags (including unclosed ones)
      let cssContent = '';
      let bodyContent = xhtml;
      
      // Extract CSS from properly closed style tags
      const closedStyleMatches = xhtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (closedStyleMatches) {
        const extractedCss = closedStyleMatches.map(style => {
          const contentMatch = style.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          return contentMatch ? contentMatch[1] : '';
        }).filter(css => css.trim()).join('\n');
        if (extractedCss) {
          cssContent += extractedCss + '\n';
        }
        // Remove closed style tags from body content
        bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      }
      
      // Extract CSS from unclosed style tags (style tag without closing tag)
      // Look for <style> followed by content but no </style> before next tag or end
      const unclosedStyleMatch = bodyContent.match(/<style[^>]*>([\s\S]*?)(?=<[^/]|$)/i);
      if (unclosedStyleMatch) {
        const unclosedCss = unclosedStyleMatch[1].trim();
        if (unclosedCss) {
          cssContent += unclosedCss + '\n';
        }
        // Remove unclosed style tag from body content
        bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?(?=<[^/]|$)/i, '');
      }
      
      // Remove any wrapper divs that might be present
      bodyContent = bodyContent.replace(/<div[^>]*class=["']xhtml-content-wrapper["'][^>]*>/gi, '');
      bodyContent = bodyContent.replace(/<\/div>\s*$/, '').trim();
      
      // Clean up any remaining style tags that might be in the body
      bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
      bodyContent = bodyContent.replace(/<style[^>]*>[\s\S]*?(?=<[^/]|$)/gi, '');
      
      // Trim CSS content
        cssContent = cssContent.trim();
        
        // Fix CSS attribute selectors with double quotes (XHTML requirement)
        // In XHTML, CSS attribute selectors like [class*="value"] must use single quotes
        if (cssContent) {
          cssContent = cssContent.replace(/\[([^\]]*?)=["]([^"]*?)["]([^\]]*?)\]/g, (fullMatch, before, value, after) => {
            return `[${before}='${value}'${after}]`;
          });
          
          // More permissive pattern with optional whitespace
          if (cssContent.includes('="')) {
            cssContent = cssContent.replace(/\[([^\]]*?)\s*=\s*["]([^"]*?)["]\s*([^\]]*?)\]/g, (fullMatch, before, value, after) => {
              return `[${before.trim()}='${value}'${after.trim()}]`;
            });
          }
          
          // Final safety check for any remaining patterns
          if (cssContent.includes('="') && cssContent.includes('[')) {
            cssContent = cssContent.replace(/(\[[^\]]*?)=["]([^"]*?)["]([^\]]*?\])/g, (fullMatch, before, value, after) => {
              return `${before}='${value}'${after}`;
            });
          }
        }
        
        // Build proper XHTML structure
        xhtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Page ${pageNumber}</title>
${cssContent ? `<style type="text/css">\n${cssContent}\n</style>` : ''}
</head>
<body>
${bodyContent}
</body>
</html>`;
      
      console.log(`[Save XHTML] Wrapped page ${pageNumber} content in proper XHTML structure`);
    } else {
      // Even if structure is present, fix CSS attribute selectors
      xhtml = xhtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, cssContent) => {
        let fixedCss = cssContent;
        
        // Replace double quotes in CSS attribute selectors with single quotes
        fixedCss = fixedCss.replace(/\[([^\]]*?)=["]([^"]*?)["]([^\]]*?)\]/g, (fullMatch, before, value, after) => {
          return `[${before}='${value}'${after}]`;
        });
        
        // More permissive pattern with optional whitespace
        if (fixedCss.includes('="')) {
          fixedCss = fixedCss.replace(/\[([^\]]*?)\s*=\s*["]([^"]*?)["]\s*([^\]]*?)\]/g, (fullMatch, before, value, after) => {
            return `[${before.trim()}='${value}'${after.trim()}]`;
          });
        }
        
        // Final safety check
        if (fixedCss.includes('="') && fixedCss.includes('[')) {
          fixedCss = fixedCss.replace(/(\[[^\]]*?)=["]([^"]*?)["]([^\]]*?\])/g, (fullMatch, before, value, after) => {
            return `${before}='${value}'${after}`;
          });
        }
        
        return match.replace(cssContent, fixedCss);
      });
      
      // Fix unclosed style tags
      if (xhtml.includes('<style') && !xhtml.includes('</style>')) {
        const headCloseIdx = xhtml.indexOf('</head>');
        if (headCloseIdx !== -1) {
          xhtml = xhtml.substring(0, headCloseIdx) + '</style>' + xhtml.substring(headCloseIdx);
        } else {
          const htmlCloseIdx = xhtml.indexOf('</html>');
          if (htmlCloseIdx !== -1) {
            xhtml = xhtml.substring(0, htmlCloseIdx) + '</style></head>' + xhtml.substring(htmlCloseIdx);
          } else {
            xhtml = xhtml + '</style>';
          }
        }
      }
    }
    
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const jobHtmlDir = path.join(htmlIntermediateDir, `job_${jobId}_html`);
    
    // Ensure directory exists
    await fs.mkdir(jobHtmlDir, { recursive: true });
    
    const xhtmlFilePath = path.join(jobHtmlDir, `page_${pageNumber}.xhtml`);
    xhtml = ConversionService.ensureReadAloudOnImagesWithAlt(xhtml);
    try {
      const { xhtml: validXhtml } = validateXhtmlStrict(xhtml);
      xhtml = validXhtml;
    } catch (ve) {
      return badRequestResponse(res, ve.message || 'XHTML validation failed');
    }
    await fs.writeFile(xhtmlFilePath, xhtml, 'utf8');
    try {
      const canonical = extractCanonicalFromXhtml(xhtml, pageNumber);
      await fs.writeFile(
        path.join(jobHtmlDir, `page_${pageNumber}.canonical.json`),
        JSON.stringify(canonical, null, 2),
        'utf8'
      );
    } catch (_) { /* canonical is best-effort */ }
    
    return successResponse(res, { message: 'XHTML saved successfully', pageNumber });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /conversions/import-epub-for-sync
 * Upload an EPUB to skip PDF→conversion→zoning and open Sync Studio directly.
 * multipart: field "epub" (file), optional field "mode": auto | reflowable | fxl
 */
router.post('/import-epub-for-sync', epubImportUpload.single('epub'), async (req, res) => {
  let tmpPath = req.file?.path;
  try {
    if (!req.file) return badRequestResponse(res, 'Missing EPUB file (form field name: epub)');
    const modeRaw = (req.body?.mode || 'auto').toString().toLowerCase();
    const mode = ['auto', 'reflowable', 'fxl'].includes(modeRaw) ? modeRaw : 'auto';
    const buf = await fs.readFile(req.file.path);
    await fs.unlink(req.file.path).catch(() => {});
    tmpPath = null;
    const owner = {
      userId: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null
    };
    const result = await EpubDirectImportService.importForAudioSync(buf, req.file.originalname, mode, owner);
    const jid = result?.jobId ?? result?.job?.id ?? result?.pdfId ?? null;
    await ActivityService.logFromRequest(req, {
      action: 'epub.import_sync',
      entityType: 'conversion_job',
      entityId: jid ?? null,
      summary: 'Imported EPUB for Sync Studio',
      metadata: { kind: result?.kind }
    }).catch(() => {});
    cacheDelByPrefix('conversions:');
    cacheDelByPrefix('pdfs:');
    cacheDelByPrefix('kitaboo:jobs:');
    return successResponse(res, result, 201);
  } catch (error) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    return errorResponse(res, error.message, 500);
  }
});

export default router;

