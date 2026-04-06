import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import puppeteer from 'puppeteer';
import AdmZip from 'adm-zip';
import mimeTypes from 'mime-types';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import { RemedyEngine } from '../utils/RemedyEngine.js';
import { AiRemediationService } from '../services/AiRemediationService.js';
import { fileURLToPath } from 'url';

const router = express.Router();

// Build absolute paths from this file location so PM2 `cwd` doesn't break them.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');
// Ace uses Electron/Chromium. On headless Linux servers it typically needs a DISPLAY.
// Common setup is Xvfb on :99, but we allow overriding with ACE_DISPLAY.
const aceDisplay = process.env.ACE_DISPLAY || process.env.DISPLAY || ':99';

// Root folders for uploaded EPUBs and Ace reports
const uploadsRoot = path.resolve(backendRoot, 'uploads', 'epub_accessibility');
const reportsRoot = path.resolve(backendRoot, 'reports');

// Ensure base directories exist
fs.ensureDirSync(uploadsRoot);
fs.ensureDirSync(reportsRoot);

// Multer configuration: only accept .epub files and store on disk
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.epub';
    const id = uuidv4();
    cb(null, `${id}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_EPUB_SIZE || '52428800', 10), // 50MB default
  },
  fileFilter: (_req, file, cb) => {
    const isEpub =
      file.mimetype === 'application/epub+zip' ||
      file.originalname.toLowerCase().endsWith('.epub');

    if (!isEpub) {
      return cb(new Error('Only .epub files are allowed'));
    }
    cb(null, true);
  },
});

// Helper: derive a simple severity string from an Ace violation entry
const getSeverity = (violation) => {
  if (!violation) return 'unknown';

  if (typeof violation.severity === 'string') {
    return violation.severity.toLowerCase();
  }

  if (violation.impact) {
    return String(violation.impact).toLowerCase();
  }

  // Fallback: look for nested result fields similar to axe format
  const maybeResult = violation.result || violation['earl:result'];
  if (maybeResult && typeof maybeResult.severity === 'string') {
    return maybeResult.severity.toLowerCase();
  }

  return 'unknown';
};

const toPosixPath = (p) => String(p || '').replace(/\\/g, '/');

const getAceCommand = (reportDir, epubPath) => {
  const aceBinName = process.platform === 'win32' ? 'ace.cmd' : 'ace';
  const localAceBin = path.join(backendRoot, 'node_modules', '.bin', aceBinName);

  // Prefer local `ace` binary when present, otherwise fall back to npx.
  if (fs.existsSync(localAceBin)) {
    return `"${localAceBin}" --no-sandbox -o "${reportDir}" "${epubPath}"`;
  }

  return `npx @daisy/ace --no-sandbox -o "${reportDir}" "${epubPath}"`;
};

const getAceExecCommand = (reportDir, epubPath) => {
  const base = getAceCommand(reportDir, epubPath);
  return process.platform === 'win32' ? base : `DISPLAY=${aceDisplay} ${base}`;
};

const getAceExecEnv = () => (
  process.platform === 'win32'
    ? { ...process.env }
    : { ...process.env, DISPLAY: aceDisplay }
);

const extractSeriousViolations = (reportJson) => {
  const out = [];
  const topAssertions = Array.isArray(reportJson?.assertions) ? reportJson.assertions : [];

  for (const top of topAssertions) {
    const subjectUrl = top?.['earl:testSubject']?.url || top?.testSubject?.url || '';
    const filePath = toPosixPath(subjectUrl).replace(/^\/+/, '');
    const inner = Array.isArray(top?.assertions) ? top.assertions : [];

    for (const assertion of inner) {
      const result = assertion?.['earl:result'] || assertion?.result || {};
      const test = assertion?.['earl:test'] || assertion?.test || {};
      const outcome = result?.['earl:outcome'] || result?.outcome;
      if (outcome !== 'fail') continue;

      const impact = String(test?.['earl:impact'] || test?.impact || '').toLowerCase();
      if (impact !== 'serious' && impact !== 'severe') continue;

      const title = test?.['dct:title'] || test?.title || 'unknown';
      const description = result?.['dct:description'] || result?.description || '';
      const helpDescription = test?.help?.['dct:description'] || test?.help?.description || '';
      const offendingSnippet = result?.html || '';

      out.push({
        id: `${filePath}::${title}::${out.length + 1}`,
        filePath,
        title,
        description,
        helpDescription,
        severity: impact || 'serious',
        offendingSnippet
      });
    }
  }

  return out;
};

// Extract ALL violations (all severities) — used by the wizard UI.
const extractAllViolations = (reportJson) => {
  const out = [];
  const topAssertions = Array.isArray(reportJson?.assertions) ? reportJson.assertions : [];

  for (const top of topAssertions) {
    const subjectUrl = top?.['earl:testSubject']?.url || top?.testSubject?.url || '';
    const filePath = toPosixPath(subjectUrl).replace(/^\/+/, '');
    const inner = Array.isArray(top?.assertions) ? top.assertions : [];

    for (const assertion of inner) {
      const result = assertion?.['earl:result'] || assertion?.result || {};
      const test = assertion?.['earl:test'] || assertion?.test || {};
      const outcome = result?.['earl:outcome'] || result?.outcome;
      if (outcome !== 'fail') continue;

      const impact = String(test?.['earl:impact'] || test?.impact || 'minor').toLowerCase();
      const title = test?.['dct:title'] || test?.title || 'unknown';
      const description = result?.['dct:description'] || result?.description || '';
      const helpDescription = test?.help?.['dct:description'] || test?.help?.description || '';
      const offendingSnippet = result?.html || '';

      out.push({
        id: `${filePath}::${title}::${out.length + 1}`,
        filePath,
        title,
        description,
        helpDescription,
        severity: ['critical', 'serious', 'moderate', 'minor'].includes(impact) ? impact : 'minor',
        offendingSnippet
      });
    }
  }

  return out;
};

// POST /api/accessibility/check
router.post('/check', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return badRequestResponse(res, 'EPUB file is required');
    }

    const epubPath = req.file.path;
    console.error('[Accessibility] process.cwd():', process.cwd());
    console.error('[Accessibility] uploadsRoot:', uploadsRoot);
    console.error('[Accessibility] reportsRoot:', reportsRoot);
    console.error('[Accessibility] epubPath:', epubPath);
    const jobId = uuidv4();
    const reportDir = path.join(reportsRoot, jobId);

    await fs.ensureDir(reportDir);

    // Persist epubPath so later remediation/re-validation requests can re-run Ace.
    const epubPathFile = path.join(reportDir, 'epubPath.json');
    await fs.writeJson(epubPathFile, { epubPath });

    // Preflight: apply best-effort malformed EPUB normalization before the first Ace run.
    // This reduces cases where Ace can't load one or more content documents.
    const preflightEngine = new RemedyEngine();
    try {
      const malformedResult = await preflightEngine.applyMalformedFixes(epubPath);
      if (malformedResult?.updatedEntries > 0) {
        console.log(
          `[Accessibility] Preflight malformed fixes applied (${malformedResult.updatedEntries}) for job ${jobId}`
        );
      }
    } catch (e) {
      console.error('[Accessibility] Preflight malformed fixes failed:', e?.message || e);
    }

    // Run Ace CLI on the uploaded file as-is.
    // Remediation is intentionally deferred until the user explicitly applies fixes.
    let reportJson;
    try {
      // Ace uses Electron/Chromium internally. We run it headless via Xvfb (DISPLAY)
      // and pass --no-sandbox to avoid Electron hard-crash in restricted environments.
      const cmd = getAceExecCommand(reportDir, epubPath);

      reportJson = await new Promise((resolve, reject) => {
        exec(
          cmd,
          {
            cwd: backendRoot,
            env: getAceExecEnv(),
            maxBuffer: 10 * 1024 * 1024, // 10 MB buffer for stdout/stderr
          },
          async (error, _stdout, stderr) => {
            if (error) {
              console.error('[Ace CLI] Error running accessibility check:', error);
              if (stderr) {
                console.error('[Ace CLI] stderr:', stderr);
              }
              return reject(
                new Error(
                  'Failed to analyze EPUB accessibility. The file may be corrupt or unsupported.'
                )
              );
            }

            try {
              const reportJsonPath = path.join(reportDir, 'report.json');
              if (!(await fs.pathExists(reportJsonPath))) {
                return reject(
                  new Error('Accessibility report could not be generated by Ace CLI.')
                );
              }

              const raw = await fs.readFile(reportJsonPath, 'utf8');
              const json = JSON.parse(raw);
              resolve(json);
            } catch (readErr) {
              console.error('[Ace CLI] Failed to read report.json:', readErr);
              reject(
                new Error(
                  'Accessibility report could not be read after processing.'
                )
              );
            }
          }
        );
      });
    } catch (aceError) {
      console.error('[Ace] Accessibility check failed:', aceError);
      return errorResponse(
        res,
        aceError.message ||
          'Failed to analyze EPUB accessibility. The file may be corrupt or unsupported.',
        500
      );
    }

    if (!reportJson) {
      return errorResponse(
        res,
        'Accessibility report could not be generated.',
        500
      );
    }

    // Extract violations and metadata from Ace EARL report
    const earlAssertions = Array.isArray(reportJson.assertions)
      ? reportJson.assertions
      : [];

    const flattenedViolations = [];

    for (const top of earlAssertions) {
      const inner = Array.isArray(top.assertions) ? top.assertions : [];
      for (const assertion of inner) {
        const outcome =
          assertion['earl:result']?.['earl:outcome'] || assertion.result?.outcome;
        if (outcome !== 'fail') continue;

        const test = assertion['earl:test'] || assertion.test || {};
        const impact =
          test['earl:impact'] || test.impact || test.severity || 'unknown';

        flattenedViolations.push({
          severity: String(impact).toLowerCase(),
        });
      }
    }

    const summary = {
      totalViolations: flattenedViolations.length,
      bySeverity: {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
      },
    };

    for (const v of flattenedViolations) {
      const sev = getSeverity(v);
      if (sev === 'critical') summary.bySeverity.critical += 1;
      else if (sev === 'serious' || sev === 'severe') summary.bySeverity.serious += 1;
      else if (sev === 'moderate') summary.bySeverity.moderate += 1;
      else summary.bySeverity.minor += 1;
    }

    const metadata =
      reportJson.metadata ||
      reportJson.publication ||
      reportJson.pub ||
      {};

    const reportUrl = `/backend/reports/${jobId}/report.html`;

    // Schedule cleanup of the uploaded EPUB and generated report directory
    const cleanupDelayMs = 2 * 60 * 60 * 1000; // 2 hours (remediation UI re-runs Ace)
    setTimeout(async () => {
      try {
        await fs.remove(epubPath);
        await fs.remove(reportDir);
      } catch (cleanupError) {
        console.error(
          `[Accessibility Cleanup] Failed to remove temporary files for job ${jobId}:`,
          cleanupError
        );
      }
    }, cleanupDelayMs).unref?.();

    return successResponse(res, {
      jobId,
      summary,
      metadata,
      reportUrl,
    });
  } catch (error) {
    console.error('[Accessibility] Unexpected error in /api/accessibility/check:', error);
    return errorResponse(
      res,
      'An unexpected error occurred while processing the accessibility check.',
      500
    );
  }
});

// GET /api/accessibility/report/:jobId/pdf - Download PDF version of the Ace HTML report
router.get('/report/:jobId/pdf', async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportDir = path.join(reportsRoot, jobId);
    const htmlPath = path.join(reportDir, 'report.html');

    if (!(await fs.pathExists(htmlPath))) {
      return errorResponse(res, 'Report not found or has expired.', 404);
    }

    const pdfPath = path.join(reportDir, 'report.pdf');

    // If we've already generated the PDF for this job, reuse it
    if (!(await fs.pathExists(pdfPath))) {
      const htmlUrl = `file://${htmlPath.replace(/\\/g, '/')}`;

      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      try {
        const page = await browser.newPage();
        await page.goto(htmlUrl, { waitUntil: 'networkidle0' });

        // Expand all tabs and table pages so the PDF captures everything
        await page.evaluate(() => {
          try {
            // Show all tab panes (Violations, Metadata, Outlines, Images)
            const tabPanes = document.querySelectorAll('.tab-pane');
            tabPanes.forEach((pane) => {
              // Remove Bootstrap's "fade" / "show" handling and force visible
              pane.classList.add('active', 'show');
              pane.style.display = 'block';
            });

            // If DataTables is available, show all rows on each table
            // eslint-disable-next-line no-undef
            if (window.$ && window.$.fn && window.$.fn.dataTable) {
              // eslint-disable-next-line no-undef
              window.$('.dataTable').each(function () {
                // eslint-disable-next-line no-undef
                const table = window.$(this).DataTable();
                table.page.len(-1).draw();
              });
            }

            // Improve PDF readability: wrap long text in tables (e.g. Location, Role)
            const style = document.createElement('style');
            style.textContent = `
              table {
                table-layout: auto !important;
              }
              table td, table th {
                word-break: break-all;
                white-space: normal !important;
                font-size: 10px;
              }
              .table-responsive {
                overflow: visible !important;
              }
            `;
            document.head.appendChild(style);
          } catch (e) {
            // If anything fails, just fall back to the default view
            // so PDF generation still succeeds.
            // eslint-disable-next-line no-console
            console.warn('Failed to expand Ace report before PDF export:', e);
          }
        });

        // Simple delay to allow layout to settle before printing
        await new Promise((resolve) => setTimeout(resolve, 500));

        await page.pdf({
          path: pdfPath,
          format: 'A4',
          landscape: true,
          scale: 0.9,
          printBackground: true,
          preferCSSPageSize: true,
        });
      } finally {
        await browser.close();
      }
    }

    const fileName = `ace-accessibility-report-${jobId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const buffer = await fs.readFile(pdfPath);
    return res.send(buffer);
  } catch (error) {
    console.error('[Accessibility] Failed to generate/download PDF report:', error);
    return errorResponse(
      res,
      'Failed to generate PDF version of the accessibility report.',
      500
    );
  }
});

// GET /api/accessibility/report/:jobId/json - Ace report data for the remediation UI
router.get('/report/:jobId/json', async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportDir = path.join(reportsRoot, jobId);
    const reportJsonPath = path.join(reportDir, 'report.json');

    if (!(await fs.pathExists(reportJsonPath))) {
      return errorResponse(res, 'Report not found or has expired.', 404);
    }

    const raw = await fs.readFile(reportJsonPath, 'utf8');
    const reportJson = JSON.parse(raw);

    const wizardData = {
      metadata: reportJson.metadata || reportJson.publication || {},
      outlines: reportJson.outlines || {},
      data: reportJson.data || {}
    };

    // Keep response size reasonable: only return the parts the UI needs.
    const images = Array.isArray(wizardData.data.images) ? wizardData.data.images : [];
    const cleanedImages = images.map((img) => ({
      src: img.src || null,
      alt: typeof img.alt === 'string' ? img.alt : img.alt ?? null,
      html: img.html || null,
      role: img.role || null,
      location: img.location || null
    }));
    const seriousViolations = extractSeriousViolations(reportJson);
    const allViolations = extractAllViolations(reportJson);

    return successResponse(res, {
      jobId,
      report: {
        outlines: wizardData.outlines || {},
        data: {
          images: cleanedImages
        },
        seriousViolations,
        allViolations
      }
    });
  } catch (error) {
    console.error('[Accessibility] Failed to load Ace report JSON:', error);
    return errorResponse(res, 'Failed to load report JSON.', 500);
  }
});

// GET /api/accessibility/:jobId/image?src=... - serve an image inside the EPUB
router.get('/:jobId/image', async (req, res) => {
  try {
    const { jobId } = req.params;
    const src = req.query.src;
    if (!src || typeof src !== 'string') {
      return badRequestResponse(res, '`src` query parameter is required');
    }

    const reportDir = path.join(reportsRoot, jobId);
    const epubPathFile = path.join(reportDir, 'epubPath.json');
    if (!(await fs.pathExists(epubPathFile))) {
      return errorResponse(res, 'EPUB not found for this job.', 404);
    }

    const { epubPath } = await fs.readJson(epubPathFile);
    if (!epubPath || !(await fs.pathExists(epubPath))) {
      return errorResponse(res, 'EPUB not found on disk.', 404);
    }

    const zip = new AdmZip(epubPath);
    const srcNorm = src.replace(/\\/g, '/').replace(/^\.\//, '');
    const srcBase = path.posix.basename(srcNorm);

    const entry =
      zip.getEntry(srcNorm) ||
      zip.getEntry(`OEBPS/${srcBase}`) ||
      zip
        .getEntries()
        .filter((e) => !e.isDirectory)
        .find((e) => path.posix.basename(e.entryName) === srcBase) ||
      null;

    if (!entry) {
      return errorResponse(res, 'Image not found in EPUB.', 404);
    }

    const buffer = zip.readFile(entry.entryName);
    const mime = mimeTypes.lookup(srcBase) || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    return res.send(buffer);
  } catch (error) {
    console.error('[Accessibility] Failed to serve EPUB image:', error);
    return errorResponse(res, 'Failed to serve image.', 500);
  }
});

// GET /api/accessibility/:jobId/download-epub - download remediated EPUB for this job
router.get('/:jobId/download-epub', async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportDir = path.join(reportsRoot, jobId);
    const epubPathFile = path.join(reportDir, 'epubPath.json');
    if (!(await fs.pathExists(epubPathFile))) {
      return errorResponse(res, 'EPUB not found for this job.', 404);
    }

    const { epubPath } = await fs.readJson(epubPathFile);
    if (!epubPath || !(await fs.pathExists(epubPath))) {
      return errorResponse(res, 'EPUB not found on disk.', 404);
    }

    const safeBase = path.basename(epubPath, path.extname(epubPath));
    const downloadName = `${safeBase}_remediated.epub`;
    return res.download(epubPath, downloadName);
  } catch (error) {
    console.error('[Accessibility] Failed to download remediated EPUB:', error);
    return errorResponse(res, 'Failed to download remediated EPUB.', 500);
  }
});

// POST /api/accessibility/:jobId/remediate - apply user fixes + re-run Ace
router.post('/:jobId/remediate', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { imageAltUpdates, headingLevelUpdates, approvedCodeRepairs } = req.body || {};

    const reportDir = path.join(reportsRoot, jobId);
    const epubPathFile = path.join(reportDir, 'epubPath.json');
    if (!(await fs.pathExists(epubPathFile))) {
      return errorResponse(res, 'EPUB not found for this job.', 404);
    }

    const { epubPath } = await fs.readJson(epubPathFile);
    if (!epubPath || !(await fs.pathExists(epubPath))) {
      return errorResponse(res, 'EPUB not found on disk.', 404);
    }

    const engine = new RemedyEngine();

    // Normalize malformed EPUB documents before applying semantic/global fixes.
    // This reduces cases where Ace fails to load certain content documents.
    try {
      const malformedResult = await engine.applyMalformedFixes(epubPath);
      if (malformedResult?.updatedEntries > 0) {
        console.log(`[Accessibility] Malformed fixes applied (${malformedResult.updatedEntries}) for job ${jobId}`);
      }
    } catch (e) {
      console.error('[Accessibility] Malformed fixes failed (pre-remediation):', e?.message || e);
    }

    // Ensure global template fixes are present before applying user edits.
    await engine.applyGlobalFixes(epubPath);

    await engine.applyImageAltFixes(epubPath, imageAltUpdates);
    await engine.applyHeadingOrderFixes(epubPath, headingLevelUpdates);
    await engine.applyApprovedCodeRepairs(epubPath, approvedCodeRepairs);

    // Clear report dir (keep epubPath.json).
    const epubPathData = { epubPath };
    await fs.emptyDir(reportDir);
    await fs.writeJson(epubPathFile, epubPathData);

    // Re-run Ace on the updated EPUB.
    // Ace uses Electron/Chromium internally; ensure it can run in restricted environments.
    const cmd = getAceExecCommand(reportDir, epubPath);
    let aceFailed = false;
    let aceErrorMessage = '';

    try {
      await new Promise((resolve, reject) => {
        exec(
          cmd,
          {
            cwd: backendRoot,
            env: getAceExecEnv(),
            maxBuffer: 10 * 1024 * 1024
          },
          (error, _stdout, stderr) => {
            if (error) {
              console.error('[Ace CLI] Error running accessibility check:', error);
              if (stderr) console.error('[Ace CLI] stderr:', stderr);
              aceErrorMessage = (stderr || error.message || '')
                .split('\n')
                .find((line) => line.includes('did-fail-load') || line.includes('Failed to check'))
                || error.message
                || 'Ace could not analyze the EPUB.';
              return reject(new Error(aceErrorMessage));
            }
            return resolve();
          }
        );
      });
    } catch (aceErr) {
      aceFailed = true;
      aceErrorMessage = aceErr.message || 'Re-validation (Ace) failed.';
      console.error('[Accessibility] Ace re-run failed after applying fixes:', aceErr.message);
    }

    const reportJsonPath = path.join(reportDir, 'report.json');
    if (aceFailed || !(await fs.pathExists(reportJsonPath))) {
      // Fixes were applied; only re-validation failed. Return success with a flag so the UI can offer "Run check again".
      return successResponse(res, {
        jobId,
        fixesApplied: true,
        revalidateFailed: true,
        revalidateError: aceErrorMessage || 'Ace could not generate a new report (e.g. a content page failed to load). Your fixes were saved to the EPUB. Use "Run check again" below to re-validate without re-uploading.',
        reportUrl: `/backend/reports/${jobId}/report.html`,
        summary: { totalViolations: -1, bySeverity: { critical: 0, serious: 0, moderate: 0 } },
        report: null
      });
    }

    const raw = await fs.readFile(reportJsonPath, 'utf8');
    const reportJson = JSON.parse(raw);

    // Extract violations summary (same approach as /check route).
    const earlAssertions = Array.isArray(reportJson.assertions) ? reportJson.assertions : [];
    const flattenedViolations = [];

    for (const top of earlAssertions) {
      const inner = Array.isArray(top.assertions) ? top.assertions : [];
      for (const assertion of inner) {
        const outcome =
          assertion['earl:result']?.['earl:outcome'] || assertion.result?.outcome;
        if (outcome !== 'fail') continue;

        const test = assertion['earl:test'] || assertion.test || {};
        const impact = test['earl:impact'] || test.impact || test.severity || 'unknown';
        flattenedViolations.push({ severity: String(impact).toLowerCase() });
      }
    }

    const summary = {
      totalViolations: flattenedViolations.length,
      bySeverity: {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0
      }
    };

    for (const v of flattenedViolations) {
      const sev = String(v.severity).toLowerCase();
      if (sev === 'critical') summary.bySeverity.critical += 1;
      else if (sev === 'serious' || sev === 'severe') summary.bySeverity.serious += 1;
      else if (sev === 'moderate') summary.bySeverity.moderate += 1;
      else summary.bySeverity.minor += 1;
    }

    // Prepare UI-friendly report slice.
    const outlines = reportJson.outlines || {};
    const images = Array.isArray(reportJson.data?.images) ? reportJson.data.images : [];
    const cleanedImages = images.map((img) => ({
      src: img.src || null,
      alt: typeof img.alt === 'string' ? img.alt : img.alt ?? null,
      html: img.html || null,
      role: img.role || null,
      location: img.location || null
    }));
    const seriousViolations = extractSeriousViolations(reportJson);
    const allViolations = extractAllViolations(reportJson);

    const reportUrl = `/backend/reports/${jobId}/report.html`;
    return successResponse(res, {
      jobId,
      fixesApplied: true,
      revalidateFailed: false,
      summary,
      reportUrl,
      report: {
        outlines,
        data: { images: cleanedImages },
        seriousViolations,
        allViolations
      }
    });
  } catch (error) {
    console.error('[Accessibility] Failed to remediate EPUB:', error);
    return errorResponse(res, 'Failed to apply remediation fixes.', 500);
  }
});

// POST /api/accessibility/:jobId/recheck - Re-run Ace on the stored EPUB (e.g. after revalidateFailed).
router.post('/:jobId/recheck', async (req, res) => {
  try {
    const { jobId } = req.params;
    const reportDir = path.join(reportsRoot, jobId);
    const epubPathFile = path.join(reportDir, 'epubPath.json');
    const reportJsonPath = path.join(reportDir, 'report.json');

    if (!(await fs.pathExists(epubPathFile))) {
      return errorResponse(res, 'EPUB not found for this job.', 404);
    }
    const { epubPath } = await fs.readJson(epubPathFile);
    if (!epubPath || !(await fs.pathExists(epubPath))) {
      return errorResponse(res, 'EPUB not found on disk.', 404);
    }

    // Preflight: apply best-effort malformed EPUB normalization before re-checking.
    // Ace sometimes fails content loading for minor structural issues.
    const recheckEngine = new RemedyEngine();
    try {
      const malformedResult = await recheckEngine.applyMalformedFixes(epubPath);
      if (malformedResult?.updatedEntries > 0) {
        console.log(
          `[Accessibility] Malformed fixes applied (${malformedResult.updatedEntries}) for job ${jobId} (recheck)`
        );
      }
    } catch (e) {
      console.error('[Accessibility] Malformed fixes failed (recheck):', e?.message || e);
    }

    // Ace uses Electron/Chromium internally; ensure it can run in restricted environments.
    const cmd = getAceExecCommand(reportDir, epubPath);
    await new Promise((resolve, reject) => {
      exec(
        cmd,
        { cwd: backendRoot, maxBuffer: 10 * 1024 * 1024, env: getAceExecEnv() },
        (error, _stdout, stderr) => {
          if (error) {
            console.error('[Ace CLI] Recheck error:', error);
            if (stderr) console.error('[Ace CLI] stderr:', stderr);
            return reject(
              new Error(
                stderr && (stderr.includes('did-fail-load') || stderr.includes('Failed to check'))
                  ? 'Ace could not load one or more content documents. Try opening the EPUB in an e-reader to verify it.'
                  : 'Failed to run accessibility check.'
              )
            );
          }
          return resolve();
        }
      );
    });

    if (!(await fs.pathExists(reportJsonPath))) {
      return errorResponse(res, 'Report could not be generated.', 500);
    }

    const raw = await fs.readFile(reportJsonPath, 'utf8');
    const reportJson = JSON.parse(raw);

    const earlAssertions = Array.isArray(reportJson.assertions) ? reportJson.assertions : [];
    const flattenedViolations = [];
    for (const top of earlAssertions) {
      const inner = Array.isArray(top.assertions) ? top.assertions : [];
      for (const assertion of inner) {
        const outcome =
          assertion['earl:result']?.['earl:outcome'] || assertion.result?.outcome;
        if (outcome !== 'fail') continue;
        const test = assertion['earl:test'] || assertion.test || {};
        const impact = test['earl:impact'] || test.impact || test.severity || 'unknown';
        flattenedViolations.push({ severity: String(impact).toLowerCase() });
      }
    }

    const summary = {
      totalViolations: flattenedViolations.length,
      bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 }
    };
    for (const v of flattenedViolations) {
      const sev = String(v.severity).toLowerCase();
      if (sev === 'critical') summary.bySeverity.critical += 1;
      else if (sev === 'serious' || sev === 'severe') summary.bySeverity.serious += 1;
      else if (sev === 'moderate') summary.bySeverity.moderate += 1;
      else summary.bySeverity.minor += 1;
    }

    const outlines = reportJson.outlines || {};
    const images = Array.isArray(reportJson.data?.images) ? reportJson.data.images : [];
    const cleanedImages = images.map((img) => ({
      src: img.src || null,
      alt: typeof img.alt === 'string' ? img.alt : img.alt ?? null,
      html: img.html || null,
      role: img.role || null,
      location: img.location || null
    }));
    const seriousViolations = extractSeriousViolations(reportJson);
    const allViolations = extractAllViolations(reportJson);
    const reportUrl = `/backend/reports/${jobId}/report.html`;

    return successResponse(res, {
      jobId,
      summary,
      reportUrl,
      report: {
        outlines,
        data: { images: cleanedImages },
        seriousViolations,
        allViolations
      }
    });
  } catch (error) {
    console.error('[Accessibility] Recheck failed:', error);
    return errorResponse(
      res,
      error.message || 'Failed to re-run accessibility check.',
      500
    );
  }
});

// POST /api/accessibility/:jobId/ai/suggest - AI suggestions (alt + serious code repairs)
// Runs all AI calls in parallel (Promise.allSettled) and caps repairs to avoid timeouts.
router.post('/:jobId/ai/suggest', async (req, res) => {
  const MAX_CODE_REPAIRS = 20; // cap to prevent timeout when many violations exist

  try {
    const { jobId } = req.params;
    const reportDir = path.join(reportsRoot, jobId);
    const reportJsonPath = path.join(reportDir, 'report.json');
    const epubPathFile = path.join(reportDir, 'epubPath.json');

    if (!(await fs.pathExists(reportJsonPath))) {
      return errorResponse(res, 'Report not found or has expired.', 404);
    }
    if (!(await fs.pathExists(epubPathFile))) {
      return errorResponse(res, 'EPUB not found for this job.', 404);
    }

    const reportJson = await fs.readJson(reportJsonPath);
    const { epubPath } = await fs.readJson(epubPathFile);
    if (!epubPath || !(await fs.pathExists(epubPath))) {
      return errorResponse(res, 'EPUB not found on disk.', 404);
    }

    const zip = new AdmZip(epubPath);
    const images = Array.isArray(reportJson?.data?.images) ? reportJson.data.images : [];
    const missingAltImages = images.filter((img) => img?.src && (!img.alt || String(img.alt).trim().length === 0));

    // Generate code repair suggestions for serious + moderate violations (not image-alt, those are handled separately).
    const allViolations = extractAllViolations(reportJson);
    const repairableViolations = allViolations
      .filter(
        (v) =>
          (v.severity === 'critical' || v.severity === 'serious' || v.severity === 'moderate') &&
          v.title !== 'image-alt' &&
          v.offendingSnippet &&
          v.offendingSnippet.trim().length > 0
      )
      .slice(0, MAX_CODE_REPAIRS);

    // ── Run all image-alt AI calls in parallel ──────────────────────────────
    const altTasks = missingAltImages.map(async (img) => {
      const srcNorm = toPosixPath(img.src).replace(/^\.\//, '');
      const srcBase = path.posix.basename(srcNorm);
      const entry =
        zip.getEntry(srcNorm) ||
        zip.getEntry(`OEBPS/${srcBase}`) ||
        zip.getEntries().find((e) => !e.isDirectory && path.posix.basename(e.entryName) === srcBase);

      if (!entry) return null;

      const imageBuffer = zip.readFile(entry.entryName);
      const mime = mimeTypes.lookup(srcBase) || 'image/png';
      try {
        const ai = await AiRemediationService.suggestAltText({ imageBuffer, mimeType: mime, imageSrc: img.src });
        return { src: img.src, suggestion: ai.suggestion, model: ai.modelName };
      } catch (err) {
        return { src: img.src, suggestion: '', error: err.message || 'Failed to generate alt text' };
      }
    });

    // ── Run all code-repair AI calls in parallel ────────────────────────────
    const repairTasks = repairableViolations.map(async (violation) => {
      try {
        const ai = await AiRemediationService.suggestCodeRepair({
          title: violation.title,
          description: violation.description,
          helpDescription: violation.helpDescription,
          filePath: violation.filePath,
          offendingSnippet: violation.offendingSnippet
        });
        return {
          violationId: violation.id,
          filePath: violation.filePath,
          title: violation.title,
          offendingSnippet: ai.offendingSnippet,
          fixedSnippet: ai.fixedSnippet,
          reason: ai.reason,
          model: ai.modelName
        };
      } catch (err) {
        return {
          violationId: violation.id,
          filePath: violation.filePath,
          title: violation.title,
          offendingSnippet: violation.offendingSnippet,
          fixedSnippet: '',
          reason: '',
          error: err.message || 'Failed to generate code repair'
        };
      }
    });

    // Await both batches concurrently
    const [altResults, repairResults] = await Promise.all([
      Promise.allSettled(altTasks),
      Promise.allSettled(repairTasks)
    ]);

    const imageAltSuggestions = altResults
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter(Boolean);

    const codeRepairSuggestions = repairResults
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter(Boolean);

    return successResponse(res, {
      jobId,
      imageAltSuggestions,
      codeRepairSuggestions,
      humanInLoopRequired: true,
      capped: allViolations.filter(
        (v) => (v.severity === 'critical' || v.severity === 'serious' || v.severity === 'moderate') &&
          v.title !== 'image-alt' && v.offendingSnippet?.trim()
      ).length > MAX_CODE_REPAIRS
    });
  } catch (error) {
    console.error('[Accessibility] Failed to generate AI suggestions:', error);
    return errorResponse(res, 'Failed to generate AI remediation suggestions.', 500);
  }
});

export default router;

