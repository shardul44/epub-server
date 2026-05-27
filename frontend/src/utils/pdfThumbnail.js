/**
 * PDF Thumbnail Generator Utility
 *
 * Generates thumbnail images from PDF files using pdfjs-dist v5 in the browser.
 * No backend API required — everything runs client-side.
 *
 * Features:
 * - Generate thumbnails from File, Blob, or URL
 * - Configurable thumbnail size and quality
 * - Memory-efficient with proper cleanup
 * - Returns data URL for flexible usage
 * - Caching support via localStorage
 * - Error handling and loading states
 */

import * as pdfjsLib from 'pdfjs-dist';

// pdfjs-dist v5 ships as ES modules (.mjs).
// Point the worker at the bundled file via Vite's ?url import.
// This avoids CDN dependency and works offline.
import PdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

/**
 * Default thumbnail generation options
 */
const DEFAULT_OPTIONS = {
  width:      400,          // Target width in pixels
  height:     560,          // Target height in pixels
  scale:      2,            // Render scale factor (2 = retina quality)
  pageNumber: 1,            // Which page to render (1-indexed)
  format:     'image/png',  // 'image/png' or 'image/jpeg'
  quality:    0.92,         // JPEG quality (0–1), ignored for PNG
};

/**
 * Generate a thumbnail from a PDF File/Blob.
 *
 * @param {File|Blob} pdfFile - The PDF to render
 * @param {Partial<typeof DEFAULT_OPTIONS>} options
 * @returns {Promise<string>} Data URL of the rendered thumbnail
 *
 * @example
 * const dataUrl = await generatePdfThumbnail(file, { width: 300, height: 420 });
 * img.src = dataUrl;
 */
export async function generatePdfThumbnail(pdfFile, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Convert File/Blob → ArrayBuffer
  const arrayBuffer = await pdfFile.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Magic-byte guard — every PDF starts with "%PDF-" (0x25 0x50 0x44 0x46 0x2D).
  // Bail out early with a typed error so callers can treat non-PDF inputs as
  // "absent" instead of letting pdfjs throw the noisy InvalidPDFException.
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    const err = new Error('Not a PDF file (missing %PDF- header)');
    err.name = 'InvalidPDFException';
    throw err;
  }

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;

  // Clamp page number to valid range
  const pageNum = Math.max(1, Math.min(opts.pageNumber, pdf.numPages));
  const page = await pdf.getPage(pageNum);

  // Calculate scale to fit within target dimensions while preserving aspect ratio
  const viewport = page.getViewport({ scale: 1 });
  const fitScale = Math.min(
    (opts.width  * opts.scale) / viewport.width,
    (opts.height * opts.scale) / viewport.height
  );
  const scaledViewport = page.getViewport({ scale: fitScale });

  // Render to an off-screen canvas
  const canvas  = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width  = scaledViewport.width;
  canvas.height = scaledViewport.height;

  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

  const dataUrl = canvas.toDataURL(opts.format, opts.quality);

  // Cleanup — release PDF.js internal resources
  page.cleanup();
  await pdf.destroy();

  // Release canvas memory
  canvas.width  = 0;
  canvas.height = 0;

  return dataUrl;
}

/**
 * Generate a thumbnail with localStorage caching.
 * On cache hit the PDF is never parsed — instant return.
 *
 * @param {File|Blob} pdfFile
 * @param {string} cacheKey - Stable key, e.g. `pdf-thumb-${file.name}-${file.size}`
 * @param {Partial<typeof DEFAULT_OPTIONS>} options
 * @returns {Promise<string>} Data URL
 */
export async function generatePdfThumbnailCached(pdfFile, cacheKey, options = {}) {
  // Cache read
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch (_) { /* storage unavailable */ }

  const dataUrl = await generatePdfThumbnail(pdfFile, options);

  // Cache write — evict oldest entries if storage is full
  try {
    localStorage.setItem(cacheKey, dataUrl);
  } catch (_) {
    clearOldThumbnailCache();
    try { localStorage.setItem(cacheKey, dataUrl); } catch (__) { /* give up */ }
  }

  return dataUrl;
}

/**
 * Remove the oldest half of cached thumbnail entries to free localStorage space.
 */
export function clearOldThumbnailCache() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('pdf-thumb-'));
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
  } catch (_) { /* ignore */ }
}

/**
 * Extract basic metadata from a PDF without rendering.
 *
 * @param {File|Blob} pdfFile
 * @returns {Promise<{ numPages: number, width: number, height: number }>}
 */
export async function getPdfMetadata(pdfFile) {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const page = await pdf.getPage(1);
  const { width, height } = page.getViewport({ scale: 1 });
  page.cleanup();
  await pdf.destroy();
  return { numPages: pdf.numPages, width, height };
}
