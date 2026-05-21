import fs from 'fs/promises';

/**
 * True when the pdf_documents row points at an imported EPUB (not a renderable PDF on disk).
 */
export function isEpubImportStubDocument(pdfDoc) {
  if (!pdfDoc) return false;
  const fp = (pdfDoc.file_path || pdfDoc.filePath || '').toLowerCase();
  const orig = (
    pdfDoc.original_file_name ||
    pdfDoc.originalFileName ||
    pdfDoc.file_name ||
    pdfDoc.fileName ||
    ''
  ).toLowerCase();
  if (fp.endsWith('.epub')) return true;
  if (orig.endsWith('.epub') && fp.includes('epub_imports')) return true;
  return false;
}

export function epubImportStubMessage() {
  return (
    'This document is an imported EPUB, not a PDF. Hi-Fi and PDF rendering require a .pdf source file. ' +
    'Use EPUB Sync import (FXL mode) and open FXL Sync Studio, or upload a PDF for Hi-Fi FXL.'
  );
}

/**
 * Ensure Kitaboo PDF pipelines are not started against EPUB import stubs.
 * @throws {Error} statusCode 400 for EPUB stubs; message includes path when PDF missing
 */
export async function assertPdfSourceForKitabooPipeline(pdfDoc) {
  if (isEpubImportStubDocument(pdfDoc)) {
    const err = new Error(epubImportStubMessage());
    err.statusCode = 400;
    err.code = 'EPUB_IMPORT_NOT_PDF';
    throw err;
  }
  const fp = pdfDoc?.file_path || pdfDoc?.filePath;
  if (!fp) {
    const err = new Error('PDF file path is missing for this document.');
    err.statusCode = 400;
    throw err;
  }
  try {
    await fs.access(fp);
  } catch {
    const err = new Error(`PDF file not found: ${fp}`);
    err.statusCode = 404;
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }
}
