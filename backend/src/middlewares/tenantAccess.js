import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
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
