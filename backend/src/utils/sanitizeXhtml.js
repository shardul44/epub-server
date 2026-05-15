import { load as cheerioLoad } from 'cheerio';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { emptyCanonicalPage } from '../schemas/canonicalPageDocument.js';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const VOID_LOCAL = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'frame', 'hr', 'img', 'input', 'isindex', 'link',
  'meta', 'param', 'embed', 'source', 'track', 'wbr'
]);

function ensureXmlDeclarationAndDoctype(xhtml) {
  let s = String(xhtml).replace(/^\uFEFF/, '').trim();
  if (!/^<\?xml\s/i.test(s)) {
    s = `<?xml version="1.0" encoding="UTF-8"?>\n${s}`;
  }
  if (!/<!DOCTYPE\s+html/i.test(s)) {
    s = s.replace(/^(<\?xml[^?]*\?>\s*)/i, '$1<!DOCTYPE html>\n');
  }
  return s;
}

/**
 * Walk DOM (cheerio in xml mode) and enforce void self-closing + html xmlns on root.
 * @param {ReturnType<typeof cheerioLoad>} $
 */
function enforceVoidElements($) {
  $('*').each(function () {
    const el = $(this);
    const name = (el[0] && el[0].name ? String(el[0].name) : '').toLowerCase();
    if (!name || !VOID_LOCAL.has(name)) return;
    const html = $.html(el);
    if (html && !/\/>$/.test(html.trim())) {
      const attrs = el.attr();
      const attrStr = attrs
        ? Object.keys(attrs)
            .map((k) => ` ${k}="${String(attrs[k]).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
            .join('')
        : '';
      el.replaceWith(`<${name}${attrStr} />`);
    }
  });
}

/**
 * Parse and serialize XHTML for EPUB3 / XML tooling. Uses XML parser first; falls back to
 * cheerio XML mode (not regex-only repair).
 *
 * @param {string} input
 * @param {{ title?: string }} [opts]
 * @returns {{ xhtml: string, warnings: string[] }}
 */
export function sanitizeXhtml(input, opts = {}) {
  const warnings = [];
  const title = opts.title || 'Page';
  let raw = ensureXmlDeclarationAndDoctype(String(input || ''));

  const tryXmldom = () => {
    const parser = new DOMParser({
      locator: {},
      errorHandler: {
        warning: (m) => warnings.push(String(m)),
        error: (m) => warnings.push(String(m)),
        fatalError: (m) => {
          throw new Error(String(m));
        }
      }
    });
    const doc = parser.parseFromString(raw, 'application/xhtml+xml');
    const ser = new XMLSerializer();
    let out = ser.serializeToString(doc);
    if (!out.includes('xmlns=') && /<html/i.test(out)) {
      out = out.replace(/<html\b/i, `<html xmlns="${XHTML_NS}"`);
    }
    return out;
  };

  let xhtml;
  try {
    xhtml = tryXmldom();
  } catch (e) {
    warnings.push(`xmldom: ${e.message}; using cheerio XML repair`);
    const $ = cheerioLoad(raw, { xml: { xmlMode: true, decodeEntities: false } }, /<html[\s>]/i.test(raw));
    let root = $('html');
    if (!root.length) {
      const body = $('body').html() || $.root().html() || '';
      const wrapped = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML_NS}"><head><meta charset="UTF-8"/><title>${escapeXmlText(title)}</title></head><body>${body}</body></html>`;
      const $2 = cheerioLoad(wrapped, { xml: { xmlMode: true, decodeEntities: false } }, true);
      root = $2('html');
      enforceVoidElements($2);
      xhtml = $2.xml();
    } else {
      root.attr('xmlns', XHTML_NS);
      if (!root.find('head meta[charset]').length && !root.find('head meta[charset="UTF-8"]').length) {
        root.find('head').prepend('<meta charset="UTF-8"/>');
      }
      if (!root.find('head title').length) {
        root.find('head').append(`<title>${escapeXmlText(title)}</title>`);
      }
      enforceVoidElements($);
      xhtml = $.xml();
    }
  }

  if (!xhtml.includes(`xmlns="${XHTML_NS}"`) && /<html/i.test(xhtml)) {
    xhtml = xhtml.replace(/<html\b/i, `<html xmlns="${XHTML_NS}"`);
  }

  return { xhtml: xhtml.trim(), warnings };
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @throws {Error} if result is empty or still not parseable
 */
export function validateXhtmlStrict(xhtml) {
  const { xhtml: fixed, warnings } = sanitizeXhtml(xhtml);
  if (!fixed || fixed.length < 50) throw new Error('XHTML validation failed: empty document');
  const parser = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (m) => {
        throw new Error(`Invalid XHTML: ${m}`);
      },
      fatalError: (m) => {
        throw new Error(`Invalid XHTML: ${m}`);
      }
    }
  });
  parser.parseFromString(fixed, 'application/xhtml+xml');
  return { xhtml: fixed, warnings };
}

/**
 * Best-effort extraction into canonical page JSON (for migration / regeneration hints).
 * @param {string} xhtml
 * @param {number} pageNumber
 */
export function extractCanonicalFromXhtml(xhtml, pageNumber) {
  const $ = cheerioLoad(xhtml, { xml: { xmlMode: true, decodeEntities: false } }, /<html[\s>]/i.test(xhtml));
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  const wm = viewport.match(/width=(\d+).*height=(\d+)/i);
  const width = wm ? parseInt(wm[1], 10) : 612;
  const height = wm ? parseInt(wm[2], 10) : 792;
  const doc = emptyCanonicalPage(pageNumber, width, height);
  $('body img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    doc.imageBlocks.push({
      id: $(el).attr('id') || `img_${doc.imageBlocks.length + 1}`,
      src: String(src),
      width: parseInt($(el).attr('width') || '0', 10) || undefined,
      height: parseInt($(el).attr('height') || '0', 10) || undefined
    });
  });
  $('body p, body div, body span').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length < 2) return;
    doc.textBlocks.push({
      id: $(el).attr('id') || `t_${doc.textBlocks.length + 1}`,
      text: t
    });
  });
  return doc;
}
