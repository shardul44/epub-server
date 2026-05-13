import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PdfService } from '../services/pdfService.js';
import { ActivityService } from '../services/activityService.js';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
  forbiddenResponse
} from '../utils/responseHandler.js';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import fs from 'fs/promises';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import { paramPdfTenantAccess } from '../middlewares/tenantAccess.js';
import { cacheWrap, cacheDel, cacheDelByPrefix, TTL } from '../services/cacheService.js';
import { httpCache } from '../middlewares/httpCache.js';
import { getOrGenerateThumbnail, invalidateThumbnail } from '../services/thumbnailService.js';

const router = express.Router();

/* ══════════════════════════════════════════════════════════════
   THUMBNAIL SUB-ROUTER
   Uses a separate router instance so router.param('id', ...) on
   the main router does NOT fire for these routes.
   Auth only — no feature gate, no tenant access check.
══════════════════════════════════════════════════════════════ */
const thumbRouter = express.Router();

// GET /pdfs/:id/page/:pageNumber/thumbnail
thumbRouter.get('/:id/page/:pageNumber/thumbnail', authenticate, async (req, res) => {
  try {
    const pdfId      = parseInt(req.params.id);
    const pageNumber = parseInt(req.params.pageNumber);

    if (isNaN(pdfId) || isNaN(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ error: 'Invalid PDF ID or page number' });
    }

    const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
    const htmlIntermediateDir = getHtmlIntermediateDir();

    const { ConversionJobModel } = await import('../models/ConversionJob.js');
    const jobs = await ConversionJobModel.findByPdfDocumentId(pdfId);
    const job  = jobs.find(j => j.status === 'COMPLETED') ?? jobs[0];

    if (job) {
      const jobId = job.id;
      const pngDir  = path.join(htmlIntermediateDir, `job_${jobId}_png`);
      const pngFile = path.join(pngDir, `page_${pageNumber}.png`);

      try {
        await fs.access(pngFile);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(path.resolve(pngFile));
      } catch {
        const altFile = path.join(htmlIntermediateDir, `job_${jobId}`, `page_${pageNumber}.png`);
        try {
          await fs.access(altFile);
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.sendFile(path.resolve(altFile));
        } catch {
          // fall through to SVG placeholder
        }
      }
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="560" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="2" rx="4"/>
  <text x="200" y="260" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#9ca3af">Page ${pageNumber}</text>
  <text x="200" y="285" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#d1d5db">No preview available</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(svg);
  } catch (error) {
    console.error(`[page thumbnail] PDF ${req.params.id} page ${req.params.pageNumber}:`, error.message);
    return res.status(500).json({ error: 'Failed to serve page thumbnail' });
  }
});

// GET /pdfs/:id/thumbnail — serves real page-1 PNG, generated on demand and cached to disk
thumbRouter.get('/:id/thumbnail', authenticate, async (req, res) => {
  try {
    const pdfId = parseInt(req.params.id);
    if (isNaN(pdfId)) return res.status(400).json({ error: 'Invalid PDF ID' });

    // 1. Disk cache (fastest path)
    const { getThumbnailDir } = await import('../config/fileStorage.js');
    const cachedPath = path.join(getThumbnailDir(), `pdf-${pdfId}.png`);
    try {
      await fs.access(cachedPath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.resolve(cachedPath));
    } catch { /* not cached yet */ }

    // 2. page_1.png from a completed conversion job
    const { getHtmlIntermediateDir } = await import('../config/fileStorage.js');
    const htmlIntermediateDir = getHtmlIntermediateDir();
    const { ConversionJobModel } = await import('../models/ConversionJob.js');
    const jobs = await ConversionJobModel.findByPdfDocumentId(pdfId);
    const completedJob = jobs.find(j => j.status === 'COMPLETED') ?? jobs[0];

    if (completedJob) {
      const jobId = completedJob.id;
      for (const candidate of [
        path.join(htmlIntermediateDir, `job_${jobId}_png`, 'page_1.png'),
        path.join(htmlIntermediateDir, `job_${jobId}`, 'page_1.png'),
      ]) {
        try {
          await fs.access(candidate);
          await fs.copyFile(candidate, cachedPath).catch(() => {});
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(path.resolve(candidate));
        } catch { /* try next */ }
      }
    }

    // 3. Generate from the original PDF file using pdfjs-dist + canvas
    try {
      const pdf = await PdfService.getPdfDocument(pdfId);
      if (pdf) {
        const { getUploadDir } = await import('../config/fileStorage.js');
        const uploadDir = getUploadDir();
        const filePath = path.isAbsolute(pdf.fileName ?? '')
          ? pdf.fileName
          : path.join(uploadDir, pdf.fileName ?? '');

        const thumbPath = await getOrGenerateThumbnail(pdfId, filePath);
        if (thumbPath) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(path.resolve(thumbPath));
        }
      }
    } catch (genErr) {
      console.warn(`[thumbnail] Generation failed for PDF ${pdfId}:`, genErr.message);
    }

    // 4. SVG fallback — never 404
    let fileName = `PDF-${pdfId}`;
    try {
      const pdf = await PdfService.getPdfDocument(pdfId);
      if (pdf?.originalFileName) {
        const safe = pdf.originalFileName
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        fileName = safe.length > 30 ? safe.substring(0, 30) + '...' : safe;
      }
    } catch (_) { /* ignore */ }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="560" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5" rx="6"/>
  <rect x="40" y="60" width="320" height="4" fill="#e2e8f0" rx="2"/>
  <rect x="40" y="76" width="240" height="4" fill="#e2e8f0" rx="2"/>
  <rect x="40" y="92" width="280" height="4" fill="#e2e8f0" rx="2"/>
  <rect x="40" y="120" width="320" height="200" fill="#f1f5f9" rx="4"/>
  <rect x="40" y="336" width="320" height="4" fill="#e2e8f0" rx="2"/>
  <rect x="40" y="352" width="200" height="4" fill="#e2e8f0" rx="2"/>
  <rect x="40" y="368" width="260" height="4" fill="#e2e8f0" rx="2"/>
  <text x="200" y="230" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#94a3b8">${fileName}</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(svg);
  } catch (error) {
    console.error(`[thumbnail] PDF ${req.params.id}:`, error.message);
    const fallbackSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="560" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5" rx="6"/>
  <text x="200" y="290" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#94a3b8">No preview</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).send(fallbackSvg);
  }
});

// Mount the thumbnail sub-router BEFORE the main router's param/feature middleware
router.use('/', thumbRouter);

/* ── All other PDF routes require conversion.basic feature ─── */
router.use(authenticate, requireFeature('conversion.basic'));

router.param('id', paramPdfTenantAccess);

const storage = multer.memoryStorage();

async function pdfUploadMulter(req, res, next) {
  try {
    const { PlatformSettingsModel } = await import('../models/PlatformSettings.js');
    const maxBytes = await PlatformSettingsModel.getMaxUploadBytesCached();
    const upload = multer({
      storage,
      limits: { fileSize: maxBytes }
    });
    upload.single('file')(req, res, (multerErr) => {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          const limitMB = Math.round(maxBytes / (1024 * 1024));
          return badRequestResponse(res, `File too large. Maximum allowed size is ${limitMB} MB.`);
        }
        return badRequestResponse(res, multerErr.message || 'File upload error');
      }
      next();
    });
  } catch (e) {
    return errorResponse(res, e.message || 'Upload initialization failed', 500);
  }
}

// Initialize directories
ensureDirectories();

// POST /api/pdfs/upload - Upload PDF and convert to EPUB3
router.post('/upload', pdfUploadMulter, async (req, res) => {
  try {
    if (!req.file) {
      return badRequestResponse(res, 'PDF file is required');
    }

    const file = req.file;

    // Check if ZIP file
    const isZip = file.mimetype === 'application/zip' || 
                  file.mimetype === 'application/x-zip-compressed' ||
                  file.originalname.toLowerCase().endsWith('.zip');

    if (isZip) {
      // Handle ZIP file
      const uploadedPdfs = await PdfService.extractAndUploadPdfsFromZip(file);
      return successResponse(res, {
        totalUploaded: uploadedPdfs.length,
        totalFailed: 0,
        successfulUploads: uploadedPdfs,
        errors: []
      }, 201);
    } else {
      // Handle single PDF - convert to EPUB3
      const layoutType = req.body.layoutType || 'REFLOWABLE';
      const owner = { userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null };
      const response = await PdfService.uploadAndAnalyzePdf(file, { layoutType }, owner);
      await ActivityService.logFromRequest(req, {
        action: 'pdf.upload',
        entityType: 'pdf_document',
        entityId: response.id,
        summary: `Uploaded ${response.originalFileName || 'PDF'}`
      }).catch(() => {});
      // Invalidate PDF list caches so next fetch returns fresh data
      cacheDelByPrefix('pdfs:');
      return successResponse(res, response, 201);
    }
  } catch (error) {
    if (error.code === 'USAGE_LIMIT') {
      return forbiddenResponse(res, error.message);
    }
    console.error('[POST /pdfs/upload] Upload failed:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: error.stack,
    });
    return errorResponse(res, error.message, 500);
  }
});

async function pdfBulkUploadMulter(req, res, next) {
  try {
    const { PlatformSettingsModel } = await import('../models/PlatformSettings.js');
    const maxBytes = await PlatformSettingsModel.getMaxUploadBytesCached();
    const upload = multer({
      storage,
      limits: { fileSize: maxBytes }
    });
    upload.array('files', 10)(req, res, (multerErr) => {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          const limitMB = Math.round(maxBytes / (1024 * 1024));
          return badRequestResponse(res, `File too large. Maximum allowed size is ${limitMB} MB per file.`);
        }
        return badRequestResponse(res, multerErr.message || 'File upload error');
      }
      next();
    });
  } catch (e) {
    return errorResponse(res, e.message || 'Upload initialization failed', 500);
  }
}

// POST /api/pdfs/upload/bulk - Bulk upload PDFs
router.post('/upload/bulk', pdfBulkUploadMulter, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return badRequestResponse(res, 'At least one file is required');
    }

    const successfulUploads = [];
    const errors = [];
    const owner = { userId: req.user?.id ?? null, organizationId: req.user?.organizationId ?? null };

    for (const file of req.files) {
      try {
        const isZip = file.mimetype === 'application/zip' || 
                      file.mimetype === 'application/x-zip-compressed' ||
                      file.originalname.toLowerCase().endsWith('.zip');

        if (isZip) {
          const zipResults = await PdfService.extractAndUploadPdfsFromZip(file);
          successfulUploads.push(...zipResults);
        } else {
          const response = await PdfService.uploadAndAnalyzePdf(file, {}, owner);
          await ActivityService.logFromRequest(req, {
            action: 'pdf.upload',
            entityType: 'pdf_document',
            entityId: response.id,
            summary: `Uploaded ${response.originalFileName || 'PDF'}`
          }).catch(() => {});
          successfulUploads.push(response);
        }
      } catch (error) {
        if (error.code === 'USAGE_LIMIT') {
          errors.push({
            fileName: file.originalname,
            error: error.message,
            code: 'USAGE_LIMIT'
          });
          break;
        }
        errors.push({
          fileName: file.originalname,
          error: error.message
        });
      }
    }

    return successResponse(res, {
      totalUploaded: successfulUploads.length,
      totalFailed: errors.length,
      successfulUploads,
      errors
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs - Get all PDFs (?scope=own = only PDFs this user uploaded; org admins default: full org)
router.get('/', httpCache(TTL.MEDIUM), async (req, res) => {
  try {
    const scope = req.query.scope === 'own' ? { onlyOwn: true } : {};
    const userId = req.user?.id ?? 'anon';
    const orgId  = req.user?.organizationId ?? 'none';
    const scopeKey = req.query.scope === 'own' ? 'own' : 'org';
    const cacheKey = `pdfs:list:${orgId}:${userId}:${scopeKey}`;

    const pdfs = await cacheWrap(cacheKey, () => PdfService.getAllPdfs(req.user, scope), TTL.MEDIUM);
    return successResponse(res, pdfs);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/grouped - Get PDFs grouped by ZIP
router.get('/grouped', httpCache(TTL.MEDIUM), async (req, res) => {
  try {
    const scope = req.query.scope === 'own' ? { onlyOwn: true } : {};
    const orgId  = req.user?.organizationId ?? 'none';
    const cacheKey = `pdfs:grouped:${orgId}`;
    const grouped = await cacheWrap(cacheKey, () => PdfService.getPdfsGroupedByZip(req.user, scope), TTL.MEDIUM);
    return successResponse(res, grouped);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/view - View PDF inline (for display in iframe)
router.get('/:id/view', async (req, res) => {
  try {
    const { filePath, originalFileName } = await PdfService.downloadPdf(parseInt(req.params.id));
    
    // Set headers for inline viewing
    res.setHeader('Content-Disposition', `inline; filename="${originalFileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Support range requests for better PDF viewing
    const range = req.headers.range;
    const fileBuffer = await fs.readFile(filePath);
    const fileSize = fileBuffer.length;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.slice(start, end + 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'application/pdf'
      });
      return res.end(chunk);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.send(fileBuffer);
    }
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/download - Download PDF (forces download)
router.get('/:id/download', async (req, res) => {
  try {
    const { filePath, originalFileName } = await PdfService.downloadPdf(parseInt(req.params.id));
    
    res.setHeader('Content-Disposition', `attachment; filename="${originalFileName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    const fileBuffer = await fs.readFile(filePath);
    return res.send(fileBuffer);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id/audio - Download audio file
router.get('/:id/audio', async (req, res) => {
  try {
    const { filePath, fileName } = await PdfService.downloadAudio(parseInt(req.params.id));
    
    const range = req.headers.range;
    const fileBuffer = await fs.readFile(filePath);
    const fileSize = fileBuffer.length;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = fileBuffer.slice(start, end + 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg'
      });
      return res.end(chunk);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', fileSize);
      return res.send(fileBuffer);
    }
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    return errorResponse(res, error.message, 500);
  }
});

// GET /api/pdfs/:id - Get PDF by ID (must come after specific routes)
router.get('/:id', async (req, res) => {
  try {
    const pdf = await PdfService.getPdfDocument(parseInt(req.params.id));
    return successResponse(res, pdf);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /api/pdfs/:id - Delete PDF
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log('DELETE /api/pdfs/:id - Received request to delete PDF with id:', id);
    
    if (isNaN(id)) {
      console.error('Invalid PDF ID provided:', req.params.id);
      return badRequestResponse(res, 'Invalid PDF ID');
    }
    
    await PdfService.deletePdfDocument(id);
    
    // Invalidate all PDF list caches
    cacheDelByPrefix('pdfs:');
    // Remove cached thumbnail
    invalidateThumbnail(id).catch(() => {});
    
    console.log('✓ Successfully processed deletion request for PDF id:', id);
    return res.status(204).send();
  } catch (error) {
    console.error('✗ Error in DELETE /api/pdfs/:id route:', {
      message: error.message,
      stack: error.stack,
      params: req.params
    });
    
    if (error.message && error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    
    // Return detailed error in development, generic in production
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error.message || 'Failed to delete PDF'
      : 'Failed to delete PDF. Please check server logs for details.';
    
    return errorResponse(res, errorMessage, 500);
  }
});

export default router;

