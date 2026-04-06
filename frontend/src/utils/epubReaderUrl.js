/**
 * Build SPA path for the full-page EPUB reader (reflowable + FXL).
 * @param {string|number} jobId
 * @param {{
 *   source?: 'conversion'|'kitaboo',
 *   fixedLayout?: boolean,
 *   spine?: string,
 *   anchorId?: string
 * }} opts
 */
export function buildEpubReaderPath(jobId, opts = {}) {
  const { source = 'conversion', fixedLayout = false, spine, anchorId } = opts;
  const q = new URLSearchParams();
  q.set('source', source);
  if (fixedLayout) q.set('fixedLayout', '1');
  if (spine) q.set('spine', spine);
  if (anchorId) q.set('anchorId', anchorId);
  return `/reader/epub/${jobId}?${q.toString()}`;
}
