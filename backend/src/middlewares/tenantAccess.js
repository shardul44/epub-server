import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
import { kitabooFxlJobStore } from '../services/kitabooFxlJobStore.js';
import { forbiddenResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';
import { canAccessPdfRow } from '../utils/tenantScope.js';

/**
 * Express router.param handler: validates access to conversion job via owning PDF.
 */
export async function paramJobTenantAccess(req, res, next, jobId) {
  const id = parseInt(jobId, 10);
  if (Number.isNaN(id)) {
    return badRequestResponse(res, 'Invalid job id');
  }
  try {
    let job = await ConversionJobModel.findById(id);
    if (!job) {
      // FXL direct EPUB import used to use Date.now() as jobId (no conversion_jobs row).
      const kitabooRow = await KitabooZoneModel.getJobByJobId(String(jobId));
      if (kitabooRow && String(kitabooRow.jobId) === String(jobId)) {
        const pdf = await PdfDocumentModel.findById(kitabooRow.pdfId);
        if (pdf && canAccessPdfRow(req.user, pdf)) {
          req.tenantPdf = pdf;
          req.tenantJob = { id, pdf_document_id: kitabooRow.pdfId };
          return next();
        }
      }

      // Fallback: job may be in-memory only (newly created, zones not yet saved to DB).
      // Allow the request through so filesystem-safe routes (e.g. GET /human-audio/:jobId)
      // can respond without a DB row. The route handler is responsible for its own 404 logic.
      const inMemoryJob = kitabooFxlJobStore.get(String(jobId));
      if (inMemoryJob) {
        req.tenantJob = { id, pdf_document_id: inMemoryJob.pdfId };
        return next();
      }

      // Kitaboo FXL jobs use a timestamp-based jobId (Date.now()) which is much larger
      // than a normal DB auto-increment ID. If the ID looks like a timestamp (> 1e12),
      // allow the request through — the route handler will do its own DB/filesystem
      // recovery (e.g. /kitaboo/ready and /kitaboo/job both attempt to restore from DB).
      if (id > 1e12) {
        req.tenantJob = { id, pdf_document_id: null };
        return next();
      }

      return notFoundResponse(res, 'Conversion job not found');
    }
    const pdf = await PdfDocumentModel.findById(job.pdf_document_id);
    if (!pdf) {
      return notFoundResponse(res, 'PDF document not found');
    }
    if (!canAccessPdfRow(req.user, pdf)) {
      return forbiddenResponse(res, 'Forbidden');
    }
    req.tenantJob = job;
    req.tenantPdf = pdf;
    next();
  } catch (e) {
    return next(e);
  }
}

/**
 * Express router.param handler: validates access to PDF by id.
 */
export async function paramPdfTenantAccess(req, res, next, pdfId) {
  const id = parseInt(pdfId, 10);
  if (Number.isNaN(id)) {
    return badRequestResponse(res, 'Invalid PDF id');
  }
  try {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf) {
      return notFoundResponse(res, 'PDF document not found');
    }
    if (!canAccessPdfRow(req.user, pdf)) {
      return forbiddenResponse(res, 'Forbidden');
    }
    req.tenantPdf = pdf;
    next();
  } catch (e) {
    return next(e);
  }
}
