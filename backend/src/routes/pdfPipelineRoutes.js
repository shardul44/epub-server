import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
} from '../utils/responseHandler.js';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import { noCache } from '../middlewares/httpCache.js';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await ensureDirectories();
      cb(null, getUploadDir());
    },
    filename: (_req, file, cb) => {
      const safe = (file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `pdf_pipeline_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname?.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

async function loadPipeline() {
  return import('../../dist/pdf-pipeline/index.js');
}

/**
 * POST /pdf/upload
 * Upload a PDF and return job ID (job initialized, not yet converted).
 */
router.post('/upload', authenticate, requireFeature('hifi_fxl.pdf_to_epub'), upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return badRequestResponse(res, 'PDF file is required (field name: pdf)');
    }

    const { PdfConversionService, pdfPipelineJobStore } = await loadPipeline();
    const jobId = uuidv4();
    const jobDir = await PdfConversionService.initializeJob(jobId, req.file.path);

    return successResponse(res, {
      jobId,
      jobDir,
      sourcePdf: req.file.originalname,
      status: 'PENDING',
      message: 'PDF uploaded. Call POST /pdf/convert to start conversion.',
    }, 201);
  } catch (error) {
    console.error('[PdfPipeline] upload error:', error);
    return errorResponse(res, error.message || 'Upload failed', 500);
  }
});

/**
 * POST /pdf/convert
 * Start conversion for an uploaded job.
 * Body: { jobId, title?, author?, language?, splitPages? }
 */
router.post('/convert', authenticate, requireFeature('hifi_fxl.pdf_to_epub'), async (req, res) => {
  try {
    const { jobId, title, author, language, splitPages, pageBatchSize } = req.body || {};
    if (!jobId) {
      return badRequestResponse(res, 'jobId is required');
    }

    const { PdfConversionService, pdfPipelineJobStore } = await loadPipeline();
    const job = pdfPipelineJobStore.get(jobId);
    if (!job) {
      return notFoundResponse(res, 'Job not found');
    }
    if (job.status === 'IN_PROGRESS') {
      return badRequestResponse(res, 'Conversion already in progress');
    }
    if (job.status === 'COMPLETED') {
      return badRequestResponse(res, 'Job already completed. Upload a new PDF to reconvert.');
    }

    // Fire-and-forget async conversion
    PdfConversionService.convert(jobId, { title, author, language, splitPages, pageBatchSize }).catch((err) => {
      console.error(`[PdfPipeline] convert failed for ${jobId}:`, err.message);
    });

    return successResponse(res, {
      jobId,
      status: 'IN_PROGRESS',
      message: 'Conversion started. Poll GET /jobs/:id for status.',
    }, 202);
  } catch (error) {
    console.error('[PdfPipeline] convert error:', error);
    return errorResponse(res, error.message || 'Conversion failed to start', 500);
  }
});

/**
 * GET /pdf/jobs/:id — alias for job status (also available at /jobs/:id)
 */
router.get('/jobs/:id', authenticate, noCache, async (req, res) => {
  return handleGetJob(req, res);
});

export async function handleGetJob(req, res) {
  try {
    const { id } = req.params;
    const { pdfPipelineJobStore } = await loadPipeline();

    if (!pdfPipelineJobStore.isPipelineJobId(id)) {
      return notFoundResponse(res, 'Pipeline job not found');
    }

    const job = pdfPipelineJobStore.get(id);
    if (!job) {
      return notFoundResponse(res, 'Job not found');
    }

    return successResponse(res, {
      id: job.id,
      status: job.status,
      progress: job.progress,
      step: job.step,
      error: job.error,
      pageCount: job.pageCount,
      wordCount: job.wordCount,
      sentenceCount: job.sentenceCount,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    console.error('[PdfPipeline] get job error:', error);
    return errorResponse(res, error.message || 'Failed to get job', 500);
  }
}

export async function handleGetCoords(req, res) {
  try {
    const { id } = req.params;
    const { pdfPipelineJobStore, CoordinateService } = await loadPipeline();

    if (!pdfPipelineJobStore.isPipelineJobId(id)) {
      return notFoundResponse(res, 'Pipeline job not found');
    }

    const job = pdfPipelineJobStore.get(id);
    if (!job) {
      return notFoundResponse(res, 'Job not found');
    }
    if (!job.coordsPath) {
      return badRequestResponse(res, 'Coordinates not yet available. Conversion may still be in progress.');
    }

    const coords = await CoordinateService.load(job.coordsPath);
    return successResponse(res, coords);
  } catch (error) {
    console.error('[PdfPipeline] get coords error:', error);
    return errorResponse(res, error.message || 'Failed to get coordinates', 500);
  }
}

export async function handleGetEpub(req, res) {
  try {
    const { id } = req.params;
    const { pdfPipelineJobStore } = await loadPipeline();

    if (!pdfPipelineJobStore.isPipelineJobId(id)) {
      return notFoundResponse(res, 'Pipeline job not found');
    }

    const job = pdfPipelineJobStore.get(id);
    if (!job) {
      return notFoundResponse(res, 'Job not found');
    }
    if (!job.epubPath) {
      return badRequestResponse(res, 'EPUB not yet available. Conversion may still be in progress.');
    }

    try {
      await fs.access(job.epubPath);
    } catch {
      return notFoundResponse(res, 'EPUB file not found on disk');
    }

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="fxl_${id}.epub"`);
    return res.sendFile(path.resolve(job.epubPath));
  } catch (error) {
    console.error('[PdfPipeline] get epub error:', error);
    return errorResponse(res, error.message || 'Failed to download EPUB', 500);
  }
}

router.get('/jobs/:id/coords', authenticate, noCache, handleGetCoords);
router.get('/jobs/:id/epub', authenticate, handleGetEpub);

export default router;
