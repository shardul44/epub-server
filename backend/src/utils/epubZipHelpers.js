import crypto from 'crypto';

/**
 * Track binary blobs by hash so identical assets are only stored once in an EPUB zip.
 */
export function createImageDeduper() {
  /** @type {Map<string, string>} hash -> first zip path used */
  const byHash = new Map();

  return {
    /**
     * @param {Buffer} buf
     * @param {string} preferredZipPath - e.g. OEBPS/images/page_1_render.png
     * @returns {{ zipPath: string, skipWrite: boolean }} skipWrite=true → reuse existing manifest entry
     */
    register(preferredZipPath, buf) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const existing = byHash.get(hash);
      if (existing) {
        return { zipPath: existing, skipWrite: true };
      }
      byHash.set(hash, preferredZipPath);
      return { zipPath: preferredZipPath, skipWrite: false };
    }
  };
}

/** JSZip: true if entry is stored uncompressed (EPUB mimetype). */
export function zipEntryIsStored(entry) {
  if (!entry?.options) return false;
  if (entry.options.compression === 'STORE') return true;
  const m = entry._data?.compression?.method;
  return m === 0;
}
