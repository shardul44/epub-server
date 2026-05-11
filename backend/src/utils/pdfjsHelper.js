/**
 * PDF.js helper — Node.js server-side.
 * pdfjs-dist@3.x legacy build exposes the API on `default` when using dynamic import.
 * In Node ESM, `require` is undefined, so pdf.js does not auto-set the worker path;
 * GlobalWorkerOptions.workerSrc must be an absolute filesystem path to legacy/build/pdf.worker.js
 * so the fake worker can require() WorkerMessageHandler (file: URLs do not work with require).
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** Absolute path to pdf.worker.js (Node's require() does not accept file: URLs). */
function resolvePdfWorkerSrc() {
  return require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
}

let pdfjsLibCache = null;

/** Base options for every backend getDocument() call */
export const PDFJS_NODE_DOCUMENT_BASE = Object.freeze({
  disableWorker: true,
  useSystemFonts: true,
});

/**
 * @param {Uint8Array | Buffer} data
 * @param {Record<string, unknown>} [extra]
 */
export function buildPdfDocumentOptions(data, extra = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return {
    ...PDFJS_NODE_DOCUMENT_BASE,
    data: bytes,
    verbosity: 0,
    ...extra,
  };
}

export async function getPdfjsLib() {
  if (pdfjsLibCache) {
    return pdfjsLibCache;
  }

  try {
    const mod = await import('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsLib = mod.default ?? mod;
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
    }
    pdfjsLibCache = pdfjsLib;
    return pdfjsLib;
  } catch (error) {
    console.error('[PDF.js Helper] Error loading pdfjs-dist:', error);
    throw new Error('Failed to load PDF.js library');
  }
}
