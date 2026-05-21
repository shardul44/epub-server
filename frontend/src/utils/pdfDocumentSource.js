/**
 * Detect PDF library rows created by EPUB direct import (stored .epub on disk, not a PDF).
 */
export function isEpubImportStub(pdf) {
  if (!pdf) return false;
  const orig = (pdf.originalFileName || pdf.fileName || '').toLowerCase();
  if (orig.endsWith('.epub')) return true;
  if (pdf.documentType === 'OTHER' && pdf.layoutType === 'FIXED_LAYOUT' && orig.endsWith('.epub')) {
    return true;
  }
  return false;
}
