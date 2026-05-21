import fs from 'fs/promises';
import path from 'path';
import { getEpubOutputDir, getUploadDir } from '../config/fileStorage.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';

/**
 * Resolve an FXL EPUB file for GET /kitaboo/download/:jobId.
 * Prefers published export; falls back to EPUB direct-import source file.
 *
 * @param {string|number} jobId
 * @returns {Promise<{ absPath: string, filename: string, source: 'published'|'import_stub'|'pdf_record' }|null>}
 */
export async function resolveKitabooEpubDownload(jobId) {
  const id = String(jobId);
  const publishedPath = path.join(getEpubOutputDir(), `fxl_${id}`, `fxl_${id}.epub`);
  try {
    await fs.access(publishedPath);
    return { absPath: publishedPath, filename: `fxl_${id}.epub`, source: 'published' };
  } catch {
    /* try fallbacks */
  }

  const stubPath = path.join(getUploadDir(), 'epub_imports', `fxl_stub_${id}.epub`);
  try {
    await fs.access(stubPath);
    let filename = `job-${id}.epub`;
    try {
      const job = await KitabooZoneModel.getJobByJobId(id);
      if (job?.pdfId) {
        const pdf = await PdfDocumentModel.findById(job.pdfId);
        const orig = pdf?.originalFileName || pdf?.fileName;
        if (orig && String(orig).toLowerCase().endsWith('.epub')) {
          filename = path.basename(orig);
        }
      }
    } catch {
      /* optional metadata */
    }
    return { absPath: stubPath, filename, source: 'import_stub' };
  } catch {
    /* try pdf record path */
  }

  try {
    const job = await KitabooZoneModel.getJobByJobId(id);
    if (job?.pdfId) {
      const pdf = await PdfDocumentModel.findById(job.pdfId);
      const filePath = pdf?.filePath;
      if (filePath && String(filePath).toLowerCase().endsWith('.epub')) {
        await fs.access(filePath);
        const filename =
          pdf.originalFileName || pdf.fileName || path.basename(filePath);
        return { absPath: filePath, filename, source: 'pdf_record' };
      }
    }
  } catch {
    /* not found */
  }

  return null;
}
