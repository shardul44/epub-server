import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
import { kitabooFxlJobStore } from '../services/kitabooFxlJobStore.js';
import { forbiddenResponse, notFoundResponse, badRequestResponse } from '../utils/responseHandler.js';
import { canAccessPdfRow } from '../utils/tenantScope.js';

export async function loadPdfIfAccessible(user, pdfId) {
  if (pdfId == null || pdfId === '') return null;
  const id = parseInt(pdfId, 10);
  if (Number.isNaN(id)) return null;
  const pdf = await PdfDocumentModel.findById(id);
  if (!pdf || !canAccessPdfRow(user, pdf)) return null;
  return pdf;
}

/**
 * Resolve FXL / timestamp jobId when there is no conversion_jobs row yet.
 */
async function resolveKitabooJobAccess(req, jobId) {
  const idStr = String(jobId);

  const kitabooRow = await KitabooZoneModel.getJobByJobId(idStr);
  if (kitabooRow) {
    const pdf = await loadPdfIfAccessible(req.user, kitabooRow.pdfId);
    if (pdf) {
      return { job: { id: jobId, pdf_document_id: kitabooRow.pdfId }, pdf };
    }
    return null;
  }

  const inMemoryJob = kitabooFxlJobStore.get(idStr);
  if (inMemoryJob) {
    const pdf = await loadPdfIfAccessible(req.user, inMemoryJob.pdfId);
    if (pdf) {
      return { job: { id: jobId, pdf_document_id: inMemoryJob.pdfId }, pdf };
    }
    return null;
  }

  return null;
}

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
      const resolved = await resolveKitabooJobAccess(req, jobId);
      if (resolved) {
        req.tenantPdf = resolved.pdf;
        req.tenantJob = resolved.job;
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
