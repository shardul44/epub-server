import { resolveFontFamily, getGoogleFontImports } from './fontMapper.js';

/**
 * EPUB generator for Fixed Layout (FXL) — supports two output styles:
 *
 * 1. Zone-based (default): AI/semantic zones, inline styles or zone boxes, word/sentence SMIL.
 * 2. Classic PDF-reconstruction: layout-first, one background image + positioned divs with
 *    CSS coordinate classes (xNN, yNN, fsN), micro-fragments (span/word), element-level SMIL.
 *
 * Classic style matches: Adobe PDF→EPUB, print-to-digital pipelines (no AI zoning).
 */

/**
 * Escape text for use in XML/XHTML attributes and content.
 * @param {string} s
 * @returns {string}
 */
export function escapeXml(s) {
  if (s == null || typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Collapse any run of whitespace to a single space (avoids FXL spacing from PDF extraction). */
export function normalizeSpaces(s) {
  if (s == null || typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

/** Fix abbreviation corruption (Ph.DD. -> Ph.D., M.AA. -> M.A.) from glyph/word boundaries or PDF layers.
 *  Also fix "Ph. -" / "Ph.—" (OCR or PDF em dash) so it displays as Ph.D. instead of "Ph._". */
export function normalizeAbbreviationCorruption(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\bPh\.\s*[-–—]\s*/gi, 'Ph.D. ')
    .replace(/\bPh\.D+D\./gi, 'Ph.D.')
    .replace(/\bM\.A+A\./gi, 'M.A.')
    .replace(/\bM\.A+A\.Ed\./gi, 'M.A.Ed.')
    .replace(/\bM\.S+S\.Ed\./gi, 'M.S.Ed.')
    .replace(/\bB\.A+A\./gi, 'B.A.')
    .replace(/\bB\.S+S\./gi, 'B.S.');
}

/** Fix common last-glyph truncations seen in some PDF text layers (e.g. "Directo" -> "Director"). */
export function normalizeCommonTruncations(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\bEditorial Directo\b/g, 'Editorial Director')
    .replace(/\bProduction Directo\b/g, 'Production Director')
    .replace(/\bCreative Directo\b/g, 'Creative Director')
    .replace(/\bPhoto Edito\b/g, 'Photo Editor')
    .replace(/\bPublishe\b/g, 'Publisher');
}

function pickDefaultEmbeddedFontName(embeddedNames = []) {
  const names = (embeddedNames || []).filter(Boolean);
  if (names.length === 0) return null;
  // Prefer non-bold "body" faces so credits/body text doesn't look bold.
  const preferred = [
    /Regular/i,
    /Roman/i,
    /Book/i,
    /Medium/i,
    /Semibold/i,
    /Bold/i
  ];
  for (const re of preferred) {
    const hit = names.find(n => re.test(String(n)));
    if (hit) return hit;
  }
  return names[0];
}

function cssFontFamilyDecl(fontFamilyValue, important = false) {
  const v = (fontFamilyValue == null ? '' : String(fontFamilyValue)).trim();
  if (!v) return 'font-family: Arial, sans-serif;';
  const imp = important ? ' !important' : '';
  // If already a stack or already quoted, don't wrap again.
  if (v.includes(',') || v.includes('"') || v.includes("'")) return `font-family:${v}${imp};`;
  return `font-family:"${v}"${imp};`;
}

/**
 * PDF outlines often carry large strokeWidth values. In SVG those become black "scribbles"
 * over text. Cap stroke relative to font size for readable FXL exports.
 * @param {unknown} strokeWidth
 * @param {number} [fontSize]
 * @returns {number|null} clamped width in px, or null to omit stroke
 */
function clampSvgStrokeWidthPx(strokeWidth, fontSize = 12) {
  const w = Number(strokeWidth);
  if (!Number.isFinite(w) || w <= 0) return null;
  const fs = Math.max(8, Number(fontSize) || 12);
  const cap = Math.max(0.35, fs * 0.12);
  return Math.min(w, cap);
}

/** Returns CSS fragment e.g. stroke:...;stroke-width:... or empty if no stroke. */
function svgStrokeStyleDecl(strokeColor, strokeWidthRaw, fontSize = 12) {
  const sw = clampSvgStrokeWidthPx(strokeWidthRaw, fontSize);
  if (!strokeColor || sw == null) return '';
  return `stroke:${strokeColor};stroke-width:${sw}px;paint-order:stroke fill;`;
}

function stripSubsetPrefix(name) {
  if (name == null) return '';
  return String(name).replace(/^[^+]+\+/, '').trim();
}

function titleCaseWord(word = '') {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function inferLocalFontCandidates(rawName) {
  const base = stripSubsetPrefix(rawName);
  if (!base) return [];
  const normalized = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutStyle = normalized
    .replace(/\b(Regular|Roman|Book|Medium|Semibold|Bold|Black|Light|Italic|Oblique|Condensed|Cond)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const readable = normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  const readableNoStyle = readable
    .replace(/\b(Regular|Roman|Book|Medium|Semibold|Bold|Black|Light|Italic|Oblique|Condensed|Cond)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const manualFamilyHints = [];
  if (/minion\s*pro/i.test(base)) manualFamilyHints.push('Minion Pro');
  if (/times\s*new\s*roman/i.test(base)) manualFamilyHints.push('Times New Roman');
  if (/open\s*sans/i.test(base)) manualFamilyHints.push('Open Sans');
  if (/myriad\s*pro/i.test(base)) manualFamilyHints.push('Myriad Pro');
  if (/helvetica\s*neue/i.test(base)) manualFamilyHints.push('Helvetica Neue');
  if (/helvetica/i.test(base)) manualFamilyHints.push('Helvetica');

  const candidates = [
    normalized,
    readable,
    withoutStyle,
    readableNoStyle,
    ...manualFamilyHints
  ]
    .map(v => (v || '').trim())
    .filter(Boolean)
    .map(v => v.split(' ').map(titleCaseWord).join(' '));

  return [...new Set(candidates)];
}

function buildFontFaceSrc(font) {
  const localCandidates = inferLocalFontCandidates(font?.name);
  const localParts = localCandidates.map(n => `local("${n}")`);
  const webParts = [];
  if (font?.woff2Filename) {
    webParts.push(`url("../fonts/${font.woff2Filename}") format("woff2")`);
  }
  webParts.push(`url("../fonts/${font.filename}")`);
  return [...localParts, ...webParts].join(', ');
}

function canonicalFontName(name) {
  if (name == null) return '';
  let v = String(name).trim();
  // If this is a stack, compare only the first family
  if (v.includes(',')) v = v.split(',')[0].trim();
  v = v.replace(/^['"]+|['"]+$/g, '');
  // Drop subset/prefix (e.g. "WHCWDU+MyriadPro-Regular" -> "MyriadPro-Regular")
  v = v.replace(/^[^+]+\+/, '');
  return v.replace(/\s+/g, '').replace(/_/g, '').toLowerCase();
}

function resolveEmbeddedFontName(rawName, embeddedNames = [], fontMap = {}) {
  const raw = rawName != null ? String(rawName).trim() : '';
  if (!raw) return null;
  const candidates = [];
  const mapped = fontMap[raw];
  if (mapped) candidates.push(String(mapped));
  candidates.push(raw);
  const embedded = (embeddedNames || []).filter(Boolean).map(String);

  // 1) Exact match
  for (const c of candidates) {
    const hit = embedded.find(e => e === c);
    if (hit) return hit;
  }

  // 2) Canonical/suffix match (ignore subset prefix and whitespace)
  for (const c of candidates) {
    const cc = canonicalFontName(c);
    if (!cc) continue;
    const hit = embedded.find(e => canonicalFontName(e) === cc);
    if (hit) return hit;
  }

  return null;
}

/** Nudge first character left so leading glyphs (e.g. "P" in "Publishing Credits") are not clipped on TOC/rect zones. */
const LEADING_OFFSET_LEFT = 10;

/** Expand clip polygon so leading/trailing glyphs are not cut off (e.g. "P" in "Publishing"). Use generous padding so re-exports always show full text. */
const CLIP_PAD_LEFT = 40;
const CLIP_PAD_TOP = 40;
const CLIP_PAD_RIGHT = 12;
const CLIP_PAD_BOTTOM = 12;

function expandClipPoints(points) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const xs = points.map(p => Number(Array.isArray(p) ? p[0] : p.x));
  const ys = points.map(p => Number(Array.isArray(p) ? p[1] : p.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [
    [minX - CLIP_PAD_LEFT, minY - CLIP_PAD_TOP],
    [maxX + CLIP_PAD_RIGHT, minY - CLIP_PAD_TOP],
    [maxX + CLIP_PAD_RIGHT, maxY + CLIP_PAD_BOTTOM],
    [minX - CLIP_PAD_LEFT, maxY + CLIP_PAD_BOTTOM]
  ];
}

/** Build clip rect from zone's line positions (where text is actually drawn) so the first character is never clipped. */
function getClipPointsForZone(zone) {
  const padL = CLIP_PAD_LEFT;
  const padT = CLIP_PAD_TOP;
  const padR = CLIP_PAD_RIGHT;
  const padB = CLIP_PAD_BOTTOM;
  if (Array.isArray(zone.lines) && zone.lines.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const fallbackW = Number(zone.w) || 100;
    const fallbackH = Number(zone.h) || (zone.fontSize || 12) * 1.2 * zone.lines.length;
    for (const line of zone.lines) {
      if (line.bbox && line.bbox.length >= 4) {
        minX = Math.min(minX, Number(line.bbox[0]));
        minY = Math.min(minY, Number(line.bbox[1]));
        maxX = Math.max(maxX, Number(line.bbox[2]));
        maxY = Math.max(maxY, Number(line.bbox[3]));
      }
      if (line.origin && line.origin.length >= 2) {
        const lx = Number(line.origin[0]);
        const ly = Number(line.origin[1]);
        minX = Math.min(minX, lx);
        minY = Math.min(minY, ly);
        const fs = (line.fontSize || zone.fontSize || 12);
        if (maxX === -Infinity) maxX = minX + fallbackW;
        if (maxY === -Infinity) maxY = minY + fallbackH;
        maxX = Math.max(maxX, lx + fallbackW / zone.lines.length);
        maxY = Math.max(maxY, ly + fs * 1.5);
      }
    }
    if (minX !== Infinity && maxX !== -Infinity) {
      return [
        [minX - padL, minY - padT],
        [maxX + padR, minY - padT],
        [maxX + padR, maxY + padB],
        [minX - padL, maxY + padB]
      ];
    }
  }
  if (zone.x != null && zone.y != null && zone.w != null && zone.h != null) {
    const zx = Number(zone.x);
    const zy = Number(zone.y);
    const zw = Number(zone.w);
    const zh = Number(zone.h);
    return [
      [zx - padL, zy - padT],
      [zx + zw + padR, zy - padT],
      [zx + zw + padR, zy + zh + padB],
      [zx - padL, zy + zh + padB]
    ];
  }
  return null;
}

/**
 * Generate CSS for zone-based FXL (smil-target + visible-word highlighting).
 * Used when using AI zoning and word/sentence sync.
 * fxlBodyFontFamily (optional) overrides embedded font choice and forces one font for all text.
 */
export function generateFxlCss(embeddedFonts = [], fxlBodyFontFamily) {
  const googleFonts = getGoogleFontImports();
  const fontFaces = (embeddedFonts || []).map(f => `
@font-face {
  font-family: "${f.name}";
  src: ${buildFontFaceSrc(f)};
  font-display: block;
}`).join('\n');

  const userOverride = typeof fxlBodyFontFamily === 'string' && fxlBodyFontFamily.trim()
    ? fxlBodyFontFamily.trim()
    : null;
  const embeddedNames = (embeddedFonts || []).map(f => (f && f.name != null) ? String(f.name) : '').filter(Boolean);
  const fallbackFont = pickDefaultEmbeddedFontName(embeddedNames) || 'Arial, sans-serif';
  // Only force one font when the user explicitly requests an override.
  // Otherwise, keep per-zone font families (e.g. Regular vs Bold) so "Publishing Credits" body text doesn't render bold.
  // Do NOT use !important so per-zone inline font-family (e.g. BlackSemiCn for "Publishing Credits") always wins.
  const forceFontRule = userOverride ? `
/* User override as fallback only; per-zone inline font-family overrides this */
.text-content text,
.text-content tspan,
.text-layer text,
.text-layer tspan {
  font-family: "${userOverride}";
}
` : `
/* Default font for safety (no !important so per-zone fonts can apply) */
.text-content text,
.text-content tspan,
.text-layer text,
.text-layer tspan {
  font-family: "${fallbackFont}";
}
`;

  return `${googleFonts}
${fontFaces}
${forceFontRule}

/* FXL page container — left align only; no justify; no injected word/letter spacing */
.page-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  text-align: left;
  text-align-last: left;
  word-spacing: normal;
  letter-spacing: normal;
}
.page-container img.page-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 0;
}
/* Reset Thorium default overlay so we control highlight */
:root {
  -epub-media-overlay-active-color: transparent !important;
}
.smil-target.-epub-media-overlay-active,
.smil-target.smilActive,
.smil-target.readium-smil-active {
  fill: #2196F3 !important;
  color: #2196F3 !important;
  opacity: 1 !important;
}
/* Optional: Background highlight for SVG text using a filter if needed, 
   but 'fill' change is the most robust across all readers. */
.text-content {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
  text-align: left;
  text-align-last: left;
  white-space: normal;
  word-spacing: normal;
  letter-spacing: normal;
}
.smil-target,
.visible-word {
  position: absolute;
  white-space: nowrap;
  color: #000;
  text-align: left;
  text-align-last: left;
  word-spacing: normal;
  letter-spacing: normal;
}
/* Avoid artificial gaps between word spans (do not use inline-block on FXL text spans) */
.word-wrapper .glyph,
.sentence-wrapper .glyph { display: inline; }
.visible-word {
  pointer-events: none;
}
`;
}

/**
 * Build coordinate-class CSS for classic PDF-reconstruction FXL.
 * Each unique left → .x0, .x1, ...; each unique top → .y0, .y1, ...; each unique font-size → .fs0, .fs1, ...
 * @param {{ left: number[], top: number[], fontSize: number[] }} coordinateMap - Arrays of unique values (e.g. from buildCoordinateMap).
 * @param {Array} embeddedFonts - Extracted/embedded fonts (for @font-face)
 * @param {string} fxlBodyFontFamily - Optional override font for all text
 * @returns {string} CSS content
 */
export function generateFxlCssClassic(coordinateMap, embeddedFonts = [], fxlBodyFontFamily) {
  if (!coordinateMap) return '';
  const googleFonts = getGoogleFontImports();
  const fontFaces = (embeddedFonts || []).map(f => `
@font-face {
  font-family: "${f.name}";
  src: ${buildFontFaceSrc(f)};
  font-display: block;
}`).join('\n');

  const userOverride = typeof fxlBodyFontFamily === 'string' && fxlBodyFontFamily.trim()
    ? fxlBodyFontFamily.trim()
    : null;
  const embeddedNames = (embeddedFonts || []).map(f => (f && f.name != null) ? String(f.name) : '').filter(Boolean);
  const fallbackFont = pickDefaultEmbeddedFontName(embeddedNames) || 'Arial, sans-serif';
  const forceFontRule = userOverride
    ? `/* User override as fallback only; per-zone inline font overrides */ .text-content text, .text-content tspan, .text-layer text, .text-layer tspan { font-family: "${userOverride}"; }`
    : `/* Default font (no !important) */ .text-content text, .text-content tspan, .text-layer text, .text-layer tspan { font-family: "${fallbackFont}"; }`;

  const lines = [
    googleFonts,
    fontFaces,
    forceFontRule,
    '/* Classic FXL: coordinate classes (PDF-reconstruction style) */',
    '.page-container { position: relative; width: 100%; height: 100%; overflow: hidden; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }',
    '.page-container img.page-bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; z-index: 0; }',
    '.text-content { position: absolute; left: 0; top: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; text-align: left; text-align-last: left; white-space: normal; word-spacing: normal; letter-spacing: normal; }',
    '.text-content .t { position: absolute; white-space: nowrap; margin: 0; padding: 0; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }',
    '/* Highlight for media overlay — blue fill */',
    '.t.-epub-media-overlay-active { color: #2196F3 !important; background: transparent !important; background-color: transparent !important; fill: #2196F3 !important; box-shadow: none !important; }'
  ];
  (coordinateMap.left || []).forEach((px, i) => {
    lines.push(`.x${i} { left: ${Math.round(px)}px; }`);
  });
  (coordinateMap.top || []).forEach((px, i) => {
    lines.push(`.y${i} { top: ${Math.round(px)}px; }`);
  });
  (coordinateMap.fontSize || []).forEach((px, i) => {
    lines.push(`.fs${i} { font-size: ${Math.round(px)}px; }`);
  });
  return lines.join('\n');
}

/**
 * Default CSS for reference-style FXL (matches 14600 structure: #page-container, .pf, .pc, .bi, .t).
 * Use as OPS/default.css.
 */
export function generateDefaultCssReference() {
  return `html { color: #000; background: #FFF; }
body, div, ol, li, h1 { margin: 0; padding: 0; }
img { border: 0; }
/* FXL: left align only — no justify; no injected word/letter spacing */
#page-container { position: absolute; top: 0; left: 0; margin: 0; padding: 0; border: 0; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }
@media screen { #page-container { bottom: 0; right: 0; } }
.pf { position: relative; background-color: white; overflow: hidden; margin: 0; border: 0; text-align: left; text-align-last: left; white-space: normal; word-spacing: normal; letter-spacing: normal; }
.pc { position: absolute; border: 0; padding: 0; margin: 0; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; display: block; transform-origin: 0 0; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }
.bi { position: absolute; border: none !important; outline: none !important; margin: 0; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; z-index: 0; }
.t { position: absolute; white-space: nowrap; overflow: visible; margin: 0; padding: 0; z-index: 1; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }
.pi { display: none; }
.-epub-media-overlay-active, .active, .highlight, .smilActive, .readium-smil-active { 
  background: transparent !important;
  background-color: transparent !important;
  fill: #2196F3 !important;
  color: #2196F3 !important;
  box-shadow: none !important;
}
.w0 { width: 100%; }
.h0 { height: 100%; }
`;
}

/**
 * Generate per-page CSS for reference-style FXL: one rule per fragment by ID.
 * Use as OPS/page-NNNN.css.
 * @param {Array<{ id: string, left: number, top: number, fontSize?: number }>} fragments
 * @returns {string}
 */
export function generatePageCssForFragments(fragments) {
  if (!fragments || fragments.length === 0) return '/* no fragments */\n';
  const lines = fragments.map(f => {
    const id = (f.id != null ? String(f.id) : '').replace(/"/g, '');
    const left = Math.round(Number(f.left) ?? 0);
    const top = Math.round(Number(f.top) ?? 0);
    const fs = f.fontSize != null ? Math.round(Number(f.fontSize)) : null;
    let rule = `#${id}{left:${left}px;top:${top}px;`;
    if (fs != null && fs > 0) rule += `font-size:${fs}px;`;
    rule += '}';
    return rule;
  });
  return lines.join('\n');
}

/**
 * Generate reference-style XHTML page (matches 14600: section, page-container, pf, pc, img.bi, div.t).
 * Uses default.css + style.css + page-NNNN.css. Image path = images/bgN (N = page number).
 * @param {{ width: number, height: number, imageName: string, pageNum: number }} pageData
 * @param {Array<{ id: string, text: string }>} fragments - Must have id and text (or content).
 * @param {string} pageCssHref - e.g. "page-0001.css"
 */
export function generateFxlPageReference(pageData, fragments, pageCssHref) {
  const width = pageData.width || 1200;
  const height = pageData.height || 1600;
  const pageNum = pageData.pageNum ?? 1;
  const imagePath = pageData.imagePath || `images/bg${pageNum}.webp`;
  const safeCssHref = escapeXml(pageCssHref || `page-${String(pageNum).padStart(4, '0')}.css`);
  const divs = (fragments || [])
    .map(f => {
      const id = (f.id != null ? String(f.id) : '').replace(/"/g, '&quot;');
      const text = escapeXml(f.text || f.content || '');
      return `            <div class="t" id="${id}">${text}</div>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en-US" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <link rel="stylesheet" type="text/css" href="default.css" />
    <link rel="stylesheet" type="text/css" href="style.css" />
    <link rel="stylesheet" type="text/css" href="${safeCssHref}" />
    <title>Page ${pageNum}</title>
  </head>
  <body epub:type="bodymatter">
    <section>
      <span id="pg_${pageNum}" title="${pageNum}" xmlns="http://www.w3.org/1999/xhtml" style="display: none"></span>
      <div id="page-container" xmlns="http://www.w3.org/1999/xhtml">
        <div id="pf${pageNum}" class="pf w0 h0" data-page-no="${pageNum}">
          <div class="pc pc${pageNum} w0 h0">
            <img class="bi w0 h0" alt="" src="${escapeXml(imagePath)}" />
${divs}
          </div>
          <div class="pi" data-data='{"ctm":[1,0,0,1,0,0]}'></div>
        </div>
      </div>
    </section>
  </body>
</html>`;
}

/**
 * Generate SMIL in reference style (SMIL 3.0, body/par, relative paths from smil/ folder).
 * @param {string} pageXhtmlName - e.g. "page-0001.xhtml"
 * @param {string} audioHref - e.g. "../audio/page-0001.mp3" or null if no audio
 * @param {Array<{ id: string, startTime: number, endTime: number }>} fragments
 */
export function generateFxlSmilReference(pageXhtmlName, audioHref, fragments) {
  const textSrc = `../${pageXhtmlName}`;
  const parElements = (fragments || []).map((f, i) => {
    const begin = (f.startTime != null ? Number(f.startTime) : 0).toFixed(6);
    const end = (f.endTime != null ? Number(f.endTime) : 0).toFixed(6);
    const audioTag = audioHref
      ? `<audio src="${escapeXml(audioHref)}" clipBegin="${begin}s" clipEnd="${end}s" />`
      : '';
    return `		<par id="par${i + 1}"><text src="${textSrc}#${escapeXml(String(f.id))}"/>${audioTag}</par>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
	<body>
${parElements}
	</body>
</smil>`;
}

/**
 * Build coordinate map from layout fragments (unique left, top, fontSize) and assign class indices to each fragment.
 * @param {Array<{ left: number, top: number, fontSize: number }>} fragments
 * @returns {{ coordinateMap: { left: number[], top: number[], fontSize: number[] }, fragmentsWithClasses: Array<{ classX: string, classY: string, classFs: string }> }}
 */
export function buildCoordinateMap(fragments) {
  const leftSet = new Set();
  const topSet = new Set();
  const fontSizeSet = new Set();
  fragments.forEach(f => {
    if (f.left != null) leftSet.add(f.left);
    if (f.top != null) topSet.add(f.top);
    if (f.fontSize != null) fontSizeSet.add(f.fontSize);
  });
  const leftArr = [...leftSet].sort((a, b) => a - b);
  const topArr = [...topSet].sort((a, b) => a - b);
  const fontSizeArr = [...fontSizeSet].sort((a, b) => a - b);
  const leftIdx = Object.fromEntries(leftArr.map((v, i) => [v, i]));
  const topIdx = Object.fromEntries(topArr.map((v, i) => [v, i]));
  const fsIdx = Object.fromEntries(fontSizeArr.map((v, i) => [v, i]));
  const fragmentsWithClasses = fragments.map(f => ({
    classX: 'x' + (leftIdx[f.left] ?? 0),
    classY: 'y' + (topIdx[f.top] ?? 0),
    classFs: 'fs' + (fsIdx[f.fontSize] ?? 0)
  }));
  return {
    coordinateMap: { left: leftArr, top: topArr, fontSize: fontSizeArr },
    fragmentsWithClasses
  };
}

/**
 * Convert a numeric coordinate to a CSS-safe class suffix (e.g. 72.5 → "72_50", -10.25 → "m10_25").
 * @param {number} coord
 * @returns {string}
 */
function coordToClassSuffix(coord) {
  const n = Number(coord);
  const s = (n < 0 ? 'm' + (-n).toFixed(2) : n.toFixed(2)).replace('.', '_');
  return s.replace(/-/g, '');
}

/**
 * Generate one FXL XHTML page.
 * Supports:
 * - Zone-based: pageData + zones (id, content, x, y, w, h, readingOrder), options.syncLevel → smil-target + visible-word spans with inline styles.
 * - Classic layout: pageData + fragments (id, text, classX, classY, classFs), options.classicLayout = true → <div id="page"><img/><div class="t x34 y118 fs3" id="t102">Hello</div></div>.
 * - Absolute HTML: options.renderMode === 'absolute-html' → pdf2htmlEX-style absolute <div class="t"> with CSS coord/font classes (no SVG).
 *
 * @param {{ width: number, height: number, imageName: string, pageNum: number }} pageData
 * @param {Array} zonesOrFragments - Zones (content, id, x, y, w, h) or classic fragments (id, text, classX, classY, classFs).
 * @param {{ syncLevel?: string, classicLayout?: boolean, renderMode?: string }} options
 * @returns {string} XHTML string
 */
export function generateFxlPage(pageData, zonesOrFragments, options = {}) {
  const { syncLevel = 'sentence', classicLayout = false, transparentText = false, fontMap = {}, renderMode, extractedFonts = [], extractionLevel, pageCssHref, fxlBodyFontFamily } = options;
  const width = pageData.width || 1200;
  const height = pageData.height || 1600;
  const imageName = pageData.imageName || 'page_1.webp';
  const imagePath = `images/${imageName}`;
  const pageNum = pageData.pageNum ?? 1;

  // Absolute HTML (pdf2htmlEX-style): one .t per fragment at its own (x,y). No layout grouping.
  // When extractionLevel === 'glyph': glyphs have no ID (layout only); SMIL targets invisible word/sentence wrappers.
  if (renderMode === 'absolute-html' && Array.isArray(zonesOrFragments) && zonesOrFragments.length > 0) {
    const isGlyphMode = extractionLevel === 'glyph' && zonesOrFragments.some(z => (z.word_id ?? z.wordId) != null);
    const sortedZones = (zonesOrFragments || [])
      .filter(z => (z.content || z.text || '').trim().length > 0 || (z.lines && z.lines.some(l => (l.text || '').trim().length > 0)) || (isGlyphMode && (z.text || '').length > 0))
      .sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));

    const getFontSize = (z) => z.fontSize || z.size || 12;
    // Use only exact @font-face names so browser never falls back (no cleaned name, no alias). Must match font-family in @font-face exactly.
    const embeddedNames = (extractedFonts || []).map(f => (f && f.name) != null ? String(f.name) : '').filter(Boolean);
    const getFontFamily = (z) => {
      const raw = (z.fontFamily != null ? String(z.fontFamily) : (z.font != null ? String(z.font) : ''));
      if (embeddedNames.length > 0) {
        if (raw && embeddedNames.includes(raw)) return raw;
        const mapped = fontMap[z.fontFamily || z.font];
        if (mapped && embeddedNames.includes(mapped)) return mapped;
        return embeddedNames[0];
      }
      return fontMap[z.fontFamily || z.font] || resolveFontFamily(raw || 'Arial');
    };

    // Step 1 — Flatten zones into fragments, or use glyph-level items as-is.
    const fragments = [];
    if (isGlyphMode) {
      // Already glyph-level: each item has text (one char), word_id, sentence_id, origin or bbox, size, font, color.
      // Use bbox top-left for position when available so glyph div aligns with wrapper (both top-based). Using origin (baseline) would place the div above the wrapper and make the highlight appear below the text in readers.
      for (const z of sortedZones) {
        const text = normalizeSpaces((z.text || z.content || '').toString().trim());
        if (text.length === 0) continue;
        const bbox = (z.bbox && Array.isArray(z.bbox) && z.bbox.length >= 4)
          ? [Number(z.bbox[0]), Number(z.bbox[1]), Number(z.bbox[2]), Number(z.bbox[3])]
          : null;
        const ox = bbox ? bbox[0] : (z.origin && z.origin[0] != null ? z.origin[0] : z.x ?? z.left ?? 0);
        const oy = bbox ? bbox[1] : (z.origin && z.origin[1] != null ? z.origin[1] : z.bbox && z.bbox[1] != null ? z.bbox[1] : z.y ?? z.top ?? 0);
        fragments.push({
          x: Number(ox),
          y: Number(oy),
          text,
          id: null,
          fs: getFontSize(z),
          ff: getFontFamily(z),
          color: z.color,
          wordId: z.word_id ?? z.wordId ?? null,
          sentenceId: z.sentence_id ?? z.sentenceId ?? null,
          bbox
        });
      }
    } else {
      for (const z of sortedZones) {
        const fs = getFontSize(z);
        const ff = getFontFamily(z);
        const zoneId = (z.id != null && String(z.id).trim() !== '') ? String(z.id) : null;
        if (z.lines && z.lines.length > 1) {
          const lineHeight = fs * 1.2;
          z.lines.forEach((line, lineIdx) => {
            const lx = (line.origin && line.origin[0] != null) ? Number(line.origin[0]) : (line.bbox && line.bbox.length >= 4 ? Number(line.bbox[0]) : Number(z.x ?? z.left ?? 0));
            const ly = (line.origin && line.origin[1] != null) ? Number(line.origin[1]) : (line.bbox && line.bbox.length >= 4 ? Number(line.bbox[1]) : Number(z.y ?? z.top ?? 0) + lineIdx * lineHeight);
            const text = normalizeSpaces((line.text || '').trim());
            if (text.length > 0) {
              fragments.push({
                x: lx,
                y: ly,
                text,
                id: lineIdx === 0 ? zoneId : null,
                zoneId,
                fs,
                ff,
                color: line.color || z.color,
                wordId: z.word_id ?? z.wordId ?? null,
                sentenceId: z.sentence_id ?? z.sentenceId ?? null
              });
            }
          });
        } else {
          const text = normalizeSpaces((z.content || z.text || '').trim());
          if (text.length > 0) {
            fragments.push({
              x: Number(z.x ?? z.left ?? 0),
              y: Number(z.y ?? z.top ?? 0),
              text,
              id: zoneId,
              zoneId,
              fs,
              ff,
              color: z.color,
              wordId: z.word_id ?? z.wordId ?? null,
              sentenceId: z.sentence_id ?? z.sentenceId ?? null
            });
          }
        }
      }
    }

    // Step 2 — Sort for stable reading order.
    fragments.sort((a, b) => {
      if (Math.abs(a.y - b.y) >= 2) return a.y - b.y;
      return a.x - b.x;
    });

    // Build coordinate/font class sets from fragments (one .t per fragment).
    const leftSet = new Set();
    const topSet = new Set();
    const fsSet = new Set();
    const ffSet = new Set();
    fragments.forEach(f => {
      leftSet.add(f.x);
      topSet.add(f.y);
      fsSet.add(f.fs);
      ffSet.add(f.ff);
    });
    const ffArr = [...ffSet];
    const ffIndex = Object.fromEntries(ffArr.map((v, i) => [v, i]));

    // Absolute HTML: geometry-only spacing. Layout must not be altered so PDF advance matches.
    // line-height: 1 so glyph top aligns with div top (no extra gap that would shift highlight vs text).
    const pageCssLines = [
      '.t { position: absolute; white-space: nowrap; overflow: visible; transform-origin: 0 0; margin: 0; padding: 0; z-index: 1; line-height: 1; text-rendering: geometricPrecision; -moz-font-feature-settings: "liga" 0; font-feature-settings: "liga" 0; font-kerning: none; letter-spacing: normal; word-spacing: normal; text-align: left; text-align-last: left; }',
      '.t.-epub-media-overlay-active, .t.smilActive, .t.readium-smil-active, .smil-target.-epub-media-overlay-active, .smil-target.smilActive, .smil-target.readium-smil-active { color: #2196F3 !important; fill: #2196F3 !important; }'
    ];
    if (isGlyphMode) {
      pageCssLines.push('.word-wrapper, .sentence-wrapper { position: absolute; pointer-events: none; z-index: 2; box-sizing: border-box; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }');
      pageCssLines.push('.word-wrapper .glyph, .sentence-wrapper .glyph { display: inline; }');
      // Blue text highlight when active (like reference: word turns blue, no background box)
      pageCssLines.push('.word-wrapper.-epub-media-overlay-active .t, .word-wrapper.smilActive .t, .word-wrapper.readium-smil-active .t, .sentence-wrapper.-epub-media-overlay-active .t, .sentence-wrapper.smilActive .t, .sentence-wrapper.readium-smil-active .t { color: #2196F3 !important; fill: #2196F3 !important; }');
    } else {
      // Sentence-level (zone-based) also uses .sentence-wrapper so SMIL targets the whole sentence.
      pageCssLines.push('.sentence-wrapper { position: absolute; pointer-events: none; z-index: 2; box-sizing: border-box; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }');
      pageCssLines.push('.sentence-wrapper .t { position: absolute; }');
      pageCssLines.push('.sentence-wrapper.-epub-media-overlay-active .t, .sentence-wrapper.smilActive .t, .sentence-wrapper.readium-smil-active .t { color: #2196F3 !important; fill: #2196F3 !important; }');
    }
    [...leftSet].sort((a, b) => a - b).forEach(px => {
      pageCssLines.push(`.x${coordToClassSuffix(px)} { left: ${Number(px).toFixed(2)}px; }`);
    });
    [...topSet].sort((a, b) => a - b).forEach(px => {
      pageCssLines.push(`.y${coordToClassSuffix(px)} { top: ${Number(px).toFixed(2)}px; }`);
    });
    [...fsSet].sort((a, b) => a - b).forEach(px => {
      pageCssLines.push(`.fs${coordToClassSuffix(px)} { font-size: ${Number(px).toFixed(2)}px; }`);
    });
    ffArr.forEach((name, i) => {
      pageCssLines.push(`.ff${i} { font-family: "${escapeXml(String(name))}"; }`);
    });

    // Step 3 — One .t per fragment. In glyph mode: wrap each word's glyphs inside the SMIL target so active class turns text blue.
    const renderGlyph = (f, relX, relY) => {
      const text = normalizeSpaces((f.text != null ? String(f.text) : '').trim());
      if (text.length === 0) return '';
      const fsClass = 'fs' + coordToClassSuffix(f.fs);
      const ffClass = 'ff' + ffIndex[f.ff];
      const colorStyle = !transparentText && f.color && f.color !== '#000000' ? ` color: ${escapeXml(f.color)};` : '';
      const styleAttr = `left:${Number(relX).toFixed(2)}px;top:${Number(relY).toFixed(2)}px;${colorStyle}`;
      return `        <div class="t ${ffClass} ${fsClass}" style="${styleAttr}"><span class="glyph">${escapeXml(text)}</span></div>`;
    };
    const renderStandaloneDiv = (f) => {
      const text = normalizeSpaces((f.text != null ? String(f.text) : '').trim());
      if (text.length === 0) return '';
      const xClass = 'x' + coordToClassSuffix(f.x);
      const yClass = 'y' + coordToClassSuffix(f.y);
      const fsClass = 'fs' + coordToClassSuffix(f.fs);
      const ffClass = 'ff' + ffIndex[f.ff];
      const colorStyle = !transparentText && f.color && f.color !== '#000000' ? ` color: ${escapeXml(f.color)};` : '';
      const classList = `t ${xClass} ${yClass} ${ffClass} ${fsClass}`;
      const styleAttr = colorStyle ? ` style="${colorStyle}"` : '';
      return `      <div class="${classList}"${styleAttr}><span class="glyph">${escapeXml(text)}</span></div>`;
    };

    let bodyBlocks = [];
    if (isGlyphMode && fragments.some(f => (f.wordId ?? f.sentenceId) != null)) {
      const byWord = new Map();
      fragments.forEach((f, fragIdx) => {
        const wid = f.wordId ?? f.word_id;
        if (wid != null) {
          if (!byWord.has(wid)) byWord.set(wid, []);
          byWord.get(wid).push({ f, idx: fragIdx });
        }
      });
      const groups = [...byWord.entries()].map(([wid, list]) => ({ key: wid, list, minIdx: Math.min(...list.map(o => o.idx)) }));
      groups.sort((a, b) => a.minIdx - b.minIdx);
      const prefix = `p${pageNum}_w`;
      const blocks = [
        ...groups.map((g, wordIdx) => ({ type: 'word', minIdx: g.minIdx, group: g, wordIdx })),
        ...fragments.map((f, i) => (f.wordId ?? f.word_id) == null ? { type: 'standalone', minIdx: i, frag: f } : null).filter(Boolean)
      ].sort((a, b) => a.minIdx - b.minIdx);

      blocks.forEach(bl => {
        if (bl.type === 'standalone') {
          bodyBlocks.push(renderStandaloneDiv(bl.frag));
          return;
        }
        const grp = bl.group;
        const list = grp.list;
        const frags = list.map(o => o.f);
        const leftTopRightBottom = frags.map(f => {
          if (f.bbox && f.bbox.length >= 4) {
            return { left: f.bbox[0], top: f.bbox[1], right: f.bbox[2], bottom: f.bbox[3] };
          }
          const fs = f.fs || 12;
          return { left: f.x, top: f.y, right: f.x + fs * 0.65, bottom: f.y + fs * 1.2 };
        });
        const x0 = Math.min(...leftTopRightBottom.map(r => r.left));
        const y0 = Math.min(...leftTopRightBottom.map(r => r.top));
        const x1 = Math.max(...leftTopRightBottom.map(r => r.right));
        const y1 = Math.max(...leftTopRightBottom.map(r => r.bottom));
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const wordIdx = bl.wordIdx;
        const inner = frags.map(f => renderGlyph(f, f.x - x0, f.y - y0)).filter(Boolean).join('\n');
        bodyBlocks.push(`      <span id="${prefix}${wordIdx}" class="smil-target word-wrapper" style="left:${Number(x0).toFixed(2)}px;top:${Number(y0).toFixed(2)}px;width:${Number(w).toFixed(2)}px;height:${Number(h).toFixed(2)}px;">
${inner}
      </span>`);
      });
    } else {
      // Non–glyph mode: zone-based (e.g. sentence level). Group fragments by zoneId so whole sentence is one SMIL target.
      const hasZoneIds = fragments.some(f => f.zoneId != null);
      if (hasZoneIds) {
        const byZone = new Map();
        fragments.forEach(f => {
          const key = f.zoneId ?? '__nozone__';
          if (!byZone.has(key)) byZone.set(key, []);
          byZone.get(key).push(f);
        });
        const zoneBlocks = [];
        byZone.forEach((group, key) => {
          if (key === '__nozone__' || group.length === 0) return;
          const first = group[0];
          const minY = Math.min(...group.map(g => g.y));
          const minX = Math.min(...group.map(g => g.x));
          zoneBlocks.push({ type: 'zone', zoneId: first.zoneId, group, minY, minX });
        });
        zoneBlocks.sort((a, b) => (Math.abs(a.minY - b.minY) >= 2 ? a.minY - b.minY : a.minX - b.minX));
        const standalone = (byZone.get('__nozone__') || []).map(f => ({ type: 'frag', f, minY: f.y, minX: f.x }));
        const allBlocks = [...zoneBlocks, ...standalone].sort((a, b) => (Math.abs(a.minY - b.minY) >= 2 ? a.minY - b.minY : a.minX - b.minX));
        bodyBlocks = allBlocks.map(bl => {
          if (bl.type === 'frag') {
            const f = bl.f;
            const text = normalizeSpaces((f.text != null ? String(f.text) : '').trim());
            if (text.length === 0) return '';
            const xClass = 'x' + coordToClassSuffix(f.x);
            const yClass = 'y' + coordToClassSuffix(f.y);
            const fsClass = 'fs' + coordToClassSuffix(f.fs);
            const ffClass = 'ff' + ffIndex[f.ff];
            const colorStyle = !transparentText && f.color && f.color !== '#000000' ? ` color: ${escapeXml(f.color)};` : '';
            return `      <div class="t ${xClass} ${yClass} ${ffClass} ${fsClass}"${colorStyle ? ` style="${colorStyle}"` : ''}><span class="glyph">${escapeXml(text)}</span></div>`;
          }
          const group = bl.group;
          const first = group[0];
          const zoneId = (first.zoneId || '').replace(/"/g, '&quot;');
          // True content bbox: union of all glyph bounds (not just origin). Wrapper width/height must match so highlight covers full text.
          const bounds = group.map(g => {
            if (g.bbox && g.bbox.length >= 4) {
              return { left: g.bbox[0], top: g.bbox[1], right: g.bbox[2], bottom: g.bbox[3] };
            }
            const fs = g.fs || 12;
            return { left: g.x, top: g.y, right: g.x + fs * 0.65, bottom: g.y + fs * 1.2 };
          });
          const x0 = Math.min(...bounds.map(b => b.left));
          const y0 = Math.min(...bounds.map(b => b.top));
          const x1 = Math.max(...bounds.map(b => b.right));
          const y1 = Math.max(...bounds.map(b => b.bottom));
          const w = Math.max(1, x1 - x0);
          const h = Math.max(1, y1 - y0);
          const inner = group.map(g => {
            const text = normalizeSpaces((g.text != null ? String(g.text) : '').trim());
            if (text.length === 0) return '';
            const relX = g.x - x0;
            const relY = g.y - y0;
            const fsClass = 'fs' + coordToClassSuffix(g.fs);
            const ffClass = 'ff' + ffIndex[g.ff];
            const colorStyle = !transparentText && g.color && g.color !== '#000000' ? ` color: ${escapeXml(g.color)};` : '';
            return `        <div class="t ${ffClass} ${fsClass}" style="left:${Number(relX).toFixed(2)}px;top:${Number(relY).toFixed(2)}px;${colorStyle}"><span class="glyph">${escapeXml(text)}</span></div>`;
          }).filter(Boolean).join('');
          return `      <span id="${zoneId}" class="smil-target sentence-wrapper" style="left:${Number(x0).toFixed(2)}px;top:${Number(y0).toFixed(2)}px;width:${Number(w).toFixed(2)}px;height:${Number(h).toFixed(2)}px;">
${inner}
      </span>`;
        }).filter(Boolean);
      } else {
        bodyBlocks = fragments.map(f => {
          const text = normalizeSpaces((f.text != null ? String(f.text) : '').trim());
          if (text.length === 0) return '';
          const xClass = 'x' + coordToClassSuffix(f.x);
          const yClass = 'y' + coordToClassSuffix(f.y);
          const fsClass = 'fs' + coordToClassSuffix(f.fs);
          const ffClass = 'ff' + ffIndex[f.ff];
          const colorStyle = !transparentText && f.color && f.color !== '#000000' ? ` color: ${escapeXml(f.color)};` : '';
          const classList = `t ${xClass} ${yClass} ${ffClass} ${fsClass}`;
          const styleAttr = colorStyle ? ` style="${colorStyle}"` : '';
          const useSmilIdOnSpan = (f.id != null && String(f.id).trim() !== '');
          const id = useSmilIdOnSpan ? (f.id != null ? String(f.id) : '').replace(/"/g, '&quot;') : '';
          const inner = useSmilIdOnSpan && id
            ? `<span id="${id}" class="smil-target">${escapeXml(text)}</span>`
            : `<span class="glyph">${escapeXml(text)}</span>`;
          return `      <div class="${classList}"${styleAttr}>${inner}</div>`;
        }).filter(Boolean);
      }
    }

    const pageCss = pageCssLines.join('\n');
    const baseStyle = `    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    /* FXL: left align only — no justify; no injected word/letter spacing */
    .page-container { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; margin: 0 auto; text-align: left; text-align-last: left; word-spacing: normal; letter-spacing: normal; }
    .pf { position: relative; width: 100%; height: 100%; text-align: left; text-align-last: left; white-space: normal; word-spacing: normal; letter-spacing: normal; }
    /* fill: text coords match page pixel space; contain letterboxed the image vs overlays */
    .bi { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0; }`;
    // Join with no whitespace between </span> and <span> so browser doesn't render a sliver of space between word wrappers.
    const xhtmlBody = `<body epub:type="bodymatter">
  <div class="page-container">
    <div class="pf">
      <img class="bi" alt="" src="${escapeXml(imagePath)}"/>
${bodyBlocks.join('')}
    </div>
  </div>
</body>
</html>`;
    if (pageCssHref) {
      return {
        xhtml: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <title>Page ${pageData.pageNum ?? 1}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <link rel="stylesheet" type="text/css" href="${escapeXml(pageCssHref)}"/>
  <style>
${baseStyle}
  </style>
</head>
${xhtmlBody}`,
        pageCss
      };
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <title>Page ${pageData.pageNum ?? 1}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <style>
${baseStyle}
    ${pageCss}
  </style>
</head>
${xhtmlBody}`;
  }

  if (classicLayout && Array.isArray(zonesOrFragments) && zonesOrFragments.length > 0) {
    const fragments = zonesOrFragments;

    const svgTextItems = fragments.map(f => {
      const id = (f.id != null ? String(f.id) : '').replace(/"/g, '&quot;');
      const text = escapeXml(f.text || f.content || '');
      const x = Math.round(Number(f.left ?? 0));
      const y = Math.round(Number(f.top ?? 0));
      const fontSize = f.fontSize || 12;
      const fontFamily = fontMap[f.fontFamily] || resolveFontFamily(f.fontFamily || 'Arial');
      const fill = transparentText ? 'transparent' : '#000000';

      let style = `font-family:${fontFamily};font-size:${fontSize}px;fill:${fill};dominant-baseline:hanging;`;
      return `<text id="${id}" x="${x}" y="${y}" style="${style}">${text}</text>`;
    }).join('\n    ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <title>Page ${pageData.pageNum ?? 1}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <style>
    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    .page-container { 
      position: relative; 
      width: ${width}px; 
      height: ${height}px; 
      overflow: hidden; 
      margin: 0 auto; 
    }
    .main-svg { 
      position: absolute; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
    }
  </style>
</head>
<body>
  <div class="page-container">
    <svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${width} ${height}" class="main-svg" preserveAspectRatio="xMidYMid meet">
      <image width="${width}" height="${height}" href="${escapeXml(imagePath)}" />
      <g class="text-layer">
    ${svgTextItems}
      </g>
    </svg>
  </div>
</body>
</html>`;
  }

  // Pure SVG Text Layer Method (Professional FXL)
  const hasZoneText = (z) => {
    if ((z.content || z.text || '').trim().length > 0) return true;
    if (z.lines && Array.isArray(z.lines)) return z.lines.some(l => (l.text || '').trim().length > 0);
    return false;
  };
  const sortedZones = (zonesOrFragments || [])
    .filter(z => hasZoneText(z))
    .sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));

  const svgTextItems = [];
  const startsWithPunct = (s) => /^[.,;:?!'")\]\-\/]/.test((s || '').trim());
  const endsWithPunct = (s) => /[.,;:?!'"(\[\-\/]$/.test((s || '').trim());

  /**
   * Shared rule for space between style runs (any bold/italic/color run boundary).
   * Use everywhere we output run-styled tspans so "word" + "word" never runs together.
   * - Include gap from content when it's whitespace (1–3 chars).
   * - Else if current doesn't end with space and next doesn't start with space/punct, append nbsp.
   */
  const runSegmentWithSpace = (fullContent, run, nextRun, lineEnd, normalizeFn) => {
    let end = run.end;
    if (nextRun && nextRun.start > run.end && nextRun.start <= fullContent.length) {
      const gap = fullContent.slice(run.end, nextRun.start);
      if (/^\s*$/.test(gap) && gap.length >= 1 && gap.length <= 3) end = nextRun.start;
    }
    const segText = fullContent.slice(run.start, end);
    const displayBase = normalizeFn(segText);
    const nextRunText = nextRun ? fullContent.slice(nextRun.start, Math.min(nextRun.end, lineEnd ?? fullContent.length)).trim() : '';
    const needSpaceAfter = nextRun && displayBase.length > 0 && !/\s$/.test(displayBase) && nextRunText.length > 0 && !/^[\s.,;:?!'"(\[\-\/]/.test(nextRunText);
    return { displayText: displayBase + (needSpaceAfter ? '\u00A0' : ''), segText };
  };

  // Sentence-level: ONE <text> per PARAGRAPH. FXL overlay with textLength + lengthAdjust so each fragment fits exactly currentX → nextFragmentX.
  if (syncLevel === 'sentence' && sortedZones.length > 0) {
    const isCreditsPage = sortedZones.some((z) => /Publishing Credits|Image Credits|Consultant/i.test((z.content || z.text || '')));
    const paraGap = 20;
    const normalizeFragmentText = (s) =>
      normalizeCommonTruncations(
        normalizeAbbreviationCorruption((s || '')
          .replace(/\s+/g, ' ')
          .replace(/\s+([.,;:?!'")\]\-\/])/g, '$1')
          .trim())
      );
    const paragraphs = [];
    let currentPara = [];
    let lastY = -999;
    for (const zone of sortedZones) {
      const y = Number(zone.y ?? zone.top ?? 0);
      if (currentPara.length > 0 && y - lastY > paraGap) {
        paragraphs.push(currentPara);
        currentPara = [];
      }
      currentPara.push(zone);
      lastY = y;
    }
    if (currentPara.length > 0) paragraphs.push(currentPara);
    // One font for the entire page so every paragraph uses the same family (no serif/sans mix)
    const embeddedFontNames = (extractedFonts || []).map(f => (f && f.name != null) ? String(f.name) : '').filter(Boolean);
    const pageFontFamily = (typeof fxlBodyFontFamily === 'string' && fxlBodyFontFamily.trim())
      ? fxlBodyFontFamily.trim()
      : (pickDefaultEmbeddedFontName(embeddedFontNames) || 'Arial');
    for (const paraZones of paragraphs) {
      if (paraZones.length === 0) continue;

      // Merge all consecutive URL parts on the same line into one zone (e.g. "http://www." + "tcmpub." + "com" -> "http://www.tcmpub.com").
      const mergedParaZones = [];
      let i = 0;
      while (i < paraZones.length) {
        let z = paraZones[i];
        let mergedContent = (z.content || z.text || '').trim();
        let zx = Number(z.x ?? z.left ?? 0);
        let lastX = zx;
        let lastW = Number(z.w ?? z.width ?? 0);
        const zy = Number(z.y ?? z.top ?? 0);
        const fSize = Number(z.fontSize) || 12;
        i++;
        while (i < paraZones.length) {
          const next = paraZones[i];
          const nextZy = Number(next.y ?? next.top ?? 0);
          const nextContent = (next.content || next.text || '').trim();
          const sameLine = Math.abs(nextZy - zy) < Math.min(fSize * 0.5, 6);
          if (!sameLine) break;
          if (/\.\s*$/.test(mergedContent) && /^(com|org|net)$/i.test(nextContent)) {
            mergedContent = mergedContent.replace(/\s*\.\s*$/, '') + '.' + nextContent;
            lastX = Number(next.x ?? next.left ?? 0);
            lastW = Number(next.w ?? next.width ?? 0);
            i++;
            break;
          }
          if (/\.\s*$/.test(mergedContent) && nextContent.endsWith('.') && !/\s/.test(nextContent)) {
            mergedContent = mergedContent.replace(/\s*\.\s*$/, '') + '.' + nextContent;
            lastX = Number(next.x ?? next.left ?? 0);
            lastW = Number(next.w ?? next.width ?? 0);
            i++;
          } else break;
        }
        const mergedZone = { ...z, content: mergedContent, text: mergedContent };
        mergedZone.w = (lastX + lastW) - zx;
        mergedZone.width = mergedZone.w;
        mergedParaZones.push(mergedZone);
      }

      const firstZone = mergedParaZones[0];
      const zx = Number(firstZone.x ?? firstZone.left ?? 0);
      const zy = Number(firstZone.y ?? firstZone.top ?? 0);
      // Use max of all zone font sizes so headings (e.g. "Publishing Credits") in the same paragraph as body text get correct size
      const defFontSize = Math.max(12, ...mergedParaZones.map(z => Number(z.fontSize) || 12));
      const lineYThreshold = defFontSize * 0.5;
      const defFontFamily = pageFontFamily;
      const defFill = transparentText ? 'transparent' : (firstZone.color || '#000000');
      // Keep <text> neutral; each zone/tspan is responsible for its own weight/style. !important so reader CSS does not override.
      let textStyle = `${cssFontFamilyDecl(defFontFamily, true)}font-size:${defFontSize}px !important;fill:${defFill};opacity:1;dominant-baseline:text-before-edge;font-weight:normal;font-style:normal;`;
      const rotation = (firstZone.origin && firstZone.origin[2]) ? firstZone.origin[2] : 0;
      const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${zx.toFixed(2)} ${zy.toFixed(2)})"` : '';

      const allFragments = [];
      const fragmentsByZone = [];
      for (let i = 0; i < mergedParaZones.length; i++) {
        const z = mergedParaZones[i];
        const zoneFragments = [];
        const fSize = z.fontSize || 12;
        if (z.lines && z.lines.length > 1) {
          // Use zone.content (Studio "Text Content (OCR)") when set, so edits apply to EPUB
          const contentOverride = (z.content || z.text || '').trim();
          // On credits pages only: when OCR is one logical line but glyph grouping produced multiple z.lines, line.text is from PDF and can be wrong (e.g. "Ph." + "-" instead of "Ph.D.", or URL fragments).
          // Prefer zone content: if content has no newline, emit one fragment from zone.content and first/last line geometry — do not use line.text.
          const isSingleLineContent = contentOverride && !contentOverride.includes('\n');
          if (isSingleLineContent && isCreditsPage) {
            const first = z.lines[0];
            const last = z.lines[z.lines.length - 1];
            const lx = (first.origin && first.origin[0] != null) ? Number(first.origin[0]) : (first.bbox && first.bbox.length >= 4 ? Number(first.bbox[0]) : Number(z.x ?? z.left ?? zx));
            const ly = (first.origin && first.origin[1] != null) ? Number(first.origin[1]) : (first.bbox && first.bbox.length >= 4 ? Number(first.bbox[1]) : Number(z.y ?? z.top ?? zy));
            const lastRight = (last.bbox && last.bbox.length >= 4) ? Number(last.bbox[2]) : (Number(last.origin?.[0] ?? lx) + (z.w ?? 0) / z.lines.length);
            const pdfWidth = Math.max(0, lastRight - lx) || null;
            const frag = { x: lx, y: ly, text: normalizeFragmentText(contentOverride), pdfWidth: pdfWidth > 0 ? pdfWidth : null };
            zoneFragments.push(frag);
            allFragments.push(frag);
          } else {
            const lineTextsFromContent = contentOverride ? contentOverride.split(/\n/).map(s => normalizeFragmentText(s)) : null;
            const lineHeight = fSize * 1.2;
            for (let lineIdx = 0; lineIdx < z.lines.length; lineIdx++) {
              const line = z.lines[lineIdx];
              const lx = (line.origin && line.origin[0] != null) ? Number(line.origin[0]) : (line.bbox && line.bbox.length >= 4 ? Number(line.bbox[0]) : Number(z.x ?? z.left ?? zx));
              const ly = (line.origin && line.origin[1] != null) ? Number(line.origin[1]) : (line.bbox && line.bbox.length >= 4 ? Number(line.bbox[1]) : zy + lineIdx * lineHeight);
              const text = (lineTextsFromContent && lineTextsFromContent.length === z.lines.length)
                ? lineTextsFromContent[lineIdx]
                : normalizeFragmentText(line.text);
              const pdfWidth = (line.bbox && line.bbox.length >= 4) ? (Number(line.bbox[2]) - Number(line.bbox[0])) : null;
              const frag = { x: lx, y: ly, text: text || normalizeFragmentText(line.text), pdfWidth: pdfWidth != null && Number.isFinite(pdfWidth) && pdfWidth > 0 ? pdfWidth : null };
              zoneFragments.push(frag);
              allFragments.push(frag);
            }
          }
        } else {
          const content = normalizeFragmentText(z.content || z.text);
          if (content) {
            const zxNum = Number(z.x ?? z.left ?? 0);
            const zyNum = Number(z.y ?? z.top ?? 0);
            const pdfWidth = (z.w != null || z.width != null) ? Number(z.w ?? z.width) : null;
            const frag = { x: zxNum, y: zyNum, text: content, pdfWidth: pdfWidth != null && Number.isFinite(pdfWidth) && pdfWidth > 0 ? pdfWidth : null };
            zoneFragments.push(frag);
            allFragments.push(frag);
          }
        }
        fragmentsByZone.push(zoneFragments);
      }

      // Space between same-line fragments; optional textLength from gap when no PDF width.
      const minTextLengthGap = 2;
      const maxTextLengthGap = defFontSize * 0.5;
      const endsWithPunct = (s) => /[.,;:?!")]\s*$/.test((s || '').trim());
      const startsWithPunct = (s) => /^[.,;:?!'"(\[]/.test((s || '').trim());

      for (let i = 0; i < allFragments.length; i++) {
        const f = allFragments[i];
        const next = allFragments[i + 1];

        if (next && Math.abs(next.y - f.y) <= lineYThreshold) {
          if (!f.text.endsWith(' ') && !f.text.endsWith('\u00A0')) {
            const noSpaceBetween = endsWithPunct(f.text) && startsWithPunct(next.text);
            if (!noSpaceBetween) f.text = f.text + ' ';
          }
          // Fallback textLength from gap only when we don't have PDF bbox width
          if (f.pdfWidth == null) {
            const length = next.x - f.x;
            if (length > minTextLengthGap && length < maxTextLengthGap) f.textLength = length;
          } else {
            // Cap pdfWidth only when next fragment is a tiny continuation (e.g. "p." then "E" or "4" in Image Credits).
            // Do NOT cap when next is a normal word (e.g. "com") or we compress "http://www. tcmpub." and cut "t" and ".".
            const nextTrim = (next.text || '').trim();
            const isTinyNext = nextTrim.length <= 2 || /^\d/.test(nextTrim);
            const gap = next.x - f.x;
            if (gap > 0 && gap < f.pdfWidth && isTinyNext) {
              f.pdfWidth = gap;
            }
          }
        }
      }

      const tspanParts = [];
      // includePosition: when false, first run has no x,y so caller can wrap with textLength (stretch whole line to PDF width)
      const runsToTspans = (fullContent, lineStart, lineEnd, runs, fragment, defFontSize, defFontFamily, defFill, includePosition = true, zoneForStroke = null) => {
        if (!runs || runs.length === 0) return null;
        const lineRuns = runs
          .filter(r => r.end > lineStart && r.start < lineEnd)
          .map(r => ({
            start: Math.max(r.start, lineStart),
            end: Math.min(r.end, lineEnd),
            bold: r.bold,
            italic: r.italic,
            color: r.color,
            strokeColor: r.strokeColor,
            strokeWidth: r.strokeWidth
          }));
        if (lineRuns.length === 0) return null;
        const parts = lineRuns.map((run, ri) => {
          const nextRun = lineRuns[ri + 1];
          const { displayText, segText } = runSegmentWithSpace(fullContent, run, nextRun, lineEnd, normalizeFragmentText);
          if (displayText.length === 0) return { tspan: '', segText: '' };
          const segStyle = [];
          segStyle.push(`fill:${transparentText ? 'transparent' : (run.color || defFill)}`);
          segStyle.push(`font-weight:${run.bold ? 'bold' : 'normal'}`);
          segStyle.push(`font-style:${run.italic ? 'italic' : 'normal'}`);
          const strokeColor = run.strokeColor ?? zoneForStroke?.strokeColor;
          const strokeWidthRaw = run.strokeWidth ?? zoneForStroke?.strokeWidth;
          const strokeDecl = svgStrokeStyleDecl(strokeColor, strokeWidthRaw, defFontSize);
          if (strokeDecl) segStyle.push(strokeDecl);
          const styleAttr = segStyle.length ? ` style="${escapeXml(segStyle.join(';') + ';')}"` : '';
          const posAttr = includePosition && ri === 0 ? ` x="${Number(fragment.x).toFixed(2)}" y="${Number(fragment.y).toFixed(2)}"` : '';
          const tspan = `<tspan${posAttr}${styleAttr}>${escapeXml(displayText)}</tspan>`;
          return { tspan, segText };
        });
        return parts.map(p => p.tspan).join('');
      };
      // Prefer PDF bbox width (Option A: stretch to match PDF); else use same-line gap textLength — required so overlay text fills line and no gap (font width fix)
      const textLengthAttr = (f) => {
        const len = f.pdfWidth ?? f.textLength;
        return (len != null && Number.isFinite(len) && len > 0) ? ` textLength="${Number(len).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
      };
      const wrapWithTextLength = (f, inner) => {
        const pos = ` x="${Number(f.x).toFixed(2)}" y="${Number(f.y).toFixed(2)}"`;
        const tl = textLengthAttr(f);
        return `<tspan${pos}${tl}>${inner}</tspan>`;
      };
      for (let i = 0; i < mergedParaZones.length; i++) {
        const z = mergedParaZones[i];
        const zoneId = (z.id || '').replace(/"/g, '&quot;');
        const zoneFragments = fragmentsByZone[i];
        const zoneFontSize = Number(z.fontSize) || 12;
        const zoneFontSizeAttr = (zoneFontSize !== defFontSize) ? ` style="font-size:${zoneFontSize}px"` : '';
        let runs = Array.isArray(z.styleRuns) && z.styleRuns.length > 0 ? z.styleRuns : null;
        const fullContentForRuns = (z.content || z.text || '').trim();
        // When zone has no styleRuns, use one run from this zone's own bold/italic/color/stroke so each zone (e.g. each TOC line) gets explicit style.
        if (!runs && fullContentForRuns.length > 0) {
          runs = [{
            start: 0,
            end: fullContentForRuns.length,
            bold: !!z.bold,
            italic: !!z.italic,
            color: z.color || firstZone.color || '#000000',
            strokeColor: z.strokeColor ?? null,
            strokeWidth: z.strokeWidth ?? null
          }];
        }
        if (zoneFragments.length > 1) {
          let charOffset = 0;
          const innerTspans = zoneFragments.map((f) => {
            const lineStart = charOffset;
            const lineEnd = charOffset + (f.text || '').length;
            charOffset = lineEnd + 1;
            if (runs && lineStart < lineEnd) {
              const runTspans = runsToTspans(fullContentForRuns, lineStart, lineEnd, runs, f, zoneFontSize, defFontFamily, defFill, false, z);
              if (runTspans) return wrapWithTextLength(f, runTspans);
            }
            const attr = ` x="${Number(f.x).toFixed(2)}" y="${Number(f.y).toFixed(2)}"${textLengthAttr(f)}`;
            let fallbackStyle = (zoneFontSize !== defFontSize ? `font-size:${zoneFontSize}px;` : '')
              + (transparentText ? 'fill:transparent;' : `fill:${z.color || defFill};`)
              + `font-weight:${z.bold ? 'bold' : 'normal'};`
              + `font-style:${z.italic ? 'italic' : 'normal'};`;
            const strokeFrag = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, zoneFontSize);
            if (strokeFrag) fallbackStyle += strokeFrag;
            return `<tspan${attr} style="${escapeXml(fallbackStyle)}">${escapeXml(f.text || '')}</tspan>`;
          }).join('');
          tspanParts.push(`<tspan id="${zoneId}" class="smil-target"${zoneFontSizeAttr}>${innerTspans}</tspan>`);
        } else if (zoneFragments.length === 1) {
          const f = zoneFragments[0];
          if (runs && (f.text || '').length > 0) {
            const runTspans = runsToTspans(fullContentForRuns, 0, (f.text || '').length, runs, f, zoneFontSize, defFontFamily, defFill, false, z);
            if (runTspans) {
              tspanParts.push(`<tspan id="${zoneId}" class="smil-target"${zoneFontSizeAttr}>${wrapWithTextLength(f, runTspans)}</tspan>`);
            } else {
              const posAttr = ` x="${Number(f.x).toFixed(2)}" y="${Number(f.y).toFixed(2)}"${textLengthAttr(f)}`;
              let fallbackStyle = (zoneFontSize !== defFontSize ? `font-size:${zoneFontSize}px;` : '')
                + (transparentText ? 'fill:transparent;' : `fill:${z.color || defFill};`)
                + `font-weight:${z.bold ? 'bold' : 'normal'};`
                + `font-style:${z.italic ? 'italic' : 'normal'};`;
              const strokeFrag2 = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, zoneFontSize);
              if (strokeFrag2) fallbackStyle += strokeFrag2;
              tspanParts.push(`<tspan id="${zoneId}" class="smil-target"${posAttr} style="${escapeXml(fallbackStyle)}">${escapeXml(f.text || '')}</tspan>`);
            }
          } else {
            const posAttr = ` x="${Number(f.x).toFixed(2)}" y="${Number(f.y).toFixed(2)}"${textLengthAttr(f)}`;
            let fallbackStyle = (zoneFontSize !== defFontSize ? `font-size:${zoneFontSize}px;` : '')
              + (transparentText ? 'fill:transparent;' : `fill:${z.color || defFill};`)
              + `font-weight:${z.bold ? 'bold' : 'normal'};`
              + `font-style:${z.italic ? 'italic' : 'normal'};`;
            const strokeFrag3 = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, zoneFontSize);
            if (strokeFrag3) fallbackStyle += strokeFrag3;
            tspanParts.push(`<tspan id="${zoneId}" class="smil-target"${posAttr} style="${escapeXml(fallbackStyle)}">${escapeXml(f.text || '')}</tspan>`);
          }
        }
      }
      if (tspanParts.length > 0) {
        const textEl = `<text${transform} style="${escapeXml(textStyle)}">${tspanParts.join('')}</text>`;
        svgTextItems.push(textEl);
      }
    }
  } else {
  // High-Precision Coalescence: Group adjacent word/fragment zones into single <text> tags
  // to prevent "scattered" text artifacts caused by proportional x-coordinate estimations.
  const isCreditsPage = sortedZones.some((z) => /Publishing Credits|Image Credits|Consultant/i.test((z.content || z.text || '')));
  const logicalGroups = [];
  let currentGroup = null;

  for (const zone of sortedZones) {
    const isWordPart = /(_w\d+|frag\d+)$/.test(zone.id);
    const isSentPart = /_s\d+(_frag\d+)?$/.test(zone.id);
    const baseId = (zone.id || '').replace(/(_w|_s|_frag|(_s\d+_frag))\d+$/, '');

    const y = Number(zone.y ?? zone.top ?? 0);
    const x = Number(zone.x ?? zone.left ?? 0);
    const fontSize = zone.fontSize || 12;

    const prevZone = currentGroup ? currentGroup.zones[currentGroup.zones.length - 1] : null;
    const prevXEnd = prevZone ? Number(prevZone.x ?? prevZone.left ?? 0) + Number(prevZone.w ?? prevZone.width ?? 0) : 0;
    const horizontalGap = x - prevXEnd;

    // Don't merge across column gaps: only group when horizontal gap is small (same phrase).
    const maxHorizontalGap = Math.min(fontSize * 4, 50);
    const reasonablyClose = horizontalGap < maxHorizontalGap;

    // Grouping: only group zones on the same baseline (same line). Each sentence on its own line = one block.
    const sameLineThreshold = Math.min(fontSize * 0.25, 5);
    const sameLine = currentGroup && Math.abs(currentGroup.y - y) < sameLineThreshold;
    const thisHasLines = zone.lines && zone.lines.length > 1;
    const currentHasLines = currentGroup && currentGroup.zones.some((z) => z.lines && z.lines.length > 1);

    const zoneAlign = zone.textAlign || 'left';
    const sameAlign = !currentGroup || (currentGroup.textAlign === zoneAlign);
    // Group only same-line zones (one block per line/sentence). Do not merge across lines so each sentence stays a single block.
    if (!thisHasLines && !currentHasLines && sameLine && reasonablyClose && sameAlign) {
      currentGroup.zones.push(zone);
    } else {
      if (currentGroup) logicalGroups.push(currentGroup);
      currentGroup = {
        baseId,
        x,
        y,
        zones: [zone],
        isWordPart,
        isSentPart,
        fontFamily: zone.fontFamily,
        fontSize,
        color: zone.color,
        bold: zone.bold,
        italic: zone.italic,
        origin: zone.origin,
        strokeColor: zone.strokeColor,
        strokeWidth: zone.strokeWidth,
        letterSpacing: zone.letterSpacing,
        textShadow: zone.textShadow,
        textAlign: zone.textAlign || 'left'
      };
    }
  }
  if (currentGroup) logicalGroups.push(currentGroup);

  for (let gi = 0; gi < logicalGroups.length; gi++) {
    const group = logicalGroups[gi];
    const prevGroup = gi > 0 ? logicalGroups[gi - 1] : null;
    const { zones, x, y, textAlign: groupAlign } = group;
    const defaultZone = zones[0];
    const align = groupAlign || defaultZone.textAlign || 'left';
    // Use the largest font size in the group so headings (e.g. "Publishing Credits") are never shrunk to body size
    const defFontSize = Math.max(12, ...zones.map((z) => Number(z.fontSize) || 12));
    const lastPrevZone = prevGroup && prevGroup.zones.length > 0 ? prevGroup.zones[prevGroup.zones.length - 1] : null;
    const lastPrevContent = lastPrevZone ? (lastPrevZone.content || lastPrevZone.text || '').trim() : '';
    const firstContent = (defaultZone.content || defaultZone.text || '').trim();
    const lastPrevY = lastPrevZone ? Number(lastPrevZone.y ?? lastPrevZone.top ?? 0) : 0;
    const firstZoneY = Number(defaultZone.y ?? defaultZone.top ?? y);
    const onSameLineAsPrev = Math.abs(firstZoneY - lastPrevY) < Math.min(defFontSize * 0.3, 4);
    const needLeadingSpace = prevGroup && lastPrevContent && !endsWithPunct(lastPrevContent) && firstContent && !startsWithPunct(firstContent) && onSameLineAsPrev;
    const embeddedNames = (extractedFonts || []).map(f => (f && f.name != null) ? String(f.name) : '').filter(Boolean);
    const mapToEmbedded = (raw) => {
      const r = raw != null ? String(raw) : '';
      const embeddedHit = resolveEmbeddedFontName(r, embeddedNames, fontMap);
      if (embeddedHit) return embeddedHit;
      return pickDefaultEmbeddedFontName(embeddedNames) || resolveFontFamily(r || 'Arial');
    };
    const defFontFamily = mapToEmbedded(defaultZone.fontFamily || 'Arial');
    const defFill = transparentText ? 'transparent' : (defaultZone.color || '#000000');

    let textStyle = `${cssFontFamilyDecl(defFontFamily, true)}font-size:${defFontSize}px !important;fill:${defFill};opacity:1;`;
    if (defaultZone.letterSpacing) textStyle += `letter-spacing:${defaultZone.letterSpacing}px;`;
    // Preserve text style from PDF (bold, italic)
    if (defaultZone.bold) textStyle += 'font-weight:bold;';
    if (defaultZone.italic) textStyle += 'font-style:italic;';
    // Coords/zone y and origin[1] are bbox TOP (PDF convention). Use text-before-edge so SVG places the top of the text at y (fixes "text moving up").
    textStyle += 'dominant-baseline:text-before-edge;';
    const rotation = (defaultZone.origin && defaultZone.origin[2]) ? defaultZone.origin[2] : 0;
    let firstX = Number(defaultZone.x ?? defaultZone.left ?? x);
    const firstY = Number(defaultZone.y ?? defaultZone.top ?? y);
    if (align !== 'right' && (align !== 'center' || syncLevel === 'sentence')) {
      firstX = Math.max(0, firstX - LEADING_OFFSET_LEFT);
    }
    const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${firstX.toFixed(2)} ${firstY.toFixed(2)})"` : '';

    // Sentence-level multi-line: one zone with zone.lines[] — render one <text x,y> with one <tspan x,y> per line so position matches PDF (each line can have its own align).
    // When zone has styleRuns (e.g. bold "mane"), apply per-run style within each line so word-level styles show in EPUB.
    // Use zone.content (Studio "Text Content (OCR)") when set so edits apply to EPUB.
    if (zones.length === 1 && defaultZone.lines?.length > 1) {
      const z = defaultZone;
      let firstLx = firstX;
      let firstLy = firstY;
      const lineHeight = defFontSize * 1.2; // fallback when neither origin[1] nor bbox available
      const fullContent = normalizeAbbreviationCorruption((z.content || z.text || '').trim());
      const runs = Array.isArray(z.styleRuns) && z.styleRuns.length > 0 ? z.styleRuns : null;
      // On credits pages only: when OCR is one logical line but zone has multiple z.lines, use zone content (correct OCR) — do not use line.text from glyph/line grouping.
      const isSingleLineContent = fullContent && !fullContent.includes('\n');
      let lineTspans;
      if (isSingleLineContent && isCreditsPage) {
        const first = z.lines[0];
        const last = z.lines[z.lines.length - 1];
        const lx = (first.origin && first.origin[0] != null) ? Number(first.origin[0]) : (first.bbox && first.bbox.length >= 4 ? Number(first.bbox[0]) : Number(x));
        let ly = (first.origin && first.origin[1] != null) ? Number(first.origin[1]) : null;
        if (ly == null && first.bbox && first.bbox.length >= 4) ly = Number(first.bbox[1]);
        if (ly == null) ly = Number(y);
        firstLx = lx;
        firstLy = ly;
        const lastRight = (last.bbox && last.bbox.length >= 4) ? Number(last.bbox[2]) : (lx + (z.w || 0));
        const textLen = Math.max(0, lastRight - lx);
        const tlAttr = textLen > 0 ? ` textLength="${textLen.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
        lineTspans = `<tspan x="${Number(lx).toFixed(2)}" y="${Number(ly).toFixed(2)}"${tlAttr}>${escapeXml(normalizeSpaces(fullContent))}</tspan>`;
      } else {
      const contentParts = fullContent ? fullContent.split(/\n/).map(s => s.trim()) : null;
      const useContentPerLine = contentParts && contentParts.length === z.lines.length;
      let charOffset = 0;
      lineTspans = z.lines.map((line, lineIdx) => {
        const lineAlign = line.align || align;
        // Sentence-level: use left X and text-anchor:start so multiple sentences on same line flow naturally (no center gap).
        const useStartForSentence = syncLevel === 'sentence';
        let lx = (line.origin && line.origin[0] != null) ? Number(line.origin[0]) : Number(x);
        if (line.bbox && line.bbox.length >= 4) {
          if (lineAlign === 'right') lx = Number(line.bbox[2]);
          else if (lineAlign === 'center' && !useStartForSentence) lx = (Number(line.bbox[0]) + Number(line.bbox[2])) / 2;
          else lx = Number(line.bbox[0]);
        }
        if (lineIdx === 0 && lineAlign !== 'right' && (lineAlign !== 'center' || useStartForSentence)) {
          lx = Math.max(0, lx - LEADING_OFFSET_LEFT);
        }
        let ly = (line.origin && line.origin[1] != null) ? Number(line.origin[1]) : null;
        if (ly == null && line.bbox && line.bbox.length >= 4) ly = Number(line.bbox[1]);
        if (ly == null) ly = Number(y) + lineIdx * lineHeight;
        if (lineIdx === 0) {
          firstLx = lx;
          firstLy = ly;
        }
        const lyStr = Number(ly).toFixed(2);
        const lineText = (useContentPerLine ? contentParts[lineIdx] : (line.text || '').trim()) || (line.text || '').trim();
        const lineStart = charOffset;
        const lineEnd = charOffset + lineText.length;
        charOffset = lineEnd + 1; // +1 for space between lines in content

        if (runs && lineStart < lineEnd) {
          const lineRuns = runs
            .filter(r => r.end > lineStart && r.start < lineEnd)
            .map(r => ({
              start: Math.max(r.start, lineStart),
              end: Math.min(r.end, lineEnd),
              bold: r.bold,
              italic: r.italic,
              color: r.color,
              strokeColor: r.strokeColor,
              strokeWidth: r.strokeWidth
            }));
          if (lineRuns.length > 0) {
            const parts = lineRuns.map((run, ri) => {
              const nextRun = lineRuns[ri + 1];
              const { displayText, segText } = runSegmentWithSpace(fullContent, run, nextRun, lineEnd, normalizeSpaces);
              if (displayText.length === 0) return { tspan: '', segText: '' };
              const segStyle = [];
              if (line.fontSize != null) segStyle.push(`font-size:${Number(line.fontSize)}px`);
              if (line.fontFamily != null) segStyle.push(`font-family:"${fontMap[line.fontFamily] || resolveFontFamily(line.fontFamily || 'Arial')}"`);
              const fill = transparentText ? 'transparent' : (run.color || line.color || z.color || '#000000');
              segStyle.push(`fill:${fill}`);
              if (run.bold) segStyle.push('font-weight:bold');
              if (run.italic) segStyle.push('font-style:italic');
              const strokeColor = run.strokeColor ?? z.strokeColor;
              const strokeWidthRaw = run.strokeWidth ?? z.strokeWidth;
              const lineFs = Number(line.fontSize) || Number(z.fontSize) || 12;
              const strokeFragLine = svgStrokeStyleDecl(strokeColor, strokeWidthRaw, lineFs);
              if (strokeFragLine) segStyle.push(strokeFragLine);
              if (lineAlign === 'right') segStyle.push('text-anchor:end');
              else if (lineAlign === 'center' && syncLevel !== 'sentence') segStyle.push('text-anchor:middle');
              const styleAttr = segStyle.length ? ` style="${escapeXml(segStyle.join(';') + ';')}"` : '';
              const posAttr = ri === 0 ? ` x="${Number(lx).toFixed(2)}" y="${lyStr}"` : '';
              return { tspan: `<tspan${posAttr}${styleAttr}>${escapeXml(displayText)}</tspan>`, segText };
            });
            return parts.map(p => p.tspan).join('');
          }
        }

        let lineStyle = '';
        if (line.fontSize != null) lineStyle += `font-size:${Number(line.fontSize)}px;`;
        if (line.fontFamily != null) lineStyle += `font-family:"${fontMap[line.fontFamily] || resolveFontFamily(line.fontFamily || 'Arial')}";`;
        if (line.color != null && !transparentText) lineStyle += `fill:${line.color};`;
        if (line.bold) lineStyle += 'font-weight:bold;';
        if (line.italic) lineStyle += 'font-style:italic;';
        const lineFs2 = Number(line.fontSize) || Number(z.fontSize) || 12;
        const strokeLine2 = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, lineFs2);
        if (strokeLine2) lineStyle += strokeLine2;
        if (lineAlign === 'right') lineStyle += 'text-anchor:end;';
        else if (lineAlign === 'center' && syncLevel !== 'sentence') lineStyle += 'text-anchor:middle;';
        const tspanStyleAttr = lineStyle ? ` style="${escapeXml(lineStyle)}"` : (lineAlign === 'right' ? ' style="text-anchor:end"' : (lineAlign === 'center' && syncLevel !== 'sentence' ? ' style="text-anchor:middle"' : ''));
        return `<tspan x="${Number(lx).toFixed(2)}" y="${lyStr}"${tspanStyleAttr}>${escapeXml(normalizeSpaces(lineText))}</tspan>`;
      }).join('');
      }
      const id = (z.id || '').replace(/"/g, '&quot;');
      const textEl = `<text x="${firstLx.toFixed(2)}" y="${firstLy.toFixed(2)}" id="${id}" class="smil-target"${transform} style="${escapeXml(textStyle)}">${lineTspans}</text>`;
      // Do NOT wrap in clip-path: it was clipping leading letters (e.g. "P" in "Publishing Credits"). Text is positioned per line so no clip needed.
      svgTextItems.push(textEl);
      continue;
    }

    // Sentence-level: use left X and text-anchor:start so sentences on same line don't get independently centered (no gap).
    const useStartForSentence = syncLevel === 'sentence';
    if (align === 'right') textStyle += 'text-anchor:end;';
    else if (align === 'center' && !useStartForSentence) textStyle += 'text-anchor:middle;';

    // Single-line or grouped: position x by alignment (left = start, right = end, center = middle). firstX already has LEADING_OFFSET_LEFT for left-aligned.
    let posX = firstX;
    let posY = firstY;
    if (align === 'right' || (align === 'center' && !useStartForSentence)) {
      let groupRight = firstX;
      for (const z of zones) {
        const zx = Number(z.x ?? z.left ?? 0);
        const zw = Number(z.w ?? z.width ?? 0);
        groupRight = Math.max(groupRight, zx + zw);
      }
      if (align === 'right') posX = groupRight;
      else posX = (firstX + groupRight) / 2;
    }

    // Word-level: use explicit x,y for every word so each is placed at its zone (zx,zy). Avoids "only first word correct, others collapsing" when flow fails.
    // Sentence-level: flow within group (no per-fragment x,y) so "They" comes after "too" in order instead of wrong coords overlapping "horses".
    const isWordLevel = syncLevel === 'word';
    const gapThreshold = (defFontSize || 12) * 1.2;

    // Word-level: enforce minimum gap between consecutive same-line words so reordering/bold/OCR edits don't collapse spacing.
    const minWordGap = Math.max(3, (defFontSize || 12) * 0.22);
    const adjustedWordX = isWordLevel ? (() => {
      const out = [];
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        let zx = Number(z.x ?? z.left ?? 0);
        const zy = Number(z.y ?? z.top ?? 0);
        const zw = Number(z.w ?? z.width ?? 0);
        if (i === 0 && (align !== 'right' && (align !== 'center' || useStartForSentence))) {
          zx = Math.max(0, zx - LEADING_OFFSET_LEFT);
        }
        if (i > 0) {
          const prev = zones[i - 1];
          const prevZy = Number(prev.y ?? prev.top ?? 0);
          const prevZw = Number(prev.w ?? prev.width ?? 0);
          const sameLine = Math.abs(zy - prevZy) < Math.min((defFontSize || 12) * 0.25, 5);
          if (sameLine) {
            const minStart = out[i - 1] + prevZw + minWordGap;
            if (zx < minStart) zx = minStart;
          }
        }
        out[i] = zx;
      }
      return out;
    })() : null;

    // Use zone bbox (x,y) for position so rendering matches PDF exactly; origin can be baseline and misalign.
    const tspans = zones.map((z, idx) => {
      let content = normalizeAbbreviationCorruption((z.content || z.text || '').trim());
      if (idx === 0 && needLeadingSpace) content = ' ' + content;
      const nextZone = zones[idx + 1];
      let zx = Number(z.x ?? z.left ?? 0);
      const zy = Number(z.y ?? z.top ?? 0);
      const zw = Number(z.w ?? z.width ?? 0);
      if (adjustedWordX) {
        zx = adjustedWordX[idx];
      } else if (idx === 0 && (align !== 'right' && (align !== 'center' || useStartForSentence))) {
        zx = Math.max(0, zx - LEADING_OFFSET_LEFT);
      }

      let useExplicitHere = false;
      if (isWordLevel) {
        useExplicitHere = true; // every word at its (zx,zy) so no collapse when flow is broken
      } else {
        useExplicitHere = false; // sentence-level: flow so order is correct and no overlap with wrong coords
      }

      // Add space when the *next* word will flow (no explicit position). Sentence-level: space character gives visible gap. Word-level: we also add a space character and extend this tspan's width so the space has room (like sentence-level).
      let nextUseExplicit = isWordLevel; // word-level: every word has explicit position
      if (!isWordLevel && nextZone) {
        const nextX = Number(nextZone.x ?? nextZone.left ?? 0);
        const currEnd = zx + zw;
        const gapToNext = nextX - currEnd;
        nextUseExplicit = gapToNext > gapThreshold;
      }
      let space = '';
      let wordLevelSpaceWidth = 0; // when > 0, extend this word's textLength by this amount so "word " has visible gap
      if (nextZone) {
        const nextContent = (nextZone.content || nextZone.text || '').trim();
        const nextZx = Number(nextZone.x ?? nextZone.left ?? 0);
        const nextZy = Number(nextZone.y ?? nextZone.top ?? 0);
        const sameBaseline = Math.abs(zy - nextZy) < Math.min(defFontSize * 0.25, 3);
        const gapToNext = nextZx - (zx + zw);
        // Sentence-level: add space when same line and gap small. Word-level: add space when same line (so reader sees gap like sentence-level).
        const needSpaceBetween = isWordLevel ? (sameBaseline && nextContent !== '' && !startsWithPunct(nextContent)) : (sameBaseline && gapToNext < defFontSize * 0.6);
        // Do not add space if content already ends with space (avoids double space between blocks/sentences)
        const alreadyHasTrailingSpace = content.endsWith(' ') || content.endsWith('\u00A0');
        // After .!? do not add space unless next zone is almost touching (gap < 2px); otherwise the next zone's x already provides the space and we avoid "extra space between sentence"
        const endsWithSentencePunct = /[.!?]$/.test(content.trim());
        const gapVerySmall = gapToNext < 2;
        const shouldAddSpace = !alreadyHasTrailingSpace && !startsWithPunct(nextContent) && nextContent !== '' && needSpaceBetween && (!endsWithSentencePunct || gapVerySmall);
        if (shouldAddSpace) {
          space = ' ';
          if (isWordLevel) wordLevelSpaceWidth = minWordGap; // give the space character this width so it renders visibly
        }
      }

      let spanStyle = '';
      const zFontFamily = mapToEmbedded(z.fontFamily || 'Arial');
      if (zFontFamily !== defFontFamily) spanStyle += `${cssFontFamilyDecl(zFontFamily, true)}`;
      if (Math.abs((z.fontSize || 12) - defFontSize) > 0.5) spanStyle += `font-size:${z.fontSize}px;`;
      const zFill = transparentText ? 'transparent' : (z.color || '#000000');
      if (zFill !== defFill) spanStyle += `fill:${zFill};`;

      if (z.bold) spanStyle += 'font-weight:bold;';
      else if (defaultZone.bold) spanStyle += 'font-weight:normal;';
      if (z.italic) spanStyle += 'font-style:italic;';
      else if (defaultZone.italic) spanStyle += 'font-style:normal;';
      const zFs = Number(z.fontSize) || defFontSize || 12;
      const strokeWord = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, zFs);
      if (strokeWord) spanStyle += strokeWord;

      const id = (z.id || '').replace(/"/g, '&quot;');
      const styleAttr = spanStyle ? ` style="${escapeXml(spanStyle)}"` : '';
      const posAttr = useExplicitHere ? ` x="${Number(zx).toFixed(2)}" y="${Number(zy).toFixed(2)}"` : '';
      // Word-level: stretch each word only when bbox width is plausible (tiny zw + spacingAndGlyphs smears glyphs).
      const twRaw = zw + wordLevelSpaceWidth;
      const charCount = Math.max(1, (content.replace(/\s+/g, '') || '').length);
      const minTl = Math.max(2, charCount * (defFontSize || 12) * 0.28);
      const wordTlAttr = (isWordLevel && twRaw > 0 && twRaw >= minTl * 0.72)
        ? ` textLength="${twRaw.toFixed(2)}" lengthAdjust="spacingAndGlyphs"`
        : '';
      // Word-level styles: zone.styleRuns (from PDF or Studio) — one tspan per run so e.g. "mane" can be bold in sentence.
      const runs = Array.isArray(z.styleRuns) && z.styleRuns.length > 0 ? z.styleRuns : null;
      if (runs && !(z.lines && z.lines.length > 1)) {
        const fullContent = (z.content || z.text || '').trim();
        const runParts = runs.map((run, ri) => {
          const nextRun = ri < runs.length - 1 ? runs[ri + 1] : null;
          const { displayText } = runSegmentWithSpace(fullContent, run, nextRun, undefined, normalizeSpaces);
          if (displayText.length === 0) return '';
          const runStyle = [];
          const rFontFamily = mapToEmbedded(z.fontFamily || 'Arial');
          if (rFontFamily !== defFontFamily) runStyle.push(cssFontFamilyDecl(rFontFamily, true).replace(/;$/, ''));
          if (Math.abs((z.fontSize || 12) - defFontSize) > 0.5) runStyle.push(`font-size:${z.fontSize}px`);
          const rFill = transparentText ? 'transparent' : (run.color || z.color || '#000000');
          if (rFill !== defFill) runStyle.push(`fill:${rFill}`);
          if (run.bold) runStyle.push('font-weight:bold');
          else if (defaultZone.bold) runStyle.push('font-weight:normal');
          if (run.italic) runStyle.push('font-style:italic');
          else if (defaultZone.italic) runStyle.push('font-style:normal');
          const zFsRun = Number(z.fontSize) || defFontSize || 12;
          const strokeRun = svgStrokeStyleDecl(z.strokeColor, z.strokeWidth, zFsRun);
          if (strokeRun) runStyle.push(strokeRun);
          const rStyleAttr = runStyle.length ? ` style="${escapeXml(runStyle.join(';') + ';')}"` : '';
          const isFirst = ri === 0;
          const isLast = ri === runs.length - 1;
          const runContent = (isFirst && idx === 0 && needLeadingSpace ? ' ' : '') + displayText + (isLast && nextZone ? space : '');
          // In word-level mode, position + textLength live on the outer wrapper; individual runs only carry style.
          const runPosAttr = (isFirst && !isWordLevel) ? posAttr : '';
          return `<tspan class="smil-target"${runPosAttr}${rStyleAttr}>${escapeXml(runContent)}</tspan>`;
        });
        const inner = runParts.join('');
        // Outer wrapper carries id + (word-level) position + textLength so the whole word stretches correctly.
        const wrapperId = zones.length > 1 ? ` id="${id}"` : '';
        const wrapperPos = isWordLevel ? `${posAttr}${wordTlAttr}` : '';
        return `<tspan${wrapperId} class="smil-target"${wrapperPos}>${inner}</tspan>`;
      }
      // When zone has line-level data, emit one tspan per line so grouped sentences don't get extra vertical gap.
      // On credits pages only: when OCR is one logical line but zone has multiple z.lines, use zone content (correct OCR), not line.text from glyph/line grouping.
      if (z.lines && z.lines.length > 1) {
        const zoneContent = (z.content || z.text || '').trim();
        const isSingleLineContent = zoneContent && !zoneContent.includes('\n');
        if (isSingleLineContent && isCreditsPage) {
          const first = z.lines[0];
          const last = z.lines[z.lines.length - 1];
          let lx = (first.origin && first.origin[0] != null) ? Number(first.origin[0]) : (first.bbox && first.bbox.length >= 4 ? Number(first.bbox[0]) : zx);
          if (first.bbox && first.bbox.length >= 4 && (align !== 'right' && (align !== 'center' || syncLevel === 'sentence'))) lx = Math.max(0, lx - LEADING_OFFSET_LEFT);
          let ly = (first.origin && first.origin[1] != null) ? Number(first.origin[1]) : (first.bbox && first.bbox.length >= 4 ? Number(first.bbox[1]) : zy);
          const lastRight = (last.bbox && last.bbox.length >= 4) ? Number(last.bbox[2]) : (lx + (z.w || 0));
          const textLen = Math.max(0, lastRight - lx);
          const tlAttr = textLen > 0 ? ` textLength="${textLen.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
          return `<tspan${zones.length > 1 ? ` id="${id}"` : ''} class="smil-target" x="${Number(lx).toFixed(2)}" y="${Number(ly).toFixed(2)}"${styleAttr}${tlAttr}>${escapeXml(normalizeSpaces(zoneContent))}${nextZone ? space : ''}</tspan>`;
        }
        const lineHeightFallback = defFontSize * 1.2;
        const alignZone = z.textAlign || align;
        const parts = z.lines.map((line, lineIdx) => {
          let lx = (line.origin && line.origin[0] != null) ? Number(line.origin[0]) : zx;
          if (line.bbox && line.bbox.length >= 4) {
            const la = line.align || alignZone;
            if (la === 'right') lx = Number(line.bbox[2]);
            else if (la === 'center' && syncLevel !== 'sentence') lx = (Number(line.bbox[0]) + Number(line.bbox[2])) / 2;
            else lx = Number(line.bbox[0]);
          }
          if (lineIdx === 0 && (alignZone !== 'right' && (alignZone !== 'center' || syncLevel === 'sentence'))) {
            lx = Math.max(0, lx - LEADING_OFFSET_LEFT);
          }
          let ly = (line.origin && line.origin[1] != null) ? Number(line.origin[1]) : (line.bbox && line.bbox.length >= 4 ? Number(line.bbox[1]) : zy + lineIdx * lineHeightFallback);
          if (ly == null) ly = zy + lineIdx * lineHeightFallback;
          let ls = spanStyle;
          if (line.fontSize != null) ls += `font-size:${Number(line.fontSize)}px;`;
          if (line.fontFamily != null) ls += `${cssFontFamilyDecl(mapToEmbedded(line.fontFamily || 'Arial'), true)}`;
          if (line.color != null && !transparentText) ls += `fill:${line.color};`;
          if (line.bold) ls += 'font-weight:bold;';
          if (line.italic) ls += 'font-style:italic;';
          const la = line.align || alignZone;
          if (la === 'right') ls += 'text-anchor:end;';
          else if (la === 'center' && syncLevel !== 'sentence') ls += 'text-anchor:middle;';
          const lineStyleAttr = ls ? ` style="${escapeXml(ls)}"` : '';
          const lineSpace = (lineIdx === z.lines.length - 1 && nextZone) ? space : '';
          const tid = lineIdx === 0 && zones.length > 1 ? ` id="${id}"` : '';
          return `<tspan${tid} class="smil-target" x="${Number(lx).toFixed(2)}" y="${Number(ly).toFixed(2)}"${lineStyleAttr}>${escapeXml(normalizeSpaces((line.text || '').trim()))}${lineSpace}</tspan>`;
        });
        return parts.join('');
      }
      return `<tspan${zones.length > 1 ? ` id="${id}"` : ''} class="smil-target"${posAttr}${wordTlAttr}${styleAttr}>${escapeXml(normalizeSpaces(content))}${space}</tspan>`;
    }).join('');

    const singleZone = zones.length === 1 ? zones[0] : null;
    const groupId = singleZone ? (singleZone.id || '').replace(/"/g, '&quot;') : '';
    const textEl = singleZone
      ? `<text id="${groupId}" class="smil-target" x="${posX.toFixed(2)}" y="${posY.toFixed(2)}"${transform} style="${escapeXml(textStyle)}">${tspans}</text>`
      : `<text class="smil-target" x="${posX.toFixed(2)}" y="${posY.toFixed(2)}"${transform} style="${escapeXml(textStyle)}">${tspans}</text>`;
    // Do NOT wrap in clip-path: it was clipping leading letters (e.g. "P" in "Publishing Credits"). Omit clip so text always renders fully.
    svgTextItems.push(textEl);
  }
  } // end else (word-level / non–sentence-level path)

  const svgTextLayer = svgTextItems.join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <title>Page ${pageData.pageNum ?? 1}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
  <style>
    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    .page-container { 
      position: relative; 
      width: ${width}px; 
      height: ${height}px; 
      overflow: hidden; 
      margin: 0 auto; 
    }
    .main-svg { 
      position: absolute; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      overflow: visible; 
    }
    .text-layer { overflow: visible; }
    /* EPUB standard and Kitaboo-specific highlighting — apply to element with id and all descendants so whole block highlights */
    .smil-target.-epub-media-overlay-active,
    .smil-target.smilActive,
    .smil-target.readium-smil-active,
    .smil-target.-epub-media-overlay-active tspan,
    .smil-target.smilActive tspan,
    .smil-target.readium-smil-active tspan,
    .-epub-media-overlay-active, .active, .highlight, .smilActive, .readium-smil-active { 
       fill: #2196F3 !important;
       color: #2196F3 !important;
       background: transparent !important;
       background-color: transparent !important;
       box-shadow: none !important;
    }
    .smil-target { cursor: pointer; }
  </style>
</head>
<body epub:type="bodymatter">
  <div class="page-container">
    <svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${width} ${height}" class="main-svg" preserveAspectRatio="xMidYMid meet">
      <image width="${width}" height="${height}" href="${escapeXml(imagePath)}" />
      <g class="text-layer">
    ${svgTextLayer}
      </g>
    </svg>
  </div>
</body>
</html>`;
}

/**
 * Generate SMIL content for one page (element-level: one par per fragment ID).
 * Format: <par><text src="pageN.xhtml#id"/><audio clipBegin="12.32s" clipEnd="12.88s"/></par>
 *
 * @param {{ xhtmlFileName: string, audioFileName: string, jobId?: string, pageNum?: number }} smilOptions
 * @param {Array<{ id: string, startTime: number, endTime: number }>} fragments
 * @param {{ minDurationSec?: number, preserveExactTimes?: boolean }} options
 * @returns {string} SMIL XML string
 */
export function generateFxlSmil(smilOptions, fragments, options = {}) {
  const { xhtmlFileName, audioFileName } = smilOptions;
  const minDurationSec = options.minDurationSec ?? 0.2;
  const preserveExactTimes = options.preserveExactTimes === true;

  let normalized;
  if (preserveExactTimes) {
    normalized = (fragments || []).map((f) => ({
      id: f.id,
      startTime: Number(Number(f.startTime).toFixed(3)),
      endTime: Number(Number(f.endTime).toFixed(3))
    }));
  } else {
    let prevEnd = 0;
    normalized = (fragments || []).map((f) => {
      const start = Math.max(parseFloat(f.startTime) || 0, prevEnd);
      const end = Math.max(parseFloat(f.endTime) || start, start + minDurationSec);
      prevEnd = end;
      return { id: f.id, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) };
    });
  }

  const parElements = normalized
    .filter((f) =>
      preserveExactTimes ? f.endTime >= f.startTime : f.endTime - f.startTime >= minDurationSec
    )
    .map((f) => {
      const clipBegin = `${f.startTime.toFixed(3)}s`;
      const clipEnd = `${f.endTime.toFixed(3)}s`;
      return `    <par>
      <text src="${xhtmlFileName}#${escapeXml(String(f.id))}"/>
      <audio src="${audioFileName}" clipBegin="${clipBegin}" clipEnd="${clipEnd}"/>
    </par>`;
    })
    .join('\n');

  // EPUB 3.3: outer <seq> MUST have epub:textref to the content document (no fragment). Namespace: SMIL 3 (not SMIL20).
  const textDocRef = escapeXml(String(xhtmlFileName || '').split('#')[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq epub:textref="${textDocRef}">
${parElements}
    </seq>
  </body>
</smil>`;
}

/** Single export object for backward compatibility */
export const EpubGenerator = {
  escapeXml,
  generateFxlCss,
  generateFxlCssClassic,
  generateDefaultCssReference,
  generatePageCssForFragments,
  generateFxlPageReference,
  generateFxlSmilReference,
  buildCoordinateMap,
  generateFxlPage,
  generateFxlSmil
};
