/**
 * Subtitle for EPUB Checker header: avoid "W3C EPUBCheck · epubchecker (W3C EPUBCheck)"
 * when the API already returns a full description.
 */
export function formatEpubCheckerSubtitle(raw) {
  if (raw == null || String(raw).trim() === '') return 'W3C EPUBCheck';
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower.includes('(w3c') || lower.includes('epubchecker (')) {
    return s;
  }
  if (/^v?[\d.]+(-[\w.]+)?$/i.test(s)) {
    return s.toLowerCase().startsWith('v') ? `W3C EPUBCheck · ${s}` : `W3C EPUBCheck · v${s}`;
  }
  return `W3C EPUBCheck · ${s}`;
}

export const EPUBCHECK_HISTORY_KEY_PREFIX = 'epubcheck-history';

export function epubcheckHistoryKey(userId) {
  return userId != null ? `${EPUBCHECK_HISTORY_KEY_PREFIX}:${userId}` : EPUBCHECK_HISTORY_KEY_PREFIX;
}

/** @param {number|string|null|undefined} userId */
export function readEpubcheckHistory(userId) {
  try {
    const raw = sessionStorage.getItem(epubcheckHistoryKey(userId));
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {number|string|null|undefined} userId */
export function clearEpubcheckHistory(userId) {
  try {
    sessionStorage.removeItem(epubcheckHistoryKey(userId));
  } catch {
    /* ignore */
  }
}
