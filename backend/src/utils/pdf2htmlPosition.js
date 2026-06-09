/**
 * Resolve pdf2htmlEX `.t` line positions from class names + linked CSS (input.css).
 * Used by EPUB direct import so zone readingOrder follows visual layout, not DOM order.
 */

const PT_TO_PX = 96 / 72;
const DEFAULT_SCALE = 0.25;

function parseMatrix(css) {
  const m = /matrix\s*\(\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)/.exec(css);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
}

function parseCssValue(body, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+)(px|pt)?`, 'i');
  const m = re.exec(body);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return m[2]?.toLowerCase() === 'pt' ? val * PT_TO_PX : val;
}

/**
 * @param {string} cssText - contents of input.css / base.min.css
 * @returns {{ x: Map<string, number>, y: Map<string, number>, m: Map<string, number[]> }}
 */
export function buildPdf2htmlCssMap(cssText) {
  const map = { x: new Map(), y: new Map(), m: new Map() };
  if (!cssText) return map;

  const ruleRe = /\.([a-zA-Z_][\w-]*)\s*\{([^}]+)\}/g;
  let match;
  while ((match = ruleRe.exec(cssText)) !== null) {
    const className = match[1];
    const body = match[2];
    const left = parseCssValue(body, 'left');
    const bottom = parseCssValue(body, 'bottom');
    if (left !== null && className.startsWith('x')) map.x.set(className, left);
    if (bottom !== null && className.startsWith('y')) map.y.set(className, bottom);
    if (className.startsWith('m') && /^m\d+$/.test(className)) {
      const mat = parseMatrix(body);
      if (mat) map.m.set(className, mat);
    }
  }
  return map;
}

/**
 * @param {Element} el - pdf2htmlEX line div (.t)
 * @param {{ x: Map, y: Map, m: Map }} cssMap
 * @param {number} pageHeight - viewport height in px
 * @returns {{ x: number, y: number } | null}
 */
export function resolvePdf2htmlElementPosition(el, cssMap, pageHeight) {
  if (!el?.getAttribute) return null;
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  if (!classes.includes('t')) return null;

  let scaleX = DEFAULT_SCALE;
  let scaleY = DEFAULT_SCALE;
  const matClass = classes.find((c) => /^m\d+$/.test(c));
  if (matClass && cssMap.m?.has(matClass)) {
    const mat = cssMap.m.get(matClass);
    scaleX = Math.abs(mat[0]) || DEFAULT_SCALE;
    scaleY = Math.abs(mat[3]) || DEFAULT_SCALE;
  }

  let x = 0;
  let bottom = 0;
  let hasPosition = false;
  for (const cls of classes) {
    if (cssMap.x?.has(cls)) {
      x = cssMap.x.get(cls);
      hasPosition = true;
    }
    if (cssMap.y?.has(cls)) {
      bottom = cssMap.y.get(cls);
      hasPosition = true;
    }
  }
  if (!hasPosition) return null;

  const scaledX = x * scaleX;
  const scaledBottom = bottom * scaleY;
  const top = pageHeight - scaledBottom;
  return { x: scaledX, y: top };
}

/**
 * Merge multiple CSS files into one map (later rules overwrite).
 * @param {string[]} cssTexts
 */
export function buildPdf2htmlCssMapFromTexts(cssTexts) {
  const merged = { x: new Map(), y: new Map(), m: new Map() };
  for (const text of cssTexts || []) {
    const part = buildPdf2htmlCssMap(text);
    for (const [k, v] of part.x) merged.x.set(k, v);
    for (const [k, v] of part.y) merged.y.set(k, v);
    for (const [k, v] of part.m) merged.m.set(k, v);
  }
  return merged;
}
