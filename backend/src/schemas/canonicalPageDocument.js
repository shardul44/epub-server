/**
 * Canonical per-page document model — source of truth for regeneration (migration path).
 * @see docs in sanitizeXhtml / conversionService: prefer this over round-tripping EPUB XHTML.
 */

export const CANONICAL_PAGE_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} CanonicalTextBlock
 * @property {string} id
 * @property {string} text
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} CanonicalImageBlock
 * @property {string} id
 * @property {string} src  - relative EPUB path e.g. images/foo.png
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} CanonicalPageDocument
 * @property {number} schemaVersion
 * @property {number} pageNumber
 * @property {number} width
 * @property {number} height
 * @property {string} [backgroundImage] - relative path to full-page render
 * @property {CanonicalTextBlock[]} textBlocks
 * @property {CanonicalImageBlock[]} imageBlocks
 * @property {Record<string, unknown>} [styles]
 * @property {Record<string, unknown>} [metadata]
 */

export function emptyCanonicalPage(pageNumber, width = 612, height = 792) {
  return {
    schemaVersion: CANONICAL_PAGE_SCHEMA_VERSION,
    pageNumber,
    width,
    height,
    backgroundImage: null,
    textBlocks: [],
    imageBlocks: [],
    styles: {},
    metadata: {}
  };
}

export function isCanonicalPageDocument(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    Number(obj.schemaVersion) === CANONICAL_PAGE_SCHEMA_VERSION &&
    Number.isFinite(Number(obj.pageNumber)) &&
    Number.isFinite(Number(obj.width)) &&
    Number.isFinite(Number(obj.height)) &&
    Array.isArray(obj.textBlocks) &&
    Array.isArray(obj.imageBlocks)
  );
}
