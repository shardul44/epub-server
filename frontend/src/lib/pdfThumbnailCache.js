/**
 * In-memory cache + in-flight deduplication for PdfThumbnail.
 * Prevents repeated GET /pdfs/:id/view when parents re-render or remount during job polling.
 */

const memory = new Map();
/** @type {Map<string, Promise<string>>} */
const inflight = new Map();
/** @type {Map<string, Promise<Blob>>} */
const inflightBlob = new Map();

export function getMemoryThumbnail(cacheKey) {
  if (!cacheKey) return null;
  return memory.get(cacheKey) ?? null;
}

export function setMemoryThumbnail(cacheKey, dataUrl) {
  if (!cacheKey || !dataUrl) return;
  memory.set(cacheKey, dataUrl);
}

async function blobLooksLikePdf(pdfBlob) {
  if (!pdfBlob || pdfBlob.size === 0) return false;
  const head = await pdfBlob.slice(0, 5).arrayBuffer();
  const bytes = new Uint8Array(head);
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Fetch PDF bytes once per URL (deduped). Validates Content-Type and magic bytes.
 * @param {string} url
 * @returns {Promise<Blob>}
 */
export async function fetchPdfViewBlobOnce(url) {
  if (!url) throw new Error('Missing PDF view URL');

  if (inflightBlob.has(url)) {
    return inflightBlob.get(url);
  }

  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.httpStatus = response.status;
        throw err;
      }

      const ct = (response.headers.get('content-type') || '').toLowerCase();
      const ctLooksWrong =
        ct.includes('text/html') ||
        ct.includes('application/json') ||
        ct.includes('text/plain');

      const pdfBlob = await response.blob();
      if (!pdfBlob || pdfBlob.size === 0 || !(await blobLooksLikePdf(pdfBlob)) || ctLooksWrong) {
        const err = new Error('NOT_PDF');
        err.code = 'NOT_PDF';
        throw err;
      }
      return pdfBlob;
    })
    .finally(() => {
      inflightBlob.delete(url);
    });

  inflightBlob.set(url, promise);
  return promise;
}

/**
 * @param {string} cacheKey
 * @param {() => Promise<string>} factory
 * @returns {Promise<string>}
 */
export function loadThumbnailDataUrlOnce(cacheKey, factory) {
  const cached = getMemoryThumbnail(cacheKey);
  if (cached) return Promise.resolve(cached);

  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey);
  }

  const promise = factory()
    .then((dataUrl) => {
      setMemoryThumbnail(cacheKey, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, promise);
  return promise;
}
