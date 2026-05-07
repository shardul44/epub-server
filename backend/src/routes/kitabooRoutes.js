import express from 'express';
import multer from 'multer';
import { KitabooFxlService } from '../services/KitabooFxlService.js';
import { kitabooFxlJobStore } from '../services/kitabooFxlJobStore.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
import { successResponse, errorResponse } from '../utils/responseHandler.js';
import { getHtmlIntermediateDir, getEpubOutputDir } from '../config/fileStorage.js';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import sharp from 'sharp';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import { paramJobTenantAccess } from '../middlewares/tenantAccess.js';
import { cacheWrap, cacheDel, cacheDelByPrefix, TTL } from '../services/cacheService.js';
import { httpCache } from '../middlewares/httpCache.js';

const router = express.Router();
router.use(authenticate, requireFeature('kitaboo.import'));

router.param('jobId', paramJobTenantAccess);

const kitabooHumanAudioUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${req.params.jobId}`, 'human_audio');
      await fs.mkdir(dir, { recursive: true }).catch(() => { });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `page_${req.params.pageNumber}.mp3`);
    }
  }),
  limits: { fileSize: 150 * 1024 * 1024 }
});

/** Single long audio for all pages: save as narration.mp3 */
const kitabooSingleBookAudioUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${req.params.jobId}`, 'human_audio');
      await fs.mkdir(dir, { recursive: true }).catch(() => { });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, 'narration.mp3')
  }),
  limits: { fileSize: 150 * 1024 * 1024 }
});

/** Optional clean page image: save as page_<pageNumber>_clean.png in high_fidelity_render */
const kitabooCleanPageUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${req.params.jobId}`, 'high_fidelity_render');
      await fs.mkdir(dir, { recursive: true }).catch(() => { });
      cb(null, dir);
    },
    filename: (req, _file, cb) => {
      const pageNumber = req.params.pageNumber || '1';
      cb(null, `page_${pageNumber}_clean.png`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

/**
 * GET /api/kitaboo/ready/:jobId
 * Check if this job has WebP assets; if so return { ready: true, pages } so frontend can load without re-running.
 * If job is not in memory (e.g. after restart), recover from DB and hydrate store so studio can open.
 */
router.get('/ready/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) {
        const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
        const webpDir = path.join(intermediateDir, 'webp');
        const highFiDir = path.join(intermediateDir, 'high_fidelity_render');
        const hasWebp = await fs.access(webpDir).then(() => true).catch(() => false);
        const hasHighFi = await fs.access(highFiDir).then(() => true).catch(() => false);
        if (hasWebp || hasHighFi) {
          kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
          job = kitabooFxlJobStore.get(jobId);
        } else {
          return successResponse(res, { ready: false });
        }
      }
    }
    if (!job) return successResponse(res, { ready: false });
    const pdfId = job.pdfId;
    const pdfDoc = await PdfDocumentModel.findById(pdfId);
    if (!pdfDoc) return successResponse(res, { ready: false });

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const webpDir = path.join(intermediateDir, 'webp');
    const highFiDir = path.join(intermediateDir, 'high_fidelity_render');

    let imageDir = webpDir;
    let isHighFi = false;

    try {
      await fs.access(webpDir);
    } catch {
      try {
        await fs.access(highFiDir);
        imageDir = highFiDir;
        isHighFi = true;
      } catch {
        return successResponse(res, { ready: false });
      }
    }

    let pdfPageCount = 0;
    try {
      pdfPageCount = await KitabooFxlService.getPdfPageCount(pdfDoc.file_path);
    } catch {
      // EPUB-direct-import stubs (and any non-PDF path) — rely on rendered assets only
      pdfPageCount = 0;
    }
    const existingFiles = await fs.readdir(imageDir).catch(() => []);
    const isTargetExt = f => f.toLowerCase().endsWith(isHighFi ? '.png' : '.webp');
    const imageFiles = existingFiles.filter(f => isTargetExt(f) && !f.includes('_clean'));

    imageFiles.sort((a, b) => {
      const na = parseInt(a.match(/page_?(\d+)/i)?.[1] || '0', 10);
      const nb = parseInt(b.match(/page_?(\d+)/i)?.[1] || '0', 10);
      return na - nb;
    });

    if (pdfPageCount > 0 && imageFiles.length !== pdfPageCount) {
      // If mismatch, maybe some pages failed? But usually we want all.
      // For high-fi, strictly we want all.
      if (imageFiles.length === 0) return successResponse(res, { ready: false });
    }

    // For high-fi, we don't have loadExistingWebpAssets helper, just map files
    let normalizedAssets = [];
    if (isHighFi) {
      for (const f of imageFiles) {
        const meta = await sharp(path.join(imageDir, f)).metadata();
        normalizedAssets.push({
          fileName: f,
          dimensions: { width: meta.width, height: meta.height }
        });
      }
    } else {
      normalizedAssets = await KitabooFxlService.loadExistingWebpAssets(webpDir);
    }

    // Recover metadata (dimensions, fonts) if stored
    let jobMetadata = null;
    const metadataPath = path.join(imageDir, 'job_metadata.json');
    try {
      const fs = await import('fs/promises');
      const data = await fs.default.readFile(metadataPath, 'utf8');
      jobMetadata = JSON.parse(data);
      if (jobMetadata && jobMetadata.fontMapping) {
        KitabooFxlService._fontMappingCache[jobId] = jobMetadata.fontMapping;
        console.log(`[KitabooRoute] Restored font mapping for job ${jobId}`);
      }
    } catch (e) {
      // No metadata found
    }

    const existingZones = await KitabooZoneModel.getZonesByJobId(jobId);
    const finalZones = normalizedAssets.map((_, index) => existingZones[index + 1] || []);

    const pages = normalizedAssets.map((asset, index) => {
      const pageNum = index + 1;
      const rawZones = finalZones[index] || [];
      const zones = KitabooFxlService.normalizeZoneIdsForPage(pageNum, rawZones);
      const relativeDir = isHighFi ? 'high_fidelity_render' : 'webp';

      const pageMeta = jobMetadata?.pagesMetadata?.find(p => p.pageNumber === pageNum);

      return {
        pageNumber: pageNum,
        imagePath: `/backend/html_intermediate/kitaboo_${jobId}/${relativeDir}/${asset.fileName}`,
        dimensions: asset.dimensions,
        pointsDimensions: pageMeta?.pointsDimensions || null,
        zones
      };
    });

    return successResponse(res, {
      ready: true,
      pages,
      jobId,
      pdfId,
      extractionLevel: jobMetadata?.extractionLevel || 'sentence',
      zoneLevel: jobMetadata?.zoneLevel || undefined,
      extractedFonts: jobMetadata?.extractedFonts || []
    });
  } catch (error) {
    console.error('[KitabooRoute] Ready check error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/jobs
 * List all FXL conversion jobs (for Conversions page). In-memory jobs are merged with
 * jobs recovered from kitaboo_zones so completed FXL jobs survive server restart.
 */
router.get('/jobs', httpCache(TTL.SHORT), async (req, res) => {
  try {
    const orgId = req.user?.organizationId ?? 'none';
    const cacheKey = `kitaboo:jobs:${orgId}`;

    const jobs = await cacheWrap(cacheKey, async () => {
      const inMemory = kitabooFxlJobStore.listAll();
      const inMemoryIds = new Set(inMemory.map(j => String(j.jobId)));
      const fromDb = await KitabooZoneModel.getDistinctJobs();
      const recovered = fromDb
        .filter(({ jobId }) => !inMemoryIds.has(String(jobId)))
        .map(({ jobId, pdfId }) => ({
          jobId,
          pdfId: String(pdfId),
          pdfDocumentId: parseInt(pdfId, 10),
          jobType: 'FXL',
          id: jobId,
          status: 'COMPLETED',
          progressPercentage: 100,
          currentStep: 'Complete',
          createdAt: null,
          completedAt: null
        }));
      return [...inMemory, ...recovered].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
    }, TTL.SHORT);

    return successResponse(res, jobs);
  } catch (error) {
    console.error('[KitabooRoute] List jobs error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * DELETE /api/kitaboo/jobs/:jobId
 * Permanently delete an FXL job: in-memory store, DB zones, intermediate dir, and EPUB output.
 * Idempotent: if the job record is already gone (e.g. failed before zones were saved, or server
 * restarted after in-memory failure), still remove store entry, zones, and on-disk dirs — 204.
 */
router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = kitabooFxlJobStore.get(jobId) || await KitabooZoneModel.getJobByJobId(jobId);
    if (!job) {
      console.warn(`[KitabooRoute] DELETE jobs/${jobId}: no store/DB row; running cleanup anyway`);
    }

    kitabooFxlJobStore.remove(jobId);
    const deletedZones = await KitabooZoneModel.deleteByJobId(jobId);
    console.log(`[KitabooRoute] Deleted FXL job ${jobId}, ${deletedZones} zone rows`);

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    try {
      await fs.rm(intermediateDir, { recursive: true, force: true });
      console.log(`[KitabooRoute] Deleted intermediate dir: ${intermediateDir}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[KitabooRoute] Could not delete intermediate dir: ${e.message}`);
    }

    const outputDir = path.join(getEpubOutputDir(), `fxl_${jobId}`);
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
      console.log(`[KitabooRoute] Deleted output dir: ${outputDir}`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[KitabooRoute] Could not delete output dir: ${e.message}`);
    }

    cacheDelByPrefix('kitaboo:jobs:');
    return res.status(204).send();
  } catch (error) {
    console.error('[KitabooRoute] Delete job error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/job/:jobId
 * Get FXL job status and progress (for polling). If job not in memory, recover from DB so studio can open.
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) {
        kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
        job = kitabooFxlJobStore.get(jobId);
      }
    }
    if (!job) return errorResponse(res, 'No job found', 404);
    let extractionLevel = job.extractionLevel;
    let pages = job.pages;

    // When job was restored from DB, pages may be null. Hydrate from DB so Zoning Studio always receives ONLY grouped zones (never raw glyph items).
    // IMPORTANT: Build one page per actual asset (1..N). Pages with no zones must still appear so "Page 7" shows PDF page 7, not page 8's content.
    if (job.status === 'COMPLETED' && (!pages || pages.length === 0)) {
      try {
        const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
        const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
        const webpDir = path.join(intermediateDir, 'webp');
        const highFiDir = path.join(intermediateDir, 'high_fidelity_render');
        let assetDir = webpDir;
        let isHighFi = false;
        try {
          await fs.access(webpDir);
        } catch (e) {
          try {
            await fs.access(highFiDir);
            assetDir = highFiDir;
            isHighFi = true;
          } catch (_) { /* no assets */ }
        }
        const allFiles = await fs.readdir(assetDir).catch(() => []);
        const pattern = isHighFi ? /^page_(\d+)(_clean)?\.png$/i : /^page_?(\d+)\.webp$/i;
        const pageToFiles = {};
        for (const f of allFiles) {
          const match = f.match(pattern);
          if (match) {
            const pageNum = parseInt(match[1], 10);
            if (!pageToFiles[pageNum]) pageToFiles[pageNum] = [];
            pageToFiles[pageNum].push(f);
          }
        }
        const allPageNumbers = Object.keys(pageToFiles).map(k => parseInt(k, 10)).filter(n => n > 0).sort((a, b) => a - b);
        if (allPageNumbers.length > 0) {
          const basePath = `/backend/html_intermediate/kitaboo_${jobId}/${isHighFi ? 'high_fidelity_render' : 'webp'}`;
          pages = [];
          for (const pageNum of allPageNumbers) {
            const pageFiles = pageToFiles[pageNum] || [];
            const fileName = pageFiles.find(f => !f.toLowerCase().includes('_clean')) || pageFiles[0];
            if (!fileName) continue;
            const filePath = path.join(assetDir, fileName);
            const metadata = await sharp(filePath).metadata().catch(() => ({}));
            const zones = (zonesByPage[pageNum] || []).sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
            pages.push({
              pageNumber: pageNum,
              imagePath: `${basePath}/${fileName}`,
              dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
              zones
            });
          }
        }
      } catch (e) {
        console.warn('[KitabooRoute] Job pages hydration from DB failed:', e.message);
      }
    }

    let zoneLevel;
    try {
      const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
      const metadataPath = path.join(intermediateDir, 'high_fidelity_render', 'job_metadata.json');
      const data = await fs.readFile(metadataPath, 'utf8');
      const meta = JSON.parse(data);
      if (!extractionLevel) extractionLevel = meta.extractionLevel || 'sentence';
      zoneLevel = meta.zoneLevel;
    } catch (_) { /* no metadata */ }
    return successResponse(res, {
      jobId: job.jobId,
      pdfId: job.pdfId,
      status: job.status,
      progressPercentage: job.progressPercentage,
      currentStep: job.currentStep,
      error: job.error || undefined,
      pages: pages || undefined,
      extractionLevel: extractionLevel || 'sentence',
      zoneLevel: zoneLevel || undefined
    });
  } catch (error) {
    console.error('[KitabooRoute] Job status error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/process/:pdfId
 * Start the Kitaboo FXL workflow for a PDF. Runs in background; returns 202 with jobId. Client should poll GET /job/:pdfId for progress.
 */
router.post('/process/:pdfId', async (req, res) => {
  try {
    const { pdfId } = req.params;
    const pdfDoc = await PdfDocumentModel.findById(pdfId);

    if (!pdfDoc) {
      return errorResponse(res, 'PDF document not found', 404);
    }

    const jobId = Date.now().toString();
    kitabooFxlJobStore.start(pdfId, jobId);

    KitabooFxlService.processPdf(jobId, pdfDoc.file_path, pdfId, (progress, currentStep) => {
      kitabooFxlJobStore.updateProgress(jobId, { progressPercentage: progress, currentStep });
    })
      .then((result) => {
        kitabooFxlJobStore.complete(jobId, result.pages);
        cacheDelByPrefix('kitaboo:jobs:');
      })
      .catch((err) => {
        console.error('[KitabooRoute] FXL process error:', err);
        kitabooFxlJobStore.fail(jobId, err.message);
        cacheDelByPrefix('kitaboo:jobs:');
      });

    cacheDelByPrefix('kitaboo:jobs:');
    res.status(202).json({
      success: true,
      data: {
        jobId,
        pdfId,
        status: 'IN_PROGRESS',
        progressPercentage: 0,
        currentStep: 'Starting...',
        message: 'FXL conversion started. Poll GET /api/kitaboo/job/' + jobId + ' for progress.'
      }
    });
  } catch (error) {
    console.error('[KitabooRoute] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/process-layout-only
 * Classic PDF→FXL pipeline: render pages + PDF layout extraction (no AI zoning).
 * Body: { pdfId: number }. Returns jobId; poll GET /api/kitaboo/job/:jobId for pages with layoutFragments.
 * Publish with { classicLayout: true } to build EPUB with background image + positioned divs + CSS coordinate classes.
 */
router.post('/process-layout-only', async (req, res) => {
  try {
    const { pdfId } = req.body;
    if (!pdfId) return errorResponse(res, 'pdfId is required', 400);
    const pdfDoc = await PdfDocumentModel.findById(pdfId);
    if (!pdfDoc) return errorResponse(res, 'PDF document not found', 404);

    const jobId = Date.now().toString();
    kitabooFxlJobStore.start(pdfId, jobId);

    KitabooFxlService.processPdfLayoutOnly(jobId, pdfDoc.file_path, pdfId, (progress, currentStep) => {
      kitabooFxlJobStore.updateProgress(jobId, { progressPercentage: progress, currentStep });
    })
      .then((result) => {
        kitabooFxlJobStore.complete(jobId, result.pages);
      })
      .catch((err) => {
        console.error('[KitabooRoute] Layout-only process error:', err);
        kitabooFxlJobStore.fail(jobId, err.message);
      });

    res.status(202).json({
      success: true,
      data: {
        jobId,
        pdfId,
        status: 'IN_PROGRESS',
        progressPercentage: 0,
        currentStep: 'Starting...',
        message: 'Layout-only (classic FXL) started. Poll GET /api/kitaboo/job/' + jobId + ' for progress.'
      }
    });
  } catch (error) {
    console.error('[KitabooRoute] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/process-high-fidelity
 * High-Fidelity PDF→FXL: 3-phase pipeline (Render 300dpi, Extract Coords, Clean Background).
 * Body: { pdfId: number }. Returns jobId; poll GET /api/kitaboo/job/:jobId for progress.
 */
router.post('/process-high-fidelity', async (req, res) => {
  try {
    const { pdfId, zoneLevel, tocEndPage } = req.body;
    if (!pdfId) return errorResponse(res, 'pdfId is required', 400);
    const pdfDoc = await PdfDocumentModel.findById(pdfId);
    if (!pdfDoc) return errorResponse(res, 'PDF document not found', 404);

    console.log(
      `[KitabooFXL] High-Fidelity request: pdfId=${pdfId} file="${pdfDoc.original_file_name || pdfDoc.file_name}" disk=${path.basename(pdfDoc.file_path || '')}`
    );

    const jobId = Date.now().toString();
    kitabooFxlJobStore.start(pdfId, jobId);

    // Hi-Fi always runs glyph extraction; zoneLevel controls Studio zones (word or sentence).
    // tocEndPage (optional): last TOC page number (1-based); when set, pages 1..tocEndPage get rectangle zones (sentence-level only).
    const options = {
      zoneLevel: zoneLevel === 'sentence' ? 'sentence' : 'word',
      ...(tocEndPage != null && tocEndPage !== '' ? { tocEndPage: Number(tocEndPage) } : {})
    };
    KitabooFxlService.processPdfHighFidelity(jobId, pdfDoc.file_path, pdfId, (progress, currentStep) => {
      kitabooFxlJobStore.updateProgress(jobId, { progressPercentage: progress, currentStep });
    }, options)
      .then((result) => {
        kitabooFxlJobStore.complete(jobId, result.pages, result.extractedFonts, 'glyph');
      })
      .catch((err) => {
        console.error('[KitabooRoute] High-Fidelity process error:', err);
        kitabooFxlJobStore.fail(jobId, err.message);
      });

    res.status(202).json({
      success: true,
      data: {
        jobId,
        pdfId,
        status: 'IN_PROGRESS',
        progressPercentage: 0,
        currentStep: 'Starting High-Fidelity Pipeline...',
        message: 'High-Fidelity conversion started. Poll GET /api/kitaboo/job/' + jobId + ' for progress.'
      }
    });
  } catch (error) {
    console.error('[KitabooRoute] Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/split-zones-by-level/:jobId/:pageNumber
 * Body: { syncLevel: 'word' | 'sentence', useAI?: boolean, zones?: Array, selectedIds?: string[] }
 */
router.post('/split-zones-by-level/:jobId/:pageNumber', async (req, res) => {
  try {
    const { jobId, pageNumber } = req.params;
    const { syncLevel, useAI: useAIFromBody, zones: zonesFromClient, selectedIds } = req.body;
    const level = (syncLevel === 'sentence' ? 'sentence' : 'word');
    const useAI = useAIFromBody !== false;
    const result = await KitabooFxlService.splitZonesBySyncLevel(
      jobId,
      parseInt(pageNumber, 10),
      level,
      useAI,
      Array.isArray(zonesFromClient) ? zonesFromClient : undefined,
      Array.isArray(selectedIds) ? selectedIds : undefined
    );
    return successResponse(res, result);
  } catch (error) {
    console.error('[KitabooRoute] Split zones error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/save-zones/:jobId/:pageNumber
 * Save manual zone adjustments for a specific page (job-scoped).
 * If job not in memory (e.g. recovered job), restore from DB so save succeeds.
 */
router.post('/save-zones/:jobId/:pageNumber', async (req, res) => {
  try {
    const { jobId, pageNumber } = req.params;
    const { zones } = req.body;
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) {
        kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
        job = kitabooFxlJobStore.get(jobId);
      }
    }
    if (!job) return errorResponse(res, 'Job not found', 404);
    const pdfId = parseInt(job.pdfId, 10);
    const result = await KitabooFxlService.saveManualZones(jobId, pdfId, parseInt(pageNumber, 10), zones);
    return successResponse(res, result);
  } catch (error) {
    console.error('[KitabooRoute] Save Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/human-audio/:jobId/full
 * Upload one long audio file for all pages (single narration for whole book).
 * Saved as narration.mp3; assembly uses global offset mapping.
 */
router.post('/human-audio/:jobId/full', kitabooSingleBookAudioUpload.single('audio'), async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!req.file) return errorResponse(res, 'No audio file uploaded', 400);
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
      job = kitabooFxlJobStore.get(jobId);
    }
    if (!job) return errorResponse(res, 'Job not found', 404);
    return successResponse(res, {
      jobId,
      path: req.file.path,
      message: 'Single long audio uploaded for all pages (narration.mp3). Export FXL EPUB 3 will use global offset mapping.'
    });
  } catch (error) {
    console.error('[KitabooRoute] Single book audio upload error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/human-audio/:jobId/:pageNumber
 * Upload human-narrated audio for one page (for forced alignment / Kitaboo-style sync).
 */
router.post('/human-audio/:jobId/:pageNumber', kitabooHumanAudioUpload.single('audio'), async (req, res) => {
  try {
    const { jobId, pageNumber } = req.params;
    if (!req.file) return errorResponse(res, 'No audio file uploaded', 400);
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
      job = kitabooFxlJobStore.get(jobId);
    }
    if (!job) return errorResponse(res, 'Job not found', 404);
    return successResponse(res, {
      jobId,
      pageNumber: parseInt(pageNumber, 10),
      path: req.file.path,
      message: `Human narration uploaded for page ${pageNumber}. Use "Export FXL EPUB 3" with human narration to sync.`
    });
  } catch (error) {
    console.error('[KitabooRoute] Human audio upload error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/clean-page/:jobId/:pageNumber
 * Optional: upload a custom clean (text-removed) image for one page. Export uses this
 * instead of auto-cleaned image. Re-running conversion keeps this if cleanup skips existing files.
 */
router.post('/clean-page/:jobId/:pageNumber', kitabooCleanPageUpload.single('image'), async (req, res) => {
  try {
    const { jobId, pageNumber } = req.params;
    if (!req.file) return errorResponse(res, 'No image file uploaded', 400);
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
      job = kitabooFxlJobStore.get(jobId);
    }
    if (!job) return errorResponse(res, 'Job not found', 404);
    return successResponse(res, {
      jobId,
      pageNumber: parseInt(pageNumber, 10),
      path: req.file.path,
      message: `Clean page image uploaded for page ${pageNumber}. Export will use this image.`
    });
  } catch (error) {
    console.error('[KitabooRoute] Clean page upload error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/human-audio/:jobId
 * List which pages have human narration uploaded, and whether single book audio exists.
 */
router.get('/human-audio/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`, 'human_audio');
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      return successResponse(res, { jobId, pages: [], singleBookAudio: false });
    }
    const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
    const singleBookAudio = singleBookNames.some(name => files.includes(name)) ||
      (files.filter(f => /\.(mp3|wav|m4a)$/i.test(f)).length === 1);
    const pages = files
      .filter(f => /^page_(\d+)\.mp3$/i.test(f))
      .map(f => parseInt(f.match(/^page_(\d+)\.mp3$/i)[1], 10))
      .sort((a, b) => a - b);
    return successResponse(res, { jobId, pages, singleBookAudio: !!singleBookAudio });
  } catch (error) {
    console.error('[KitabooRoute] Human audio list error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/publish/:jobId
 * Generate the final FXL EPUB for this job.
 * If job not in memory (e.g. recovered job), restore from DB so publish succeeds.
 * IMPORTANT: zoneLevel is NEVER read from req.body. It is read only from job_metadata.json inside assembleFxlEpub
 * so that glyph vs zone-based layout is determined by how the job was created (word/sentence), not the publish request.
 */
router.post('/publish/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { syncLevel, voice, useWhisperAlignment, classicLayout, renderMode, bodyFontFamily } = req.body;
    if (voice?.name) {
      console.log(`[Kitaboo] Publish requested with TTS voice: ${voice.name} (${voice.ssmlGender || '—'})`);
    }
    if (useWhisperAlignment === true || useWhisperAlignment === 'true' ||
      (useWhisperAlignment == null && process.env.USE_WHISPER_ALIGNMENT === '1')) {
      console.log('[Kitaboo] Publish requested with Whisper alignment (transcription + fuzzy match).');
    }
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) {
        kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
        job = kitabooFxlJobStore.get(jobId);
      }
    }
    if (!job) return errorResponse(res, 'Job not found', 404);
    const pdfId = job.pdfId;

    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    const pdfDoc = await PdfDocumentModel.findById(pdfId);
    if (!pdfDoc) return errorResponse(res, 'PDF document not found', 404);

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const webpDir = path.join(intermediateDir, 'webp');
    const highFiDir = path.join(intermediateDir, 'high_fidelity_render');

    let preserveImportMeta = null;
    try {
      preserveImportMeta = JSON.parse(await fs.readFile(path.join(intermediateDir, 'import_package_meta.json'), 'utf8'));
    } catch (_) { }
    if (!preserveImportMeta?.preserveForPublish) {
      try {
        const { discoverImportPackageMeta } = await import('../services/kitabooFxlPreserveAssemble.js');
        const discovered = await discoverImportPackageMeta(intermediateDir);
        if (discovered?.preserveForPublish) {
          preserveImportMeta = discovered;
          await fs.writeFile(
            path.join(intermediateDir, 'import_package_meta.json'),
            JSON.stringify(discovered, null, 2),
            'utf8'
          ).catch(() => {});
        }
      } catch (_) { /* legacy job without imported_package */ }
    }

    let assetDir = webpDir;
    let isHighFi = false;
    let assetFiles = [];

    if (!preserveImportMeta?.preserveForPublish) {
      try {
        await fs.access(webpDir);
      } catch (e) {
        try {
          await fs.access(highFiDir);
          assetDir = highFiDir;
          isHighFi = true;
        } catch (err) {
          throw new Error(`Asset directory not found for job ${jobId}. Re-run conversion.`);
        }
      }

      const allFiles = await fs.readdir(assetDir);
      const pattern = isHighFi ? /^page_(\d+)(_clean)?\.png$/i : /^page_?(\d+)\.webp$/i;

      const pageToFiles = {};
      for (const f of allFiles) {
        const match = f.match(pattern);
        if (match) {
          const pageNum = parseInt(match[1]);
          if (!pageToFiles[pageNum]) pageToFiles[pageNum] = [];
          pageToFiles[pageNum].push(f);
        }
      }

      assetFiles = Object.keys(pageToFiles)
        .map(Number)
        .sort((a, b) => a - b)
        .map(pageNum => {
          const pageFiles = pageToFiles[pageNum];
          if (isHighFi) {
            const cleanFile = pageFiles.find(f => f.toLowerCase().includes('_clean'));
            if (cleanFile) {
              const pageZones = zonesByPage[pageNum] || [];
              if (KitabooFxlService.shouldUseCleanImage(pageNum, pageZones)) {
                return cleanFile;
              }
            }
            const originalFile = pageFiles.find(f => !f.toLowerCase().includes('_clean'));
            return originalFile || pageFiles[0];
          }
          return pageFiles[0];
        })
        .filter(Boolean);
    }

    const useClassicLayout = classicLayout === true || classicLayout === 'true';
    let pagesData = [];

    // Load zoning dimensions from job_metadata so viewport matches zone coordinate system (fixes "coordinate far away" in Thorium)
    let jobMeta = null;
    if (isHighFi) {
      try {
        const metaPath = path.join(highFiDir, 'job_metadata.json');
        jobMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      } catch (e) {
        // ignore
      }
    }
    const getZoningDimensions = (pageNum) => {
      const p = jobMeta?.pagesMetadata?.find(m => m.pageNumber === pageNum);
      return p?.dimensions ? { width: p.dimensions.width, height: p.dimensions.height } : null;
    };

    if (useClassicLayout) {
      const layoutPath = path.join(intermediateDir, 'layout_fragments.json');
      let layoutJson;
      try {
        layoutJson = JSON.parse(await fs.readFile(layoutPath, 'utf8'));
      } catch (e) {
        throw new Error('Classic layout requested but layout_fragments.json not found. Run layout-only process (POST /api/kitaboo/process-layout-only) first.');
      }
      const layoutByPage = Object.fromEntries((layoutJson.pages || []).map(p => [p.pageNumber, p]));
      for (const file of assetFiles) {
        const match = file.match(/page_?(\d+)/);
        const pageNum = parseInt(match?.[1] || "0");
        if (pageNum === 0) continue;
        const metadata = await sharp(path.join(assetDir, file)).metadata();
        const layoutPage = layoutByPage[pageNum] || {};
        const dims = getZoningDimensions(pageNum) || { width: metadata.width, height: metadata.height };
        pagesData.push({
          pageNumber: pageNum,
          imagePath: path.join(assetDir, file),
          dimensions: { width: dims.width, height: dims.height },
          zones: [],
          layoutFragments: layoutPage.fragments || []
        });
      }
    } else if (preserveImportMeta?.preserveForPublish) {
      const job = kitabooFxlJobStore.get(jobId);
      const jobPages = job?.pages || [];
      for (const row of preserveImportMeta.spine || []) {
        const pageNum = row.pageNumber;
        let zones = zonesByPage[pageNum] || [];
        zones = zones.map(z => {
          if (!z.id || typeof z.id !== 'string') return z;
          const m = z.id.match(/^p(\d+)_/);
          const idPageNum = m ? parseInt(m[1], 10) : null;
          if (idPageNum && idPageNum !== pageNum) {
            const correctedId = z.id.replace(/^p\d+_/, `p${pageNum}_`);
            return { ...z, id: correctedId };
          }
          return z;
        });
        zones = KitabooFxlService.normalizeZoneIdsForPage(pageNum, zones);
        const jobPage = jobPages.find(p => p.pageNumber === pageNum);
        pagesData.push({
          pageNumber: pageNum,
          imagePath: '',
          dimensions: {
            width: preserveImportMeta.defaultViewportWidth || 1200,
            height: preserveImportMeta.defaultViewportHeight || 1600
          },
          pointsDimensions: jobPage?.pointsDimensions || null,
          zones
        });
      }
    } else {
      const job = kitabooFxlJobStore.get(jobId);
      const jobPages = job?.pages || [];

      for (const file of assetFiles) {
        const match = file.match(/page_?(\d+)/);
        const pageNum = parseInt(match?.[1] || "0");
        if (pageNum === 0) continue;

        const jobPage = jobPages.find(p => p.pageNumber === pageNum);

        const metadata = await sharp(path.join(assetDir, file)).metadata();
        const dims = getZoningDimensions(pageNum) || { width: metadata.width, height: metadata.height };
        let zones = zonesByPage[pageNum] || [];
        // Correct zone IDs if they're wrong for this page (e.g. p1_z0 on page 2)
        zones = zones.map(z => {
          if (!z.id || typeof z.id !== 'string') return z;
          const m = z.id.match(/^p(\d+)_/);
          const idPageNum = m ? parseInt(m[1], 10) : null;
          if (idPageNum && idPageNum !== pageNum) {
            const correctedId = z.id.replace(/^p\d+_/, `p${pageNum}_`);
            return { ...z, id: correctedId };
          }
          return z;
        });
        // Normalize IDs and order by readingOrder so EPUB/SMIL match Studio (including manual reading-order edits)
        zones = KitabooFxlService.normalizeZoneIdsForPage(pageNum, zones);
        pagesData.push({
          pageNumber: pageNum,
          imagePath: path.join(assetDir, file),
          dimensions: { width: dims.width, height: dims.height },
          pointsDimensions: jobPage?.pointsDimensions || null,
          zones
        });
      }
    }

    // When frontend doesn't send useWhisperAlignment, use .env USE_WHISPER_ALIGNMENT
    const useWhisper = useWhisperAlignment === true || useWhisperAlignment === 'true' ||
      (useWhisperAlignment == null && process.env.USE_WHISPER_ALIGNMENT === '1');

    // Use in-memory extractedFonts; if missing (e.g. job restored from DB), load from job_metadata.json so font pipeline works
    let extractedFontsToUse = job?.extractedFonts || [];
    if (extractedFontsToUse.length === 0 && isHighFi) {
      try {
        const metaPath = path.join(highFiDir, 'job_metadata.json');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        extractedFontsToUse = meta.extractedFonts || [];
        if (extractedFontsToUse.length > 0) console.log(`[KitabooRoute] Restored font list for job ${jobId} from job_metadata.json (${extractedFontsToUse.length} fonts)`);
      } catch (e) {
        // no job_metadata or no extractedFonts
      }
    }

    const epubPath = await KitabooFxlService.assembleFxlEpub(jobId, pagesData, {
      syncLevel: syncLevel || 'word',
      voice: voice || undefined,
      useWhisperAlignment: useWhisper,
      classicLayout: useClassicLayout,
      extractedFonts: extractedFontsToUse,
      renderMode: renderMode === 'absolute-html' ? 'absolute-html' : undefined,
      fxlBodyFontFamily: typeof bodyFontFamily === 'string' && bodyFontFamily.trim() ? bodyFontFamily.trim() : undefined
    });

    return successResponse(res, {
      epubPath: path.basename(epubPath),
      fullPath: epubPath,
      downloadUrl: `/api/kitaboo/download/${jobId}`,
      syncLevel: syncLevel || 'word'
    });
  } catch (error) {
    console.error('[KitabooRoute] Publish Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/download/:jobId
 * Stream the FXL EPUB file for direct download (same path as publish output).
 */
router.get('/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const outputDir = path.join(getEpubOutputDir(), `fxl_${jobId}`);
    const epubFileName = `fxl_${jobId}.epub`;
    const epubPath = path.join(outputDir, epubFileName);
    try {
      await fs.access(epubPath);
    } catch {
      return errorResponse(res, 'EPUB not found. Export FXL EPUB 3 first.', 404);
    }
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${epubFileName}"`);
    res.sendFile(path.resolve(epubPath));
  } catch (error) {
    console.error('[KitabooRoute] Download Error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/debug-smil/:jobId
 * Extract and return SMIL file contents from the generated EPUB for drift debugging.
 * Query: ?page=1 (default 1) to pick which page's SMIL.
 */
router.get('/debug-smil/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const pageNum = parseInt(req.query.page || '1', 10);
    const outputDir = path.join(getEpubOutputDir(), `fxl_${jobId}`);
    const epubPath = path.join(outputDir, `fxl_${jobId}.epub`);
    try {
      await fs.access(epubPath);
    } catch {
      return errorResponse(res, 'EPUB not found. Publish FXL EPUB first.', 404);
    }
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await fs.readFile(epubPath));
    const smilNames = Object.keys(zip.files).filter(n => n.endsWith('.smil'));
    const targetName = smilNames.find(n => n.includes(`page${pageNum}.smil`));
    const name = targetName || smilNames.sort()[pageNum - 1];
    if (!name) {
      return successResponse(res, { smilFiles: smilNames, message: 'No SMIL files in EPUB' });
    }
    const entry = zip.files[name];
    const content = await entry.async('string');
    const audioRefs = [...content.matchAll(/clipBegin="([^"]+)"\s+clipEnd="([^"]+)"/g)];
    return successResponse(res, {
      fileName: name,
      content,
      clipCount: audioRefs.length,
      clips: audioRefs.slice(0, 20).map((m, i) => ({ index: i + 1, clipBegin: m[1], clipEnd: m[2] })),
      totalDuration: content.match(/dtb:totalElapsedTime"\s+content="([^"]+)"/)?.[1]
    });
  } catch (error) {
    console.error('[KitabooRoute] Debug SMIL error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/epub/:jobId/check
 * Validate generated FXL EPUB structure (mimetype, container, OPF, pages, SMIL, audio).
 */
router.get('/epub/:jobId/check', async (req, res) => {
  try {
    const { jobId } = req.params;
    const outputDir = path.join(getEpubOutputDir(), `fxl_${jobId}`);
    const epubPath = path.join(outputDir, `fxl_${jobId}.epub`);
    try {
      await fs.access(epubPath);
    } catch {
      return errorResponse(res, 'EPUB not found. Export FXL EPUB 3 first.', 404);
    }
    const result = await KitabooFxlService.checkGeneratedEpub(epubPath);
    return successResponse(res, { jobId, path: epubPath, ...result });
  } catch (error) {
    console.error('[KitabooRoute] EPUB check error:', error);
    return errorResponse(res, error.message, 500);
  }
});

// ---------------------------------------------------------------------------
// FXL Sync Studio (same UX as reflowable Sync Studio, for human narration)
// ---------------------------------------------------------------------------

/**
 * GET /api/kitaboo/sync-studio/:jobId
 * Load FXL Sync Studio data: pages with zones, audio URL, and alignment (if any).
 */
router.get('/sync-studio/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
      job = kitabooFxlJobStore.get(jobId);
    }
    if (!job) return errorResponse(res, 'Job not found', 404);

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const humanAudioDir = path.join(intermediateDir, 'human_audio');
    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    const { pages, zoneIdMapByPage } = KitabooFxlService.buildSyncStudioPagesAndZoneMaps(zonesByPage);

    let audioUrl = null;
    let audioDuration = 0;
    const perPageAudioUrls = {};
    try {
      const files = await fs.readdir(humanAudioDir);
      const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
      const found = singleBookNames.find(n => files.includes(n)) || (files.filter(f => /\.(mp3|wav|m4a)$/i.test(f)).length === 1 ? files.find(f => /\.(mp3|wav|m4a)$/i.test(f)) : null);
      if (found) {
        audioUrl = `/api/kitaboo/sync-studio/${jobId}/audio`;
        try {
          const audioPath = path.join(humanAudioDir, found);
          const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`, { encoding: 'utf8', timeout: 5000 }).trim();
          audioDuration = parseFloat(out) || 0;
        } catch (_) { }
      }
      // Per-page audio: page_1.mp3, page_2.mp3, etc. (so waveform can show the correct file per page)
      for (const f of files) {
        const match = f.match(/^page_(\d+)\.(mp3|wav|m4a)$/i);
        if (match) {
          const pageNum = parseInt(match[1], 10);
          perPageAudioUrls[pageNum] = `/api/kitaboo/sync-studio/${jobId}/audio/page/${pageNum}`;
        }
      }
      // Per-page-only jobs: reader and Play button need a default URL (full-book names above were absent).
      if (!audioUrl && Object.keys(perPageAudioUrls).length > 0) {
        const pageNums = Object.keys(perPageAudioUrls)
          .map((k) => parseInt(k, 10))
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        const first = pageNums[0];
        audioUrl = `/api/kitaboo/sync-studio/${jobId}/audio/page/${first}`;
        try {
          const ext = ['.mp3', '.wav', '.m4a'].find((e) => files.includes(`page_${first}${e}`));
          if (ext) {
            const audioPath = path.join(humanAudioDir, `page_${first}${ext}`);
            const out = execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
              { encoding: 'utf8', timeout: 5000 }
            ).trim();
            audioDuration = parseFloat(out) || 0;
          }
        } catch (_) { /* keep 0 */ }
      }
    } catch (_) { }

    let alignment = [];
    try {
      const alignmentPath = path.join(intermediateDir, 'alignment.json');
      const raw = await fs.readFile(alignmentPath, 'utf8');
      const data = JSON.parse(raw);
      alignment = (data.segments || []).slice();
      alignment = KitabooFxlService.remapAlignmentSegmentsWithMaps(alignment, pages, zoneIdMapByPage);

      // Show segments in audio order so list matches playback (first in list = first in audio)
      alignment.sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0) || String(a.id || '').localeCompare(String(b.id || '')));
    } catch (_) { }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return successResponse(res, { jobId, pages, audioUrl, audioDuration, perPageAudioUrls, alignment });
  } catch (error) {
    console.error('[KitabooRoute] Sync studio load error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/sync-studio/:jobId/audio/page/:pageNumber
 * Stream per-page narration audio (page_N.mp3) for FXL Sync Studio.
 */
router.get('/sync-studio/:jobId/audio/page/:pageNumber', async (req, res) => {
  try {
    const { jobId, pageNumber } = req.params;
    const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`, 'human_audio');
    const files = await fs.readdir(dir).catch(() => []);
    let file = null;
    for (const ext of ['.mp3', '.wav', '.m4a']) {
      const name = `page_${pageNumber}${ext}`;
      if (files.includes(name)) {
        file = name;
        break;
      }
    }
    if (!file) return errorResponse(res, `No audio found for page ${pageNumber}`, 404);
    const filePath = path.join(dir, file);
    await fs.access(filePath);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    res.setHeader('Content-Type', mime);
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') return errorResponse(res, 'Audio not found', 404);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/kitaboo/sync-studio/:jobId/audio
 * Stream the single-book narration audio for FXL Sync Studio.
 */
router.get('/sync-studio/:jobId/audio', async (req, res) => {
  try {
    const { jobId } = req.params;
    const dir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`, 'human_audio');
    const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
    let file = null;
    const files = await fs.readdir(dir).catch(() => []);
    for (const name of singleBookNames) {
      if (files.includes(name)) { file = name; break; }
    }
    if (!file && files.filter(f => /\.(mp3|wav|m4a)$/i.test(f)).length === 1) {
      file = files.find(f => /\.(mp3|wav|m4a)$/i.test(f));
    }
    if (!file) return errorResponse(res, 'No narration audio found. Upload narration.mp3 in Zoning Studio.', 404);
    const filePath = path.join(dir, file);
    await fs.access(filePath);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    res.setHeader('Content-Type', mime);
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') return errorResponse(res, 'Audio not found', 404);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/kitaboo/sync-studio/:jobId/align
 * Run global alignment (Whisper/Aeneas) and save alignment.json. Returns segments.
 */
router.post('/sync-studio/:jobId/align', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { skipPages, pageBoundaries, usePerPageAudio } = req.body || {};
    const options = {};
    if (Array.isArray(skipPages) && skipPages.length > 0) options.skipPages = skipPages;
    if (Array.isArray(pageBoundaries) && pageBoundaries.length > 0) options.manualPageBoundaries = pageBoundaries;
    if (usePerPageAudio === true || usePerPageAudio === 'true') options.usePerPageAudio = true;
    const result = await KitabooFxlService.runGlobalAlignmentForSyncStudio(jobId, options);
    return successResponse(res, result);
  } catch (error) {
    console.error('[KitabooRoute] Sync studio align error:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * PUT /api/kitaboo/sync-studio/:jobId
 * Save alignment (segments with id, startTime, endTime). Writes alignment.json.
 * Uses same job lookup and path as GET so read/write are consistent.
 */
router.put('/sync-studio/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { segments } = req.body || {};
    if (!Array.isArray(segments)) return errorResponse(res, 'Body must include segments array', 400);

    let job = kitabooFxlJobStore.get(jobId);
    if (!job) {
      const fromDb = await KitabooZoneModel.getJobByJobId(jobId);
      if (fromDb) kitabooFxlJobStore.restore(jobId, fromDb.pdfId);
      job = kitabooFxlJobStore.get(jobId);
    }
    if (!job) return errorResponse(res, 'Job not found', 404);

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    await fs.mkdir(intermediateDir, { recursive: true });
    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    const { pages, zoneIdMapByPage } = KitabooFxlService.buildSyncStudioPagesAndZoneMaps(zonesByPage);
    const remapped = KitabooFxlService.remapAlignmentSegmentsWithMaps(segments, pages, zoneIdMapByPage);
    const normalized = remapped.map((s) => ({
      id: s.id,
      startTime: Number(s.startTime) || 0,
      endTime: Number(s.endTime) || 0
    }));
    const alignmentPath = path.join(intermediateDir, 'alignment.json');
    await fs.writeFile(
      alignmentPath,
      JSON.stringify({ segments: normalized }, null, 2),
      'utf8'
    );
    return successResponse(res, { segments: normalized });
  } catch (error) {
    console.error('[KitabooRoute] Sync studio save error:', error);
    return errorResponse(res, error.message, 500);
  }
});

export default router;

