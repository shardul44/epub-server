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

export const EPUBCHECK_HISTORY_KEY = 'epubcheck-history';

export function readEpubcheckHistory() {
  try {
    const raw = sessionStorage.getItem(EPUBCHECK_HISTORY_KEY);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearEpubcheckHistory() {
  try {
    sessionStorage.removeItem(EPUBCHECK_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
