/**
 * FXL / "wild" HTML heuristic zone discovery (pdf2htmlEX, InDesign-style line divs, SML word spans).
 * Mirrors frontend SyncStudio.jsx logic so EPUB direct import gets per-line/word zones instead of one body blob.
 */

export const HEURISTIC_INJECTED_ID_PREFIX = 'byline_ss_imp_';

const HEURISTIC_INLINE_CHILD_TAGS = new Set([
  'span',
  'a',
  'b',
  'i',
  'em',
  'strong',
  'u',
  'sub',
  'sup',
  'small',
  'mark',
  'br',
  'wbr',
  'abbr',
  'cite',
  'code',
  'dfn',
  'kbd',
  'q',
  's',
  'samp',
  'time',
  'var',
  'tt',
  'bdi',
  'bdo',
  'ruby',
  'rt',
  'rp',
  'img',
  'svg'
]);

function heuristicHasDirectBlockLevelChild(el) {
  const idStr = (el.getAttribute('id') || '').trim();
  const isPdf2LineBox =
    (el.classList && el.classList.contains('t')) || /^t\d+_/i.test(idStr);

  for (let i = 0; i < el.children.length; i++) {
    const tn = el.children[i].tagName.toLowerCase();
    if (HEURISTIC_INLINE_CHILD_TAGS.has(tn)) continue;
    if (isPdf2LineBox && tn === 'div') continue;
    return true;
  }
  return false;
}

function heuristicIsPdf2htmlFooterishClass(el) {
  const cl = el.classList;
  if (!cl || !cl.length) return false;
  for (let i = 0; i < cl.length; i++) {
    if (/^s\d+_\d+$/i.test(cl[i])) return true;
  }
  return false;
}

function heuristicIsStandaloneShortNumeric(text) {
  const t = String(text || '').trim();
  if (t.length === 0 || t.length > 2) return false;
  return /^\d+$/.test(t);
}

function heuristicElementLikelyHidden(el) {
  try {
    if (el.getAttribute('hidden') != null) return true;
    const st = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(st) || /visibility\s*:\s*hidden/i.test(st)) return true;
    const win = el.ownerDocument?.defaultView;
    if (win && typeof win.getComputedStyle === 'function') {
      const c = win.getComputedStyle(el);
      if (c.display === 'none' || c.visibility === 'hidden') return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

const HEURISTIC_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'figcaption',
  'span.text',
  'span[id]',
  'div[role="doc-text"]',
  '.t',
  'span[id^="SML"]',
  'span[id^="sml"]',
  'div[id^="t"]'
].join(', ');

/**
 * @param {Document} doc
 * @param {number|string} contextId - page number or section id for injected ids
 * @param {Set<string>} existingIds
 * @returns {Array<{ id: string, text: string, element: Element }>}
 */
export function collectHeuristicWildHtmlElements(doc, contextId, existingIds) {
  const out = [];
  if (!doc?.body || !(existingIds instanceof Set)) return out;

  let injectCounter = 0;
  doc.body.querySelectorAll(HEURISTIC_SELECTOR).forEach((el) => {
    if (el.getAttribute('data-read-aloud') === 'true') return;
    if (el.closest('svg, code, pre, script, style, head, nav, [role="doc-toc"]')) return;
    const r = (el.getAttribute('role') || '').toLowerCase();
    const ariaHidden = (el.getAttribute('aria-hidden') || '').toLowerCase();
    if (r === 'presentation' || r === 'none' || ariaHidden === 'true') return;
    if (heuristicElementLikelyHidden(el)) return;
    if (heuristicIsPdf2htmlFooterishClass(el)) return;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    if (heuristicIsStandaloneShortNumeric(text)) return;
    if (heuristicHasDirectBlockLevelChild(el)) return;

    let id = (el.getAttribute('id') || '').trim();
    if (!id) {
      id = `${HEURISTIC_INJECTED_ID_PREFIX}${contextId}_${injectCounter++}`;
    }
    if (id.includes('div')) return;
    if (existingIds.has(id)) return;

    existingIds.add(id);
    out.push({ id, text, element: el });
  });
  return out;
}

function parseCssPx(style, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`, 'i');
  const m = re.exec(style || '');
  return m ? parseFloat(m[1]) : null;
}

/**
 * Walk up for pdf2htmlEX absolute positioning on self or ancestors.
 */
function inferBBoxFromElement(el, order, vw, vh) {
  let node = el;
  for (let depth = 0; depth < 16 && node; depth++) {
    const st = node.getAttribute?.('style') || '';
    let left = parseCssPx(st, 'left');
    let top = parseCssPx(st, 'top');
    let width = parseCssPx(st, 'width');
    let height = parseCssPx(st, 'height');
    const fsMatch = /font-size\s*:\s*([0-9.]+)px/i.exec(st);
    const fontSize = fsMatch ? parseFloat(fsMatch[1]) : 16;
    if (left != null && top != null) {
      const textLen = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
      if (width == null) width = Math.max(24, textLen * fontSize * 0.45);
      if (height == null) height = Math.max(fontSize * 1.2, 24);
      return { x: left, y: top, w: width, h: height, fontSize };
    }
    node = node.parentElement;
  }
  const fontSize = 16;
  return {
    x: 16,
    y: 16 + (order - 1) * 36,
    w: Math.max(80, vw - 32),
    h: Math.max(fontSize * 1.25, 26),
    fontSize
  };
}

/**
 * @param {Document} doc
 * @param {number} pageNum - 1-based spine page
 * @param {{ width?: number, height?: number }} [viewport]
 * @returns {Array<{ id: string, type: string, x: number, y: number, w: number, h: number, readingOrder: number, content: string, fontSize: number }>}
 */
export function zonesFromHeuristicWildHtml(doc, pageNum, viewport = {}) {
  const vw = Number(viewport.width) > 0 ? Number(viewport.width) : 1200;
  const vh = Number(viewport.height) > 0 ? Number(viewport.height) : 1600;
  const existingIds = new Set();
  const rows = collectHeuristicWildHtmlElements(doc, pageNum, existingIds);
  if (rows.length === 0) return [];

  const zones = rows.map((row, idx) => {
    const bbox = inferBBoxFromElement(row.element, idx + 1, vw, vh);
    return {
      id: row.id,
      type: 'text',
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
      readingOrder: 0,
      content: row.text,
      fontSize: bbox.fontSize
    };
  });

  zones.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  zones.forEach((z, i) => {
    z.readingOrder = i + 1;
  });
  return zones;
}
