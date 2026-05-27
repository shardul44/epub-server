/**
 * Detect PDF library rows created by EPUB direct import (stored .epub on disk, not a PDF).
 */
export function isEpubImportStub(pdf) {
  if (!pdf) return false;
  const orig = (pdf.originalFileName || pdf.fileName || '').toLowerCase();
  if (orig.endsWith('.epub')) return true;
  if (pdf.documentType === 'OTHER' && (orig.endsWith('.epub') || orig.includes('.epub'))) {
    return true;
  }
  const pathHint = (pdf.filePath || pdf.file_path || '').toLowerCase();
  if (pathHint.includes('epub_imports') || /fxl_stub_\d+\.epub$/i.test(pathHint)) {
    return true;
  }
  return false;
}
