/**
 * Deterministic EPUB auto-fix: parse → detect → fix → serialize (no AI).
 * Uses @xmldom/xmldom for OPF / XHTML / SMIL XML.
 */
import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import mime from 'mime-types';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unpackEpubToDir, packageDirToEpubBuffer } from './epubAiRepairService.js';
import { runEpubcheck } from './epubcheckService.js';
import {
  classifyEpubcheckMessages,
  resolveAutoFixHandlers,
  HANDLER_ORDER
} from './epubFixClassification.js';

// 🔥 SAFE NodeList → Array converter (xmldom production fix)
function toArray(nodeList) {
  const arr = [];
  if (!nodeList) return arr;
  
  // Handle if it's already an array
  if (Array.isArray(nodeList)) return nodeList;
  
  // Check if it has a length property
  if (typeof nodeList.length !== 'number') return arr;
  
  // Manual iteration - safest approach for xmldom
  for (let i = 0; i < nodeList.length; i++) {
    if (nodeList[i]) {
      arr.push(nodeList[i]);
    }
  }
  return arr;
}

// 🔥 SAFE getElementsByTagName wrapper (handles xmldom edge cases)
function safeGetElementsByTagName(element, tagName) {
  if (!element) return [];
  if (typeof element.getElementsByTagName !== 'function') return [];
  
  try {
    const result = element.getElementsByTagName(tagName);
    return toArray(result);
  } catch (e) {
    console.error(`[safeGetElementsByTagName] Error getting ${tagName}:`, e.message);
    return [];
  }
}

const OPF_NS = 'http://www.idpf.org/2007/opf';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
// EPUBCheck expects SMIL 3 namespace.
const SMIL_NS = 'http://www.w3.org/ns/SMIL';
/** EPUB Media Overlays SMIL attributes (e.g. `epub:textref`) */
// EPUBCheck expects `epub:textref` in the OPS namespace (http://www.idpf.org/2007/ops).
const EPUB_NS = 'http://www.idpf.org/2007/ops';
const MEDIA_OVERLAY_PREFIX = 'media: http://www.idpf.org/epub/vocab/overlays/#';

const MANIFEST_MEDIA_EXTS =
  /\.(xhtml|html|htm|xml|opf|css|ncx|svg|txt|json|smil|mp3|mp4|wav|ogg|m4a|woff2?|ttf|otf|png|jpe?g|gif|webp)$/i;

// OPF Media Overlay / Media Properties: keep only known, validator-defined tokens.
// (Prevents OPF-027 "Undefined property" like properties="image/jpeg".)
const VALID_MANIFEST_PROPERTIES_TOKENS = new Set(['nav', 'svg', 'cover-image', 'scripted']);

function normalizeMediaDurationClockValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;

  // Common form: "496.296s" (seconds)
  const secMatch = s.match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
  if (secMatch) {
    const seconds = Number(secMatch[1]);
    if (!Number.isFinite(seconds)) return raw;
    const totalMs = Math.round(seconds * 1000);
    const hh = Math.floor(totalMs / 3600000);
    const mm = Math.floor((totalMs % 3600000) / 60000);
    const ss = Math.floor((totalMs % 60000) / 1000);
    const mmm = totalMs % 1000;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(
      2,
      '0'
    )}.${String(mmm).padStart(3, '0')}`;
  }

  // Already clock: "HH:MM:SS.mmm" or "H:MM:SS.mmm"
  const clk = s.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (clk) {
    const hh = Number(clk[1]);
    const mm = Number(clk[2]);
    const ss = Number(clk[3]);
    const frac = clk[4] || '0';
    // Keep exactly 3 decimals by rounding/truncating.
    const fracNum = Math.round(Number(`0.${frac}`) * 1000);
    const totalSeconds = hh * 3600 + mm * 60 + ss;
    // Recompute with rounding so 59.999 -> ...60 properly.
    const totalMs = Math.round(totalSeconds * 1000 + fracNum);
    const hh2 = Math.floor(totalMs / 3600000);
    const mm2 = Math.floor((totalMs % 3600000) / 60000);
    const ss2 = Math.floor((totalMs % 60000) / 1000);
    const mmm2 = totalMs % 1000;
    return `${String(hh2).padStart(2, '0')}:${String(mm2).padStart(2, '0')}:${String(ss2).padStart(
      2,
      '0'
    )}.${String(mmm2).padStart(3, '0')}`;
  }

  return raw;
}

function normalizeManifestPropertiesAttribute(propValue, changes, whereLabel) {
  const raw = String(propValue || '').trim();
  if (!raw) return raw;
  const tokens = raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const out = tokens.filter((t) => {
    const low = t.toLowerCase();
    if (low === 'media-overlay') return false; // OPF doesn't allow this in properties
    if (low.includes('/') || low.includes(':')) return false; // e.g. image/jpeg -> invalid
    if (!VALID_MANIFEST_PROPERTIES_TOKENS.has(low)) return false;
    return /^[A-Za-z0-9_-]+$/.test(low);
  });
  const next = out.join(' ');
  if (next !== raw && next) {
    changes.push(`${whereLabel}: normalized properties tokens "${raw}" → "${next}"`);
  } else if (next !== raw && !next) {
    changes.push(`${whereLabel}: removed invalid/unknown properties="${raw}"`);
  }
  return next;
}

function removeManifestSelfReferenceOpf(doc, opfRelPath, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  if (!opfRelPath) return;
  const normalizedOpf = normalizeRel(opfRelPath);
  const opfDir = path.posix.dirname(normalizedOpf);
  const items = safeGetElementsByTagName(manifest, 'item');
  let n = 0;
  for (const it of items) {
    const hrefRaw = it.getAttribute('href') || '';
    const href = normalizeRel(hrefRaw);
    const mt = (it.getAttribute('media-type') || '').toLowerCase();
    if (!href) continue;
    const resolved = normalizeRel(path.posix.join(opfDir, hrefRaw.replace(/\\/g, '/')));
    const pointsAtOpf =
      resolved === normalizedOpf ||
      href === normalizedOpf ||
      href.endsWith(`/${normalizedOpf}`);
    const packageMime = mt === 'application/oebps-package+xml';
    if (pointsAtOpf || packageMime) {
      it.parentNode?.removeChild(it);
      n++;
    }
  }
  if (n) changes.push(`manifest: removed ${n} self-referencing item(s) (OPF-099)`);
}

/** RSC-001: drop manifest entries whose href does not resolve to a file in the package. */
function removeManifestItemsForMissingFiles(doc, opfRelPath, relFilesSet, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  if (!opfRelPath) return;
  const opfDir = path.posix.dirname(normalizeRel(opfRelPath));
  const items = safeGetElementsByTagName(manifest, 'item');
  let n = 0;
  for (const it of items) {
    const href = it.getAttribute('href');
    if (!href) continue;
    const resolved = normalizeRel(path.posix.join(opfDir, href.replace(/\\/g, '/')));
    if (relFilesSet.has(resolved)) continue;
    it.parentNode?.removeChild(it);
    n++;
  }
  if (n) changes.push(`manifest: removed ${n} item(s) with missing href target (RSC-001)`);
}

function normalizeMediaDurationsInMetadata(doc, changes) {
  const metadata = doc.getElementsByTagName('metadata')[0];
  if (!metadata) return;
  let n = 0;
  const metas = toArray(metadata.getElementsByTagName('meta'));
  for (const m of metas) {
    const prop = m.getAttribute('property');
    if (prop !== 'media:duration') continue;
    const oldV = (m.textContent || '').trim();
    const nextV = normalizeMediaDurationClockValue(oldV);
    if (nextV && nextV !== oldV) {
      while (m.firstChild) m.removeChild(m.firstChild);
      m.appendChild(doc.createTextNode(nextV));
      n++;
    }
  }
  if (n) changes.push(`metadata: normalized ${n} media:duration value(s) to HH:MM:SS.mmm`);
}

function parseMediaDurationToMs(raw) {
  const norm = normalizeMediaDurationClockValue(raw);
  const clk = norm.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!clk) return 0;
  const hh = Number(clk[1]);
  const mm = Number(clk[2]);
  const ss = Number(clk[3]);
  const mmm = Number(clk[4]);
  return hh * 3600000 + mm * 60000 + ss * 1000 + mmm;
}

function formatMsAsMediaClock(totalMs) {
  const t = Math.max(0, Math.round(totalMs));
  const hh = Math.floor(t / 3600000);
  const mm = Math.floor((t % 3600000) / 60000);
  const ss = Math.floor((t % 60000) / 1000);
  const mmm = t % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(
    2,
    '0'
  )}.${String(mmm).padStart(3, '0')}`;
}

/** MED-016: global media:duration should equal the sum of per-overlay (refined) durations. */
function recalculateGlobalMediaDurationSum(doc, changes) {
  const metadata = doc.getElementsByTagName('metadata')[0];
  if (!metadata) return;
  const metas = toArray(metadata.getElementsByTagName('meta'));
  let sumMs = 0;
  let refineCount = 0;
  for (const m of metas) {
    if (m.getAttribute('property') !== 'media:duration') continue;
    if (!(m.getAttribute('refines') || '').trim()) continue;
    sumMs += parseMediaDurationToMs((m.textContent || '').trim());
    refineCount++;
  }
  if (refineCount === 0) return;

  const globalVal = formatMsAsMediaClock(sumMs);
  let globalMeta = null;
  for (const m of metas) {
    if (m.getAttribute('property') === 'media:duration' && !(m.getAttribute('refines') || '').trim()) {
      globalMeta = m;
      break;
    }
  }
  if (!globalMeta) {
    globalMeta = doc.createElement('meta');
    globalMeta.setAttribute('property', 'media:duration');
    metadata.appendChild(globalMeta);
  }
  const old = (globalMeta.textContent || '').trim();
  if (old === globalVal) return;
  while (globalMeta.firstChild) globalMeta.removeChild(globalMeta.firstChild);
  globalMeta.appendChild(doc.createTextNode(globalVal));
  changes.push('metadata: set global media:duration to sum of overlay refines (MED-016)');
}

function parseXML(xml) {
  return new DOMParser({
    /** @xmldom/xmldom 0.9+ — use onError; errorHandler object is no longer supported */
    onError: () => {}
  }).parseFromString(String(xml || ''), 'application/xml');
}

function serialize(doc) {
  return new XMLSerializer().serializeToString(doc);
}

function normalizeRel(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/** EPUB-internal path from any file + relative href. */
function resolveFromFile(fileRelPath, href) {
  const h = String(href || '').trim();
  if (!h || h.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  const base = path.posix.dirname(normalizeRel(fileRelPath));
  const clean = h.split('#')[0];
  return path.posix.normalize(path.posix.join(base, clean)).replace(/\\/g, '/');
}

async function walkRelativeFiles(rootDir, relBase = '') {
  const out = [];
  const abs = relBase ? path.join(rootDir, ...relBase.split('/')) : rootDir;
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const r = relBase ? `${relBase}/${ent.name}` : ent.name;
    const full = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkRelativeFiles(rootDir, r)));
    } else {
      out.push(r.replace(/\\/g, '/'));
    }
  }
  return out;
}

function getMediaType(filePath) {
  const mt = mime.lookup(filePath);
  if (mt) return mt;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'application/xhtml+xml';
  }
  if (lower.endsWith('.ncx')) return 'application/x-dtbncx+xml';
  if (lower.endsWith('.opf')) return 'application/oebps-package+xml';
  if (lower.endsWith('.smil')) return 'application/smil+xml';
  return 'application/octet-stream';
}

async function readOpfPathFromContainer(extractDir) {
  const containerPath = path.join(extractDir, 'META-INF', 'container.xml');
  if (!(await fs.pathExists(containerPath))) return null;
  const xml = await fs.readFile(containerPath, 'utf8');
  const m = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!m?.[1]) return null;
  return normalizeRel(m[1]);
}

function slugId(rel) {
  let s = normalizeRel(rel).replace(/[^a-zA-Z0-9_-]+/g, '_');
  if (!s || /^\d/.test(s)) s = `id_${s}`;
  return s.slice(0, 120);
}

/** EPUB 3 / EPUBCheck expect W3CDTF without fractional seconds: CCYY-MM-DDThh:mm:ssZ */
function epubDctermsModifiedValue() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const VALID_DCTERMS_MODIFIED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** RFC 4122 URN form (EPUBCheck OPF-085). */
const URN_UUID_FULL =
  /^urn:uuid:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const BARE_UUID =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function isValidUrnUuid(text) {
  return URN_UUID_FULL.test(String(text || '').trim());
}

/**
 * String-level XHTML fix: normalize legacy XHTML 1.0 Strict (etc.) to HTML5 doctype (HTM-004).
 * Apply before parsing.
 */
export function fixDoctypeHtmlString(raw) {
  return String(raw || '').replace(/<!DOCTYPE[\s\S]*?>/i, '<!DOCTYPE html>');
}

/** After xmldom serialize, ensure a single HTML5 doctype (parser may drop or alter it). */
function ensureHtml5DoctypeInOutput(serialized) {
  let s = String(serialized || '');
  if (/<!DOCTYPE/i.test(s)) {
    return s.replace(/<!DOCTYPE[^>]*>/i, '<!DOCTYPE html>');
  }
  const pi = s.match(/^<\?xml[^?]*\?>\s*/);
  if (pi) {
    return s.slice(0, pi[0].length) + '<!DOCTYPE html>\n' + s.slice(pi[0].length);
  }
  return `<!DOCTYPE html>\n${s}`;
}

/** Remove unprefixed `lang` (not `xml:lang`) — invalid in OPF; EPUBCheck RSC-005. */
function removeInvalidLangAttributes(el, changes) {
  if (el.nodeType !== 1 || !el.attributes) return;
  const attrs = el.attributes;
  for (let i = attrs.length - 1; i >= 0; i--) {
    const a = attrs[i];
    if (!a) continue;
    if (a.namespaceURI === 'http://www.w3.org/XML/1998/namespace') continue;
    if (a.prefix === 'xml') continue;
    if (a.prefix) continue;
    const ln = a.localName || '';
    if (ln !== 'lang') continue;
    el.removeAttribute('lang');
    changes.push(`OPF: removed invalid lang on <${el.localName || el.nodeName}>`);
  }
}

/** EPUB 3 OPF: unprefixed `lang` is invalid anywhere under <package>. */
function stripInvalidLangFromOpfSubtree(pkg, changes) {
  const walk = (el) => {
    if (el.nodeType !== 1) return;
    removeInvalidLangAttributes(el, changes);
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(pkg);
}

/** String-level: strip `lang="..."` from <package> open tag (parser may expose attrs inconsistently). */
function stripLangFromPackageOpenTagRaw(xml) {
  return String(xml || '').replace(/<package\b([^>]*)>/i, (_, inner) => {
    const cleaned = inner.replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
    return `<package${cleaned}>`;
  });
}

function ensurePackageMediaOverlayPrefix(pkg, changes) {
  const cur = (pkg.getAttribute('prefix') || '').trim();
  if (!cur) {
    pkg.setAttribute('prefix', MEDIA_OVERLAY_PREFIX);
    changes.push('package: set prefix for media overlay vocabulary (OPF-027)');
    return;
  }
  /** Accept `media: http://...` or `media:http://...` (EPUBCheck / tools vary). */
  if (/\bmedia:\s*http/i.test(cur)) return;
  pkg.setAttribute('prefix', `${cur} ${MEDIA_OVERLAY_PREFIX}`);
  changes.push('package: appended media overlay prefix (OPF-027)');
}

/** EPUB 3: OPF namespace + media: prefix required for manifest media-overlay (always run, not only package handler). */
function ensureEpub3PackageVocabAndPrefix(pkg, changes) {
  if (!pkg.getAttribute('xmlns')) {
    pkg.setAttribute('xmlns', OPF_NS);
    changes.push('package: set xmlns (OPF)');
  }
  ensurePackageMediaOverlayPrefix(pkg, changes);
}

function fixPackageRoot(doc, changes) {
  const pkg = doc.getElementsByTagName('package')[0];
  if (!pkg) return;
  if (!pkg.getAttribute('version')) {
    pkg.setAttribute('version', '3.0');
    changes.push('package: set version=3.0');
  }
  if (!pkg.getAttribute('unique-identifier')) {
    pkg.setAttribute('unique-identifier', 'book-id');
    changes.push('package: set unique-identifier=book-id');
  }
  if (!pkg.getAttribute('xml:lang') && !pkg.getAttribute('lang')) {
    pkg.setAttribute('xml:lang', 'en');
    changes.push('package: set xml:lang=en');
  }
}

function dcElements(metadata, local) {
  const ns = toArray(metadata.getElementsByTagNameNS(DC_NS, local));
  const prefixed = toArray(metadata.getElementsByTagName(`dc:${local}`));
  return ns.length ? ns : prefixed;
}

function ensureDcIdentifier(doc, metadata, changes) {
  const ids = dcElements(metadata, 'identifier');
  if (ids.length) {
    const first = ids[0];
    const idAttr = first.getAttribute('id');
    if (idAttr) return idAttr;
    first.setAttribute('id', 'book-id');
    changes.push('dc:identifier: set id=book-id');
    return 'book-id';
  }
  const el = doc.createElementNS(DC_NS, 'dc:identifier');
  el.setAttribute('id', 'book-id');
  el.appendChild(doc.createTextNode(`urn:uuid:${randomUUID()}`));
  metadata.appendChild(el);
  changes.push('metadata: added dc:identifier');
  return 'book-id';
}

/** True if value is not XML id-safe and appears to be an internal id (not urn/http(s)/mailto URI). */
function shouldNormalizeXmlIdValue(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  const xmlIdSafe = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s);
  if (xmlIdSafe) return false;
  if (/^urn:/i.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (/^mailto:/i.test(s)) return false;
  return true;
}

/** OPF-027: unsupported media:* meta except global media:duration. */
function removeUnsupportedMediaMeta(metadata, changes) {
  const metas = toArray(metadata.getElementsByTagName('meta'));
  for (let i = metas.length - 1; i >= 0; i--) {
    const m = metas[i];
    const prop = (m.getAttribute('property') || '').trim();
    const propLower = prop.toLowerCase();
    const nameAttr = (m.getAttribute('name') || '').trim().toLowerCase();

    /** media-overlay belongs on manifest &lt;item&gt; only — never as metadata property (OPF-027). */
    if (
      propLower === 'media-overlay' ||
      nameAttr === 'media-overlay' ||
      /(^|[/#])media-overlay$/i.test(prop) ||
      propLower.includes('media-overlay')
    ) {
      m.parentNode?.removeChild(m);
      changes.push('metadata: removed invalid media-overlay meta (OPF-027; use manifest item attribute)');
      continue;
    }
    // Keep these because readers use them to decide what CSS classes to toggle for highlighting.
    // Stripping them can make audio play but highlighting stop.
    const keep = new Set(['media:duration', 'media:active-class', 'media:playback-active-class']);
    if (propLower.startsWith('media:') && !keep.has(propLower)) {
      m.parentNode?.removeChild(m);
      changes.push(`metadata: removed unsupported meta property ${prop}`);
    }
  }
}

/** OPF-085: invalid or placeholder dc:identifier values. */
function fixInvalidDcIdentifiers(doc, metadata, changes) {
  const ids = dcElements(metadata, 'identifier');
  for (const el of ids) {
    const raw = (el.textContent || '').trim();
    if (!raw) continue;
    if (/^urn:uuid:/i.test(raw)) {
      if (!isValidUrnUuid(raw)) {
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(doc.createTextNode(`urn:uuid:${randomUUID()}`));
        changes.push('metadata: replaced invalid urn:uuid in dc:identifier');
      }
      continue;
    }
    const bare = raw.match(BARE_UUID);
    if (bare) {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(doc.createTextNode(`urn:uuid:${bare[1].toLowerCase()}`));
      changes.push('metadata: normalized dc:identifier to urn:uuid');
      continue;
    }
    if (/^\d{1,5}$/.test(raw)) {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(doc.createTextNode(`urn:uuid:${randomUUID()}`));
      changes.push('metadata: replaced placeholder numeric dc:identifier with urn:uuid');
    }
  }
}

/**
 * EPUB 3 Media Overlays: each SMIL manifest item needs
 * <meta property="media:duration" refines="#item-id">…</meta> (EPUBCheck RSC-005).
 */
function ensureSmilMediaDurationRefines(doc, changes) {
  const pkg = doc.getElementsByTagName('package')[0];
  if (!pkg) return;
  let metadata = doc.getElementsByTagName('metadata')[0];
  if (!metadata) {
    metadata = doc.createElementNS(OPF_NS, 'metadata');
    if (pkg.firstChild) pkg.insertBefore(metadata, pkg.firstChild);
    else pkg.appendChild(metadata);
    changes.push('metadata: created (for media:duration refines)');
  }

  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;

  const smilItems = toArray(manifest.getElementsByTagName('item')).filter(
    (it) => (it.getAttribute('media-type') || '').toLowerCase() === 'application/smil+xml'
  );
  if (smilItems.length === 0) return;

  const existingRefines = new Set();
  const metaElements = toArray(metadata.getElementsByTagName('meta'));
  for (const m of metaElements) {
    if (m.getAttribute('property') !== 'media:duration') continue;
    const r = (m.getAttribute('refines') || '').trim();
    if (r) existingRefines.add(r);
  }

  for (const item of smilItems) {
    const id = item.getAttribute('id');
    if (!id) continue;
    const ref = `#${id}`;
    if (existingRefines.has(ref)) continue;
    const meta = doc.createElement('meta');
    meta.setAttribute('property', 'media:duration');
    meta.setAttribute('refines', ref);
    meta.appendChild(doc.createTextNode('00:00:00.000'));
    metadata.appendChild(meta);
    existingRefines.add(ref);
    changes.push(`metadata: added media:duration refines=${ref} (placeholder; refine if needed)`);
  }

  /** EPUBCheck also requires a publication-level media:duration (no refines). */
  const hasGlobalDuration = toArray(metadata.getElementsByTagName('meta')).some(
    (m) =>
      m.getAttribute('property') === 'media:duration' && !(m.getAttribute('refines') || '').trim()
  );
  if (!hasGlobalDuration) {
    const meta = doc.createElement('meta');
    meta.setAttribute('property', 'media:duration');
    meta.appendChild(doc.createTextNode('00:00:00.000'));
    metadata.appendChild(meta);
    changes.push('metadata: added global media:duration (placeholder; refine if needed)');
  }

  // Media-overlay highlighting: readers toggle classes based on these meta properties.
  const ensureMetaProp = (prop, value) => {
    const exists = toArray(metadata.getElementsByTagName('meta')).some(
      (m) => m.getAttribute('property') === prop
    );
    if (exists) return;
    const meta = doc.createElement('meta');
    meta.setAttribute('property', prop);
    meta.appendChild(doc.createTextNode(value));
    metadata.appendChild(meta);
    changes.push(`metadata: added ${prop} for media overlay highlighting`);
  };

  ensureMetaProp('media:active-class', '-epub-media-overlay-active');
  ensureMetaProp('media:playback-active-class', '-epub-media-overlay-playing');
}

function fixMetadata(doc, isEpub3, changes) {
  let metadata = doc.getElementsByTagName('metadata')[0];
  if (!metadata) {
    metadata = doc.createElementNS(OPF_NS, 'metadata');
    const pkg = doc.getElementsByTagName('package')[0];
    if (pkg) {
      if (pkg.firstChild) pkg.insertBefore(metadata, pkg.firstChild);
      else pkg.appendChild(metadata);
    } else {
      doc.documentElement?.appendChild(metadata);
    }
    changes.push('metadata: created');
  }

  if (!dcElements(metadata, 'title').length) {
    const title = doc.createElementNS(DC_NS, 'dc:title');
    title.appendChild(doc.createTextNode('Untitled'));
    metadata.appendChild(title);
    changes.push('metadata: added dc:title');
  }

  if (!dcElements(metadata, 'language').length) {
    const lang = doc.createElementNS(DC_NS, 'dc:language');
    lang.appendChild(doc.createTextNode('en'));
    metadata.appendChild(lang);
    changes.push('metadata: added dc:language');
  }

  const emptySubjects = dcElements(metadata, 'subject').filter((el) => !(el.textContent || '').trim());
  for (const el of emptySubjects) {
    el.parentNode?.removeChild(el);
  }
  if (emptySubjects.length) {
    changes.push(`metadata: removed ${emptySubjects.length} empty dc:subject element(s)`);
  }

  const pkg = doc.getElementsByTagName('package')[0];
  const uid = pkg?.getAttribute('unique-identifier') || 'book-id';
  ensureDcIdentifier(doc, metadata, changes);
  removeUnsupportedMediaMeta(metadata, changes);
  fixInvalidDcIdentifiers(doc, metadata, changes);
  if (pkg && !pkg.getAttribute('unique-identifier')) {
    pkg.setAttribute('unique-identifier', uid);
  }

  if (isEpub3) {
    const metas = toArray(metadata.getElementsByTagName('meta'));
    const dmods = metas.filter(
      (m) =>
        m.getAttribute('property') === 'dcterms:modified' ||
        m.getAttribute('name') === 'dcterms:modified'
    );
    if (dmods.length > 1) {
      for (let i = 1; i < dmods.length; i++) {
        dmods[i].parentNode?.removeChild(dmods[i]);
        changes.push('metadata: removed duplicate dcterms:modified');
      }
    }
    const dmod = dmods[0];
    if (dmod) {
      const text = (dmod.textContent || '').trim();
      if (!VALID_DCTERMS_MODIFIED.test(text)) {
        while (dmod.firstChild) dmod.removeChild(dmod.firstChild);
        dmod.appendChild(doc.createTextNode(epubDctermsModifiedValue()));
        changes.push('metadata: normalized dcterms:modified (EPUBCheck W3CDTF)');
      }
    } else {
      const meta = doc.createElement('meta');
      meta.setAttribute('property', 'dcterms:modified');
      meta.appendChild(doc.createTextNode(epubDctermsModifiedValue()));
      metadata.appendChild(meta);
      changes.push('metadata: added dcterms:modified');
    }
  }
}

function manifestItemHrefs(doc) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest) return new Set();
  const set = new Set();
  for (let i = 0; i < manifest.childNodes.length; i++) {
    const n = manifest.childNodes[i];
    if (n.nodeType === 1 && n.localName === 'item') {
      const href = n.getAttribute('href');
      if (href) set.add(normalizeRel(href));
    }
  }
  return set;
}

function spineIdrefs(doc) {
  const spine = doc.getElementsByTagName('spine')[0];
  if (!spine) return new Set();
  const set = new Set();
  for (let i = 0; i < spine.childNodes.length; i++) {
    const n = spine.childNodes[i];
    if (n.nodeType === 1 && n.localName === 'itemref') {
      const idref = n.getAttribute('idref');
      if (idref) set.add(idref);
    }
  }
  return set;
}

function isNavItem(item) {
  const props = (item.getAttribute('properties') || '').toLowerCase();
  return /\bnav\b/.test(props);
}

function fixManifest(doc, opfRelPath, relFilesSet, changes) {
  let manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest) {
    manifest = doc.createElementNS(OPF_NS, 'manifest');
    doc.documentElement.appendChild(manifest);
    changes.push('manifest: created');
  }

  const existingHref = manifestItemHrefs(doc);
  const usedIds = new Set();
  for (let i = 0; i < manifest.childNodes.length; i++) {
    const n = manifest.childNodes[i];
    if (n.nodeType === 1 && n.localName === 'item') {
      const id = n.getAttribute('id');
      if (id) usedIds.add(id);
    }
  }

  let added = 0;
  for (const rel of relFilesSet) {
    if (rel === normalizeRel(opfRelPath)) continue;
    // Never auto-list META-INF or mimetype — causes PKG-025 / invalid publication resources.
    if (/^META-INF\//i.test(rel)) continue;
    if (/^mimetype$/i.test(rel)) continue;
    if (!MANIFEST_MEDIA_EXTS.test(rel)) continue;
    const hrefFromOpf = path.posix.relative(path.posix.dirname(opfRelPath), rel).replace(/\\/g, '/');
    if (existingHref.has(normalizeRel(hrefFromOpf))) continue;

    const item = doc.createElementNS(OPF_NS, 'item');
    let id = slugId(rel);
    while (usedIds.has(id)) id = `${id}_x`;
    usedIds.add(id);
    item.setAttribute('id', id);
    item.setAttribute('href', hrefFromOpf);
    item.setAttribute('media-type', getMediaType(rel));
    manifest.appendChild(item);
    added++;
  }
  if (added) changes.push(`manifest: added ${added} missing item(s)`);
}

function fixSpine(doc, changes) {
  const pkg = doc.getElementsByTagName('package')[0];
  const v = (pkg?.getAttribute('version') || '3.0').trim();
  const isEpub3 = v.startsWith('3');

  let spine = doc.getElementsByTagName('spine')[0];
  if (!spine) {
    spine = doc.createElementNS(OPF_NS, 'spine');
    doc.documentElement.appendChild(spine);
    changes.push('spine: created');
  }

  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest) return;

  if (isEpub3) {
    const items = toArray(manifest.getElementsByTagName('item'));
    let removed = 0;
    for (const it of items) {
      const mt = (it.getAttribute('media-type') || '').toLowerCase();
      if (mt === 'application/x-dtbncx+xml') {
        it.parentNode?.removeChild(it);
        removed++;
      }
    }
    if (removed) {
      changes.push(
        `manifest: removed ${removed} NCX item(s) for EPUB 3 (use nav.xhtml as table of contents)`
      );
    }
    if (spine.hasAttribute('toc')) {
      spine.removeAttribute('toc');
      changes.push('spine: removed toc attribute for EPUB 3 (nav.xhtml-only TOC)');
    }
  }

  const idrefs = spineIdrefs(doc);
  let added = 0;

  for (let i = 0; i < manifest.childNodes.length; i++) {
    const n = manifest.childNodes[i];
    if (n.nodeType !== 1 || n.localName !== 'item') continue;
    const mt = (n.getAttribute('media-type') || '').toLowerCase();
    if (mt !== 'application/xhtml+xml') continue;
    if (isNavItem(n)) continue;
    const id = n.getAttribute('id');
    if (!id || idrefs.has(id)) continue;
    const ref = doc.createElementNS(OPF_NS, 'itemref');
    ref.setAttribute('idref', id);
    spine.appendChild(ref);
    idrefs.add(id);
    added++;
  }
  if (added) changes.push(`spine: added ${added} missing itemref(s)`);
}

function ensureNav(doc, opfRelPath, relFiles, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;

  const hasNav = toArray(manifest.childNodes).some(
    (n) =>
      n.nodeType === 1 &&
      n.localName === 'item' &&
      /\bnav\b/i.test(n.getAttribute('properties') || '')
  );
  if (hasNav) return;

  const navFile = relFiles.find((f) => /(^|\/)nav\.xhtml$/i.test(f));
  if (!navFile) return;

  const usedIds = new Set();
  for (let i = 0; i < manifest.childNodes.length; i++) {
    const n = manifest.childNodes[i];
    if (n.nodeType === 1 && n.localName === 'item') {
      const id = n.getAttribute('id');
      if (id) usedIds.add(id);
    }
  }
  let navId = 'nav';
  while (usedIds.has(navId)) navId = `${navId}_x`;

  const href = path.posix.relative(path.posix.dirname(opfRelPath), navFile).replace(/\\/g, '/');
  const item = doc.createElementNS(OPF_NS, 'item');
  item.setAttribute('id', navId);
  item.setAttribute('href', href);
  item.setAttribute('media-type', 'application/xhtml+xml');
  item.setAttribute('properties', 'nav');
  manifest.appendChild(item);
  changes.push(`manifest: added nav (${href})`);
}

function fixXhtmlDoc(doc, changes) {
  const html = doc.getElementsByTagName('html')[0];
  if (!html) {
    throw new Error('Invalid XHTML: missing html root');
  }
  if (!doc.getElementsByTagName('head')[0]) {
    const head = doc.createElementNS('http://www.w3.org/1999/xhtml', 'head');
    html.insertBefore(head, html.firstChild);
    changes.push('xhtml: inserted head');
  }
  if (!doc.getElementsByTagName('body')[0]) {
    const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'body');
    html.appendChild(body);
    changes.push('xhtml: inserted body');
  }
}

function sanitizeMediaOverlayCssInXhtml(doc, changes) {
  const styles = toArray(doc.getElementsByTagName('style'));
  let n = 0;
  for (const st of styles) {
    const raw = st.textContent || '';
    if (
      !raw.includes('epub-media-overlay-active') &&
      !raw.includes('epub-media-overlay-playing') &&
      !raw.includes('smilActive') &&
      !raw.includes('readium-smil-active')
    ) {
      continue;
    }

    let next = raw;
    // If the reader puts the active class on <body>/<html>, ancestor selectors will style ALL sync words.
    // Keep only element-level selectors (e.g. `.sync-word.-epub-media-overlay-active`) by removing the risky ancestor patterns.
    next = next.replace(/\[class\*=['"]epub-media-overlay-active['"]\]\s+\.(sync-word|sync-sentence)\s*,?\s*/gi, '');
    next = next.replace(/\[class\*=['"]epub-media-overlay-playing['"]\]\s+\.(sync-word|sync-sentence)\s*,?\s*/gi, '');
    next = next.replace(/\.smilActive\s+\.(sync-word|sync-sentence)\s*,?\s*/gi, '');
    next = next.replace(/\.readium-smil-active\s+\.(sync-word|sync-sentence)\s*,?\s*/gi, '');
    next = next.replace(/\.sync-active\s+\.(sync-word|sync-sentence)\s*,?\s*/gi, '');
    // Cleanup: remove stray commas before a block open.
    next = next.replace(/,\s*\{/g, ' {');
    next = next.replace(/\{\s*,/g, '{');

    if (next !== raw) {
      while (st.firstChild) st.removeChild(st.firstChild);
      st.appendChild(doc.createTextNode(next));
      n++;
    }
  }
  if (n) changes.push(`xhtml: sanitized media overlay CSS selectors in ${n} <style> block(s)`);
}

function fixLang(doc, changes) {
  const html = doc.getElementsByTagName('html')[0];
  if (!html) return;
  if (!html.getAttribute('xml:lang')) {
    html.setAttribute('xml:lang', 'en');
    changes.push('xhtml: set xml:lang=en');
  }
}

function fixLinks(doc, fileRelPath, relFilesSet, changes) {
  const links = toArray(doc.getElementsByTagName('a'));
  let stripped = 0;
  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) continue;
    const resolved = resolveFromFile(fileRelPath, href);
    if (!resolved) continue;
    if (!relFilesSet.has(resolved)) {
      a.removeAttribute('href');
      stripped++;
    }
  }
  if (stripped) changes.push(`xhtml ${fileRelPath}: removed ${stripped} broken link(s)`);
}

/** EPUB 3: <spine> and <itemref> do not allow media-overlay (RSC-005). */
function removeInvalidMediaOverlayFromSpine(doc, changes) {
  const spine = doc.getElementsByTagName('spine')[0];
  if (!spine) return;
  if (spine.hasAttribute('media-overlay')) {
    spine.removeAttribute('media-overlay');
    changes.push('spine: removed invalid media-overlay');
  }
  const refs = toArray(spine.getElementsByTagName('itemref'));
  let n = 0;
  for (let i = 0; i < refs.length; i++) {
    if (refs[i].hasAttribute('media-overlay')) {
      refs[i].removeAttribute('media-overlay');
      n++;
    }
  }
  if (n) changes.push(`spine: removed invalid media-overlay from ${n} itemref(s)`);
}

/** OPF: media-overlay is an <item> attribute, not a manifest properties token (OPF-027). */
function removeInvalidMediaOverlayManifestProperty(doc, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  const items = toArray(manifest.getElementsByTagName('item'));
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const props = (items[i].getAttribute('properties') || '').trim();
    if (!props) continue;
    const next = props
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t.toLowerCase() !== 'media-overlay')
      .join(' ');
    if (next === props) continue;
    if (next) items[i].setAttribute('properties', next);
    else items[i].removeAttribute('properties');
    n++;
  }
  if (n) {
    changes.push(`manifest: removed invalid media-overlay property token from ${n} item(s)`);
  }
}

function toValidXmlId(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  // XML Name / NCName safe subset for EPUB ids:
  // start: letter/_ ; rest: letter/digit/_/./-
  let out = s.replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!/^[A-Za-z_]/.test(out)) out = `id_${out}`;
  out = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!out) out = 'id_auto';
  if (!/^[A-Za-z_]/.test(out)) out = `id_${out}`;
  return out;
}

/** OPF: id / xml:id must be XML Name-safe (NCName-ish). Rewrite idref/refines/media-overlay/#fragments as needed. */
function fixOpfIdsWithColons(doc, changes) {
  const pkg = doc.getElementsByTagName('package')[0];
  if (!pkg) return;
  const idMap = new Map();

  const fixIdAttr = (el, attrName) => {
    const id = el.getAttribute(attrName);
    if (!id || !shouldNormalizeXmlIdValue(id)) return;
    const n = toValidXmlId(id);
    if (n === id) return;
    idMap.set(id, n);
    el.setAttribute(attrName, n);
  };

  const collect = (el) => {
    if (el.nodeType !== 1) return;
    fixIdAttr(el, 'id');
    fixIdAttr(el, 'xml:id');
    for (let c = el.firstChild; c; c = c.nextSibling) collect(c);
  };
  collect(pkg);

  if (!idMap.size) return;
  changes.push(`OPF: normalized ${idMap.size} id/xml:id value(s) to XML-safe names`);

  const rewrite = (el) => {
    if (el.nodeType !== 1) return;
    const idref = el.getAttribute('idref');
    if (idref && idMap.has(idref)) el.setAttribute('idref', idMap.get(idref));
    const mo = el.getAttribute('media-overlay');
    if (mo && idMap.has(mo)) el.setAttribute('media-overlay', idMap.get(mo));
    const refines = el.getAttribute('refines');
    if (refines && refines.startsWith('#')) {
      const oid = refines.slice(1);
      if (idMap.has(oid)) el.setAttribute('refines', `#${idMap.get(oid)}`);
    }
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      if (!a) continue;
      const name = (a.name || '').toLowerCase();
      if (name !== 'href') continue;
      const v = a.value || '';
      const h = v.indexOf('#');
      if (h < 0) continue;
      const frag = v.slice(h + 1);
      if (idMap.has(frag)) el.setAttribute(a.name, `${v.slice(0, h + 1)}${idMap.get(frag)}`);
    }
    for (let c = el.firstChild; c; c = c.nextSibling) rewrite(c);
  };
  rewrite(pkg);
}

/**
 * String-level SMIL fix before parse: XML declaration + canonical &lt;smil xmlns&gt; root (fixes "expected ns:smil").
 * Unprefixed root; never emit prefix-only smil.
 */
export function normalizeSmilRawXml(raw) {
  let s = String(raw || '').replace(/^\uFEFF/, '');
  if (!/^\s*<\?xml/i.test(s)) {
    s = `<?xml version="1.0" encoding="UTF-8"?>\n${s.trimStart()}`;
  }
  // Canonicalize the first SMIL opening tag to avoid duplicate xmlns declarations.
  // Keep only safe attributes (currently `id`) so xmldom can parse reliably.
  s = s.replace(
    /<([A-Za-z_][\w.-]*:)?smil\b[^>]*>/i,
    (m) => {
      const idMatch = m.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const id = idMatch ? idMatch[1] || idMatch[2] : '';
      const idPart = id ? ` id="${id}"` : '';
      return `<smil xmlns="${SMIL_NS}" xmlns:epub="${EPUB_NS}" version="3.0"${idPart}>`;
    }
  );

  return s;
}

/**
 * EPUBCheck RSC-005: some fixed-layout exports generate truncated SMIL like:
 *   <smil>...<body>
 * (missing closing tags / required children).
 *
 * This is a *string-level* repair that only triggers when the SMIL appears incomplete.
 * It rewrites the file into a minimal, well-formed SMIL 3 document and (when possible)
 * points `epub:textref` / `text@src` at the matching page XHTML.
 */
function repairTruncatedSmilRawXml(raw, smilRelPath, relFilesSet, changes) {
  const s = String(raw || '').replace(/^\uFEFF/, '');

  // Fast path: looks like it has the essential closing tags.
  const hasSmilOpen = /<([A-Za-z_][\w.-]*:)?smil\b/i.test(s);
  const hasSmilClose = /<\/([A-Za-z_][\w.-]*:)?smil\s*>/i.test(s);
  const hasBodyOpen = /<([A-Za-z_][\w.-]*:)?body\b/i.test(s);
  const hasBodyClose = /<\/([A-Za-z_][\w.-]*:)?body\s*>/i.test(s);
  if (hasSmilOpen && hasSmilClose && (!hasBodyOpen || hasBodyClose)) return raw;

  // Attempt to reuse any XHTML reference already present.
  let xhtmlRel = null;
  const mSrc = s.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  if (mSrc?.[1] || mSrc?.[2]) {
    const v = (mSrc[1] || mSrc[2] || '').trim();
    const filePart = normalizeRel(v.split('#')[0]);
    const resolved = resolveFromFile(smilRelPath, filePart);
    if (resolved && /\.(xhtml|html|htm)$/i.test(resolved) && relFilesSet?.has(resolved)) {
      // Use path relative to the SMIL file per MO conventions.
      xhtmlRel = path.posix.relative(path.posix.dirname(smilRelPath), resolved).replace(/\\/g, '/');
    }
  }

  // Heuristic for fixed-layout: `EPUB/page10.smil` usually pairs with `EPUB/page10.xhtml`.
  if (!xhtmlRel) {
    const base = path.posix.basename(smilRelPath).replace(/\.smil$/i, '');
    const candidateAbs = normalizeRel(path.posix.join(path.posix.dirname(smilRelPath), `${base}.xhtml`));
    if (relFilesSet?.has(candidateAbs)) {
      xhtmlRel = `${base}.xhtml`;
    } else {
      const candidateAbsHtml = normalizeRel(path.posix.join(path.posix.dirname(smilRelPath), `${base}.html`));
      if (relFilesSet?.has(candidateAbsHtml)) xhtmlRel = `${base}.html`;
    }
  }

  const epubTextrefAttr = xhtmlRel ? ` epub:textref="${xhtmlRel}"` : '';
  const textSrcAttr = xhtmlRel ? ` src="${xhtmlRel}"` : '';

  const repaired = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<smil xmlns="${SMIL_NS}" xmlns:epub="${EPUB_NS}" version="3.0">\n` +
    `  <head></head>\n` +
    `  <body>\n` +
    `    <seq${epubTextrefAttr}>\n` +
    `      <par>\n` +
    `        <text${textSrcAttr}/>\n` +
    `      </par>\n` +
    `    </seq>\n` +
    `  </body>\n` +
    `</smil>\n`;

  changes.push(`smil ${smilRelPath}: rebuilt truncated/invalid SMIL structure (RSC-005 body incomplete)`);
  return repaired;
}

function ensureSmilOutputXmlDeclaration(serialized) {
  const t = String(serialized || '').trimStart();
  if (/^<\?xml/i.test(t)) return serialized;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${t}`;
}

/** EPUB 3 Media Overlays (MED-010): XHTML items must declare media-overlay pointing at the SMIL manifest id. */
async function linkMediaOverlayFromSmilTextRefs(
  extractDir,
  doc,
  opfRelPath,
  relFilesSet,
  changes
) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  const opfDir = path.posix.dirname(opfRelPath);

  const itemByRootRel = new Map();
  const smilItems = [];
  for (let i = 0; i < manifest.childNodes.length; i++) {
    const n = manifest.childNodes[i];
    if (n.nodeType !== 1 || n.localName !== 'item') continue;
    const href = n.getAttribute('href');
    if (!href) continue;
    const rootRel = normalizeRel(path.posix.join(opfDir, href));
    itemByRootRel.set(rootRel, n);
    const mt = (n.getAttribute('media-type') || '').toLowerCase();
    if (mt === 'application/smil+xml') {
      smilItems.push({ el: n, href, id: n.getAttribute('id') });
    }
  }

  let linked = 0;
  for (const { href: smilHref, id: smilId } of smilItems) {
    if (!smilId) continue;
    const smilRootRel = normalizeRel(path.posix.join(opfDir, smilHref));
    const abs = path.join(extractDir, ...smilRootRel.split('/'));
    let raw;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const smilDoc = parseXML(normalizeSmilRawXml(raw));
    const texts = toArray(smilDoc.getElementsByTagName('text'));
    const xhtmlRoots = new Set();
    for (let i = 0; i < texts.length; i++) {
      const src = texts[i].getAttribute('src');
      if (!src) continue;
      const filePart = normalizeRel(src.split('#')[0]);
      const resolved = resolveFromFile(smilRootRel, filePart);
      if (!resolved || !relFilesSet.has(resolved)) continue;
      if (!/\.(xhtml|html|htm)$/i.test(resolved)) continue;
      xhtmlRoots.add(resolved);
    }
    for (const xhtmlRoot of xhtmlRoots) {
      const xhtmlItem = itemByRootRel.get(xhtmlRoot);
      if (!xhtmlItem) continue;
      const mt = (xhtmlItem.getAttribute('media-type') || '').toLowerCase();
      if (mt !== 'application/xhtml+xml' && mt !== 'text/html') continue;
      xhtmlItem.setAttribute('media-overlay', smilId);
      linked++;
    }
  }
  if (linked) {
    changes.push(
      `manifest: set media-overlay on ${linked} XHTML item(s) (linked from SMIL <text> → SMIL manifest id)`
    );
  }
}

/** RSC-026 / manifest: font paths and MIME types (no ../EPUB/ leaks; font/* types). */
function normalizeFontManifestItems(doc, opfRelPath, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  const items = toArray(manifest.getElementsByTagName('item'));
  let n = 0;
  for (const item of items) {
    let href = item.getAttribute('href');
    if (!href) continue;
    const orig = href;
    href = href.replace(/^(?:\.\.\/)+EPUB\//i, '').replace(/^EPUB\//i, '');
    if (href !== orig) {
      item.setAttribute('href', href);
      changes.push(`manifest: normalized href ${orig} → ${href}`);
      n++;
    }
    const lower = href.toLowerCase();
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    if (/\.ttf$/i.test(lower) && (mt === 'application/x-font-ttf' || mt === 'application/octet-stream')) {
      item.setAttribute('media-type', 'font/ttf');
      n++;
    } else if (/\.otf$/i.test(lower) && mt === 'application/octet-stream') {
      item.setAttribute('media-type', 'font/otf');
      n++;
    } else if (/\.woff2$/i.test(lower) && mt !== 'font/woff2') {
      item.setAttribute('media-type', 'font/woff2');
      n++;
    } else if (/\.woff$/i.test(lower) && mt !== 'font/woff' && mt !== 'application/font-woff') {
      item.setAttribute('media-type', 'font/woff');
      n++;
    }
  }
  if (n) changes.push(`manifest: font path/MIME normalization (${n} change(s))`);
}

function mergeManifestProperties(item, token) {
  const cur = (item.getAttribute('properties') || '').trim();
  const set = new Set(cur.split(/\s+/).filter(Boolean));
  if (set.has(token)) return false;
  set.add(token);
  item.setAttribute('properties', [...set].join(' '));
  return true;
}

function xhtmlLikelyUsesSvg(raw) {
  const s = String(raw || '');
  return (
    /<\s*svg\b/i.test(s) ||
    /<[^>]+\bsvg\s*:/i.test(s) ||
    /\.svg(\s|"|'|#|\?)/i.test(s) ||
    /<(?:img|object|embed)[^>]+(?:src|data)\s*=\s*["'][^"']*\.svg/i.test(s)
  );
}

/**
 * EPUB 3: declare properties="svg" on manifest items whose XHTML references SVG (RSC-005 / OPF).
 */
async function ensureSvgPropertyOnManifestItems(extractDir, doc, opfRelPath, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  const opfDir = path.posix.dirname(opfRelPath);
  const items = toArray(manifest.getElementsByTagName('item'));
  let updated = 0;
  for (const item of items) {
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    if (mt !== 'application/xhtml+xml' && mt !== 'text/html') continue;
    const href = item.getAttribute('href');
    if (!href) continue;
    const relPath = path.posix
      .normalize(path.posix.join(opfDir, href))
      .replace(/\\/g, '/');
    const abs = path.join(extractDir, ...relPath.split('/'));
    let raw;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    if (!xhtmlLikelyUsesSvg(raw)) continue;
    if (mergeManifestProperties(item, 'svg')) updated++;
  }
  if (updated) changes.push(`manifest: added properties=svg to ${updated} item(s) that reference SVG`);
}

function xhtmlLikelyUsesScript(raw) {
  return /<\s*script\b/i.test(String(raw || ''));
}

/** EPUB 3: declare properties="scripted" on manifest items whose XHTML contains &lt;script&gt; (OPF-014). */
async function ensureScriptedPropertyOnManifestItems(extractDir, doc, opfRelPath, changes) {
  const manifest = doc.getElementsByTagName('manifest')[0];
  if (!manifest || typeof manifest.getElementsByTagName !== 'function') return;
  const opfDir = path.posix.dirname(opfRelPath);
  const items = toArray(manifest.getElementsByTagName('item'));
  let updated = 0;
  for (const item of items) {
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    if (mt !== 'application/xhtml+xml' && mt !== 'text/html') continue;
    const href = item.getAttribute('href');
    if (!href) continue;
    const relPath = path.posix
      .normalize(path.posix.join(opfDir, href))
      .replace(/\\/g, '/');
    const abs = path.join(extractDir, ...relPath.split('/'));
    let raw;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    if (!xhtmlLikelyUsesScript(raw)) continue;
    if (mergeManifestProperties(item, 'scripted')) updated++;
  }
  if (updated) {
    changes.push(`manifest: added properties=scripted to ${updated} item(s) with embedded script`);
  }
}

function getEpubTypeAttr(el) {
  if (!el || typeof el.getAttribute !== 'function') return '';
  return (
    el.getAttribute('epub:type') ||
    el.getAttribute('type') ||
    (typeof el.getAttributeNS === 'function'
      ? el.getAttributeNS('http://www.idpf.org/2007/ops', 'type')
      : '') ||
    ''
  );
}

/** True if element has a direct child &lt;a&gt; or &lt;span&gt; (EPUB nav &lt;li&gt; content model). */
function liHasDirectNavLabelChild(li) {
  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const ln = String(c.localName || '').toLowerCase();
    if (ln === 'a' || ln === 'span') return true;
  }
  return false;
}

/** NAV-001 / RSC-005: dedupe landmark links by (epub:type + target path). */
function dedupeNavLandmarksInNavDoc(doc, changes, label) {
  const navs = toArray(doc.getElementsByTagName('nav'));
  let removed = 0;
  for (let i = 0; i < navs.length; i++) {
    const nav = navs[i];
    const type = getEpubTypeAttr(nav);
    if (String(type).trim().toLowerCase() !== 'landmarks') continue;
    const seen = new Set();
    const links = toArray(nav.getElementsByTagName('a'));
    for (const a of links) {
      const href = (a.getAttribute('href') || '').trim();
      if (!href) continue;
      const epubType = String(getEpubTypeAttr(a) || '').trim().toLowerCase();
      const key = `${epubType}::${href.split('#')[0]}`;
      if (seen.has(key)) {
        // Removing only <a> leaves <li> invalid (must contain <a> or <span>). Remove the whole <li>.
        const parent = a.parentNode;
        if (parent && String(parent.localName || '').toLowerCase() === 'li') {
          parent.parentNode?.removeChild(parent);
        } else {
          a.parentNode?.removeChild(a);
        }
        removed++;
      } else {
        seen.add(key);
      }
    }
    // Sweep: any remaining <li> without direct <a>/<span> (e.g. empty after edits).
    const lis = toArray(nav.getElementsByTagName('li'));
    for (const li of lis) {
      if (!liHasDirectNavLabelChild(li)) {
        li.parentNode?.removeChild(li);
        removed++;
      }
    }
  }
  if (removed) changes.push(`${label}: removed ${removed} duplicate/invalid landmark item(s)`);
}

/** XHTML/SMIL: remove unprefixed lang (EPUB uses xml:lang on root). */
function stripUnprefixedLangFromDoc(doc, changes, label) {
  const all = toArray(doc.getElementsByTagName('*'));
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.hasAttribute('lang')) {
      el.removeAttribute('lang');
      n++;
    }
  }
  if (n) changes.push(`${label}: removed ${n} unprefixed lang attribute(s)`);
}

/** Fix id attributes containing colons and same-document #fragment refs (RSC-005). */
function fixXmlIdsWithColonsInDoc(doc, changes, label) {
  const idMap = new Map();
  const all = toArray(doc.getElementsByTagName('*'));
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const id = el.getAttribute('id');
    if (id && id.includes(':')) {
      const n = id.replace(/:/g, '_');
      idMap.set(id, n);
      el.setAttribute('id', n);
    }
  }
  if (!idMap.size) return;
  changes.push(`${label}: normalized ${idMap.size} id(s) containing colons`);

  const linkAttrs = ['href', 'src', 'data', 'poster'];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    for (const an of linkAttrs) {
      const v = el.getAttribute(an);
      if (!v || !v.includes('#')) continue;
      const h = v.indexOf('#');
      const frag = v.slice(h + 1);
      if (idMap.has(frag)) el.setAttribute(an, `${v.slice(0, h + 1)}${idMap.get(frag)}`);
    }
    const xlink = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (xlink && xlink.includes('#')) {
      const h = xlink.indexOf('#');
      const frag = xlink.slice(h + 1);
      if (idMap.has(frag)) {
        el.setAttributeNS(
          'http://www.w3.org/1999/xlink',
          'href',
          `${xlink.slice(0, h + 1)}${idMap.get(frag)}`
        );
      }
    }
  }
}

/** EPUBCheck: id values must be unique within XML document (RSC-005). Keep first occurrence; strip later duplicates.
 * Stripping (instead of renaming) avoids breaking SMIL `#fragment` targets which often assume the first ID wins.
 */
function fixDuplicateXmlIdsInDoc(doc, changes, label) {
  const seen = new Set();
  const all = toArray(doc.getElementsByTagName('*'));
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const id = el.getAttribute('id');
    if (!id) continue;
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    el.removeAttribute('id');
    n++;
  }
  if (n) changes.push(`${label}: removed ${n} duplicate id attribute(s) (kept first occurrence)`);
}

function fixSmilRootNamespace(smilDoc, changes, smilPath) {
  const root = smilDoc.documentElement;
  if (!root || String(root.localName || '').toLowerCase() !== 'smil') return;
  if (root.getAttribute('xmlns') !== SMIL_NS) {
    root.setAttribute('xmlns', SMIL_NS);
    changes.push(`smil ${smilPath}: set xmlns on root`);
  }
  // Force correct overlays namespace; some inputs bind `epub:` to the wrong URI.
  if (root.getAttribute('xmlns:epub') !== EPUB_NS) {
    root.setAttribute('xmlns:epub', EPUB_NS);
    changes.push(`smil ${smilPath}: set xmlns:epub on root`);
  }
  if (!root.getAttribute('version')) {
    root.setAttribute('version', '3.0');
    changes.push(`smil ${smilPath}: set version=3.0`);
  }
}

function removeEmptySeqs(smilDoc, changes, smilPath) {
  const seqs = toArray(smilDoc.getElementsByTagName('seq'));
  let removed = 0;
  for (const seq of seqs) {
    let hasChild = false;
    for (let c = seq.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const ln = String(c.localName || '').toLowerCase();
      if (ln === 'par' || ln === 'seq') {
        hasChild = true;
        break;
      }
    }
    if (!hasChild) {
      seq.parentNode?.removeChild(seq);
      removed++;
    }
  }
  if (removed) changes.push(`smil ${smilPath}: removed ${removed} empty <seq> element(s)`);
}

async function collectXmlIdsFromXhtml(extractDir, xhtmlRel) {
  const abs = path.join(extractDir, ...xhtmlRel.split('/'));
  let raw;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
  let doc;
  try {
    doc = parseXML(String(raw || ''));
  } catch {
    return null;
  }
  const set = new Set();
  const all = toArray(doc.getElementsByTagName('*'));
  for (let i = 0; i < all.length; i++) {
    const id = all[i].getAttribute('id');
    if (id) set.add(id);
  }
  return set;
}

/**
 * Media overlays runtime: ensure every SMIL <text src="x.xhtml#frag"> points at an existing id in the XHTML.
 * If the fragment doesn't exist but a normalized variant does, rewrite src to the normalized fragment.
 */
async function repairSmilTextSrcFragmentTargets(extractDir, smilRootRel, smilDoc, relFilesSet, changes, smilPath) {
  const texts = toArray(smilDoc.getElementsByTagName('text'));
  if (!texts || !texts.length) return;

  const smilDir = path.posix.dirname(smilRootRel);
  const idCache = new Map(); // xhtmlRel -> Set(ids)
  let rewrites = 0;

  for (let i = 0; i < texts.length; i++) {
    const el = texts[i];
    const src = el.getAttribute('src');
    if (!src || !src.includes('#')) continue;
    const [filePartRaw, fragRaw] = src.split('#');
    const filePart = normalizeRel(filePartRaw);
    const frag = fragRaw || '';
    if (!filePart || !frag) continue;

    const resolved = resolveFromFile(smilRootRel, filePart);
    if (!resolved || !/\.(xhtml|html|htm)$/i.test(resolved)) continue;
    if (relFilesSet && !relFilesSet.has(resolved)) continue;

    let ids = idCache.get(resolved);
    if (!ids) {
      ids = await collectXmlIdsFromXhtml(extractDir, resolved);
      if (!ids) {
        idCache.set(resolved, null);
      } else {
        idCache.set(resolved, ids);
      }
    }
    if (!ids) continue;
    if (ids.has(frag)) continue;

    const candidates = [];
    candidates.push(frag.replace(/:/g, '_'));
    candidates.push(toValidXmlId(frag));
    const nextFrag = candidates.find((c) => c && ids.has(c));
    if (!nextFrag) continue;

    const relFromSmil = path.posix.relative(smilDir, resolved).replace(/\\/g, '/');
    el.setAttribute('src', `${relFromSmil}#${nextFrag}`);
    rewrites++;
  }

  if (rewrites) {
    changes.push(`smil ${smilPath}: rewrote ${rewrites} <text src> fragment target(s) to match XHTML ids (restore highlighting)`);
  }
}

/** Media Overlays: each &lt;seq&gt; needs epub:textref to the overlaid XHTML (path relative to SMIL). */
function ensureSeqEpubTextrefs(smilDoc, smilRootRel, changes, smilPath) {
  const smilDir = path.posix.dirname(smilRootRel);
  const seqs = toArray(smilDoc.getElementsByTagName('seq'));
  let n = 0;
  for (let i = 0; i < seqs.length; i++) {
    const seq = seqs[i];
    const existing =
      seq.getAttribute('epub:textref') ||
      (typeof seq.getAttributeNS === 'function' ? seq.getAttributeNS(EPUB_NS, 'textref') : '');
    if (existing) continue;
    const texts = toArray(seq.getElementsByTagName('text'));
    let hrefOut = null;
    for (let j = 0; j < texts.length; j++) {
      const src = texts[j].getAttribute('src');
      if (!src) continue;
      const filePart = normalizeRel(src.split('#')[0]);
      const resolved = resolveFromFile(smilRootRel, filePart);
      if (!resolved || !/\.(xhtml|html|htm)$/i.test(resolved)) continue;
      hrefOut = path.posix.relative(smilDir, resolved).replace(/\\/g, '/');
      break;
    }
    if (!hrefOut) continue;
    // Important: use setAttributeNS so the attribute is in the OPS namespace,
    // otherwise xmldom may serialize `epub:textref` without the correct namespace binding.
    if (typeof seq.setAttributeNS === 'function') {
      seq.setAttributeNS(EPUB_NS, 'epub:textref', hrefOut);
    } else {
      seq.setAttribute('epub:textref', hrefOut);
    }
    n++;
  }
  if (n) changes.push(`smil ${smilPath}: added epub:textref to ${n} <seq> element(s)`);
}

function stripCssRemoteImports(content) {
  let s = String(content || '');
  let prev;
  do {
    prev = s;
    s = s.replace(/@import\s+url\s*\((?:[^()]|\([^)]*\))*\)\s*[^;]*;/gi, '');
    s = s.replace(/@import[\s\S]*?;/gi, '');
  } while (s !== prev);
  s = s
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^\s*@import/i.test(line)) return false;
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(t)) return false;
      if (/^\*?\s*700\s*;?\s*$/.test(t)) return false;
      if (/^wght@|^family=/i.test(t)) return false;
      if (/^\s*"?[;,)]+\s*$/.test(t)) return false;
      return true;
    })
    .join('\n');
  s = s.replace(/font-family:\s*"[^"]*$/gm, 'font-family: serif;');
  s = s.replace(/\n{4,}/g, '\n\n\n');
  return s;
}

/** CSS-008: normalize obvious semicolon syntax artifacts that break parsing. */
function normalizeCssSemicolonSyntax(content) {
  let s = String(content || '');
  s = s.replace(/;;+/g, ';');
  // Remove lines that are only semicolons.
  s = s
    .split('\n')
    .filter((line) => !/^\s*;+\s*$/.test(line))
    .join('\n');
  // Remove leading semicolon right after an opening block brace.
  s = s.replace(/(\{)\s*;+/g, '$1');
  // Remove trailing semicolon sequences right before closing brace.
  s = s.replace(/;+\s*(\})/g, '$1');
  return s;
}

/** CSS-008: remove @font-face blocks whose local url() targets are missing from the package. */
async function stripCssMissingFontUrls(extractDir, cssRelPath, raw) {
  const cssDir = path.posix.dirname(cssRelPath);
  const s = String(raw || '');
  const fontFaceRe = /@font-face\s*\{[^}]*\}/gis;
  let out = s;
  const blocks = s.match(fontFaceRe);
  if (!blocks) return out;
  for (const block of blocks) {
    const urlRe = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi;
    let bad = false;
    let m;
    while ((m = urlRe.exec(block)) !== null) {
      const pathPart = m[1].trim();
      if (/^(data:|https?:|file:)/i.test(pathPart)) continue;
      const rel = normalizeRel(path.posix.join(cssDir, pathPart));
      const abs = path.join(extractDir, ...rel.split('/'));
      if (!(await fs.pathExists(abs))) bad = true;
    }
    if (bad) {
      out = out.replace(block, '/* removed @font-face (missing font file) */\n');
    }
  }
  return out;
}

/** Non-DRM EPUBs: remove encryption.xml (EPUBCheck / invalid CipherReference). Restore from backup if DRM. */
async function removeEncryptionXmlFile(extractDir, changes, written) {
  const encPath = path.join(extractDir, 'META-INF', 'encryption.xml');
  if (!(await fs.pathExists(encPath))) return;
  await fs.remove(encPath);
  written.push('META-INF/encryption.xml');
  changes.push('META-INF/encryption.xml: removed (typical for non-DRM; re-add if you use DRM)');
}

function validateSmilRefs(smilDoc, relFilesSet, changes, smilPath) {
  const texts = toArray(smilDoc.getElementsByTagName('text'));
  const toRemove = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const src = t.getAttribute('src');
    if (!src) continue;
    const file = normalizeRel(src.split('#')[0]);
    const resolved = resolveFromFile(smilPath, file);
    if (resolved && !relFilesSet.has(resolved)) {
      toRemove.push(t);
    }
  }
  for (const t of toRemove) {
    t.parentNode?.removeChild(t);
  }
  if (toRemove.length) {
    changes.push(`smil ${smilPath}: removed ${toRemove.length} broken text ref(s)`);
  }
}

/** EPUB Media Overlays: do not use &lt;meta&gt; inside SMIL (use OPF metadata + per-SMIL duration refines). */
function removeAllSmilMetaElements(smilDoc, changes, smilPath) {
  const metas = toArray(smilDoc.getElementsByTagName('meta'));
  for (const m of metas) {
    m.parentNode?.removeChild(m);
  }
  if (metas.length) {
    changes.push(`smil ${smilPath}: removed ${metas.length} <meta> element(s)`);
  }
}

/**
 * Run deterministic fixes on an unpacked EPUB directory (flat paths).
 * @param {object} [options]
 * @param {object[]} [options.messages] EPUBCheck messages — if provided, only handlers mapped to those codes run. Empty array = no fixes. Omit = all safe handlers (full run).
 * @returns {Promise<{
 *   written: string[],
 *   changes: string[],
 *   opfPath: string|null,
 *   mode: 'full'|'targeted'|'none',
 *   appliedHandlers: string[],
 *   classification: object|null
 * }>}
 */
export async function runEpubAutoFixOnExtractDir(extractDir, options = {}) {
  const { messages } = options;
  const { mode, handlers, fallbackFromEmptyTarget } = resolveAutoFixHandlers(messages);
  const classification =
    messages !== undefined && Array.isArray(messages) ? classifyEpubcheckMessages(messages) : null;

  const active =
    mode === 'full' ? new Set(HANDLER_ORDER) : mode === 'none' ? new Set() : handlers;

  const appliedHandlers = HANDLER_ORDER.filter((h) => active.has(h));
  const changes = [];
  const written = [];

  if (mode === 'none') {
    const opfRelPath = await readOpfPathFromContainer(extractDir);
    return {
      written,
      changes,
      opfPath: opfRelPath,
      mode,
      appliedHandlers: [],
      classification,
      fallbackFromEmptyTarget: false
    };
  }

  const relFiles = await walkRelativeFiles(extractDir);
  const relFilesSet = new Set(relFiles);

  const opfRelPath = await readOpfPathFromContainer(extractDir);
  if (!opfRelPath || !(await fs.pathExists(path.join(extractDir, opfRelPath)))) {
    throw new Error('Could not locate package document (OPF) from META-INF/container.xml');
  }

  const opfAbs = path.join(extractDir, ...opfRelPath.split('/'));
  let opfXml = await fs.readFile(opfAbs, 'utf8');
  const strippedOpen = stripLangFromPackageOpenTagRaw(opfXml);
  if (strippedOpen !== opfXml) opfXml = strippedOpen;

  const opfDoc = parseXML(opfXml);
  const pkg = opfDoc.getElementsByTagName('package')[0];
  const version = (pkg?.getAttribute('version') || '3.0').trim();
  const isEpub3 = version.startsWith('3');
  const hasSmil = relFiles.some((f) => /\.smil$/i.test(f));

  if (pkg) {
    stripInvalidLangFromOpfSubtree(pkg, changes);
  }

  // OPF-099: manifest must not list the OPF/package document itself.
  if (pkg) {
    removeManifestSelfReferenceOpf(opfDoc, opfRelPath, changes);
  }

  if (pkg && isEpub3) {
    ensureEpub3PackageVocabAndPrefix(pkg, changes);
  }

  if (active.has('package')) fixPackageRoot(opfDoc, changes);
  if (active.has('metadata')) fixMetadata(opfDoc, isEpub3, changes);
  if (active.has('manifest')) fixManifest(opfDoc, opfRelPath, relFilesSet, changes);
  if (active.has('manifest')) {
    removeManifestItemsForMissingFiles(opfDoc, opfRelPath, relFilesSet, changes);
    await ensureSvgPropertyOnManifestItems(extractDir, opfDoc, opfRelPath, changes);
    await ensureScriptedPropertyOnManifestItems(extractDir, opfDoc, opfRelPath, changes);
    normalizeFontManifestItems(opfDoc, opfRelPath, changes);
  }
  if (active.has('spine')) fixSpine(opfDoc, changes);
  if (pkg) {
    removeInvalidMediaOverlayManifestProperty(opfDoc, changes);
    removeInvalidMediaOverlayFromSpine(opfDoc, changes);
  }
  if (active.has('nav')) ensureNav(opfDoc, opfRelPath, relFiles, changes);

  if (active.has('nav')) {
    const navRels = relFiles.filter((f) => /(^|\/)nav\.xhtml$/i.test(f));
    for (const rel of navRels) {
      if (rel === opfRelPath) continue;
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const localChanges = [];
      let doc;
      try {
        doc = parseXML(raw);
      } catch {
        continue;
      }
      dedupeNavLandmarksInNavDoc(doc, localChanges, rel);
      const out = serialize(doc);
      if (out !== raw) {
        await fs.writeFile(abs, out, 'utf8');
        written.push(rel);
        changes.push(...localChanges.map((c) => `${rel}: ${c}`));
      }
    }
  }

  if (active.has('cssImports')) {
    const cssFiles = relFiles.filter((f) => /\.css$/i.test(f));
    for (const rel of cssFiles) {
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      let next = await stripCssMissingFontUrls(extractDir, rel, raw);
      if (next !== raw) {
        changes.push(`${rel}: removed @font-face block(s) pointing at missing font files`);
      }
      const afterImport = stripCssRemoteImports(next);
      if (afterImport !== next) {
        changes.push(`${rel}: removed @import (remote resources blocked in EPUB)`);
      }
      next = normalizeCssSemicolonSyntax(afterImport);
      if (next !== afterImport) {
        changes.push(`${rel}: normalized invalid semicolon CSS syntax (CSS-008)`);
      }
      if (next !== raw) {
        await fs.writeFile(abs, next, 'utf8');
        written.push(rel);
      }
    }
  }

  if (active.has('encryption')) {
    await removeEncryptionXmlFile(extractDir, changes, written);
  }

  if (pkg) {
    fixOpfIdsWithColons(opfDoc, changes);
  }

  // OPF-027: sanitize manifest properties tokens (remove image/jpeg etc).
  if (pkg) {
    const manifest = opfDoc.getElementsByTagName('manifest')[0];
    if (manifest && typeof manifest.getElementsByTagName === 'function') {
      const items = toArray(manifest.getElementsByTagName('item'));
      for (const it of items) {
        const props = it.getAttribute('properties');
        if (!props) continue;
        const next = normalizeManifestPropertiesAttribute(
          props,
          changes,
          `manifest item id="${it.getAttribute('id') || ''}"`
        );
        if (next && next !== props) it.setAttribute('properties', next);
        if (!next) it.removeAttribute('properties');
      }
    }
  }

  const applyMediaOverlayLink =
    hasSmil &&
    isEpub3 &&
    (active.has('metadata') || active.has('manifest') || active.has('smilRefs'));
  if (applyMediaOverlayLink) {
    await linkMediaOverlayFromSmilTextRefs(extractDir, opfDoc, opfRelPath, relFilesSet, changes);
  }

  const applySmilDurationRefines =
    hasSmil &&
    isEpub3 &&
    (active.has('metadata') ||
      active.has('manifest') ||
      active.has('smilRefs'));
  if (applySmilDurationRefines) {
    ensureSmilMediaDurationRefines(opfDoc, changes);
  }

  if (pkg) {
    fixOpfIdsWithColons(opfDoc, changes);
  }

  // Media Overlay timing: normalize metadata media:duration into strict SMIL clock format.
  if (pkg) {
    normalizeMediaDurationsInMetadata(opfDoc, changes);
  }
  if (
    pkg &&
    hasSmil &&
    isEpub3 &&
    (mode === 'full' || active.has('metadata') || active.has('smilRefs'))
  ) {
    recalculateGlobalMediaDurationSum(opfDoc, changes);
  }

  if (pkg) {
    const newOpf = serialize(opfDoc);
    if (newOpf !== opfXml) {
      await fs.writeFile(opfAbs, newOpf, 'utf8');
      written.push(opfRelPath);
    }
  }

  const doXhtml =
    active.has('xhtmlDoctype') ||
    active.has('xhtmlStructure') ||
    active.has('xhtmlLang') ||
    active.has('brokenLinks');
  if (doXhtml) {
    const xhtmlLike = relFiles.filter((f) => /\.xhtml$/i.test(f) || /\.html$/i.test(f));
    for (const rel of xhtmlLike) {
      if (rel === opfRelPath) continue;
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const localChanges = [];
      let working = raw;
      if (active.has('xhtmlDoctype')) {
        const next = fixDoctypeHtmlString(working);
        if (next !== working) {
          working = next;
          localChanges.push('normalized DOCTYPE to <!DOCTYPE html> (HTM-004)');
        }
      }
      let doc;
      try {
        doc = parseXML(working);
      } catch {
        continue;
      }
      try {
        stripUnprefixedLangFromDoc(doc, localChanges, rel);
        if (active.has('xhtmlStructure')) fixXhtmlDoc(doc, localChanges);
        sanitizeMediaOverlayCssInXhtml(doc, localChanges);
        if (active.has('xhtmlLang')) fixLang(doc, localChanges);
        fixXmlIdsWithColonsInDoc(doc, localChanges, rel);
        fixDuplicateXmlIdsInDoc(doc, localChanges, rel);
        if (active.has('brokenLinks')) fixLinks(doc, rel, relFilesSet, localChanges);
      } catch {
        continue;
      }
      let out = serialize(doc);
      if (active.has('xhtmlDoctype')) {
        out = ensureHtml5DoctypeInOutput(out);
      }
      if (out !== raw) {
        await fs.writeFile(abs, out, 'utf8');
        written.push(rel);
        changes.push(...localChanges.map((c) => `${rel}: ${c}`));
      }
    }
  }

  /**
   * Targeted EPUBCheck auto-fix often maps OPF-027 etc. to metadata/manifest only — `smilRefs` is not active.
   * XHTML id normalization still must run or SMIL `#frag` no longer matches (audio plays, no highlight).
   * (Repair-session / EPUBCheck use OS tmpdir + in-memory buffer — not `backend/epub_output/...`.)
   */
  if (mode !== 'none' && hasSmil && isEpub3 && !doXhtml) {
    const xhtmlLike = relFiles.filter((f) => /\.xhtml$/i.test(f) || /\.html$/i.test(f));
    for (const rel of xhtmlLike) {
      if (rel === opfRelPath) continue;
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const localChanges = [];
      let doc;
      try {
        doc = parseXML(raw);
      } catch {
        continue;
      }
      try {
        fixXmlIdsWithColonsInDoc(doc, localChanges, rel);
        fixDuplicateXmlIdsInDoc(doc, localChanges, rel);
      } catch {
        continue;
      }
      const out = serialize(doc);
      if (out !== raw) {
        await fs.writeFile(abs, out, 'utf8');
        written.push(rel);
        changes.push(...localChanges.map((c) => `${rel}: ${c}`));
      }
    }
  }

  if (active.has('smilRefs')) {
    const smilFiles = relFiles.filter((f) => /\.smil$/i.test(f));
    for (const rel of smilFiles) {
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const localChanges = [];
      const repaired = repairTruncatedSmilRawXml(raw, rel, relFilesSet, localChanges);
      const normalized = normalizeSmilRawXml(repaired);
      if (normalized !== raw) {
        localChanges.push('normalized SMIL root + XML declaration (EPUB Media Overlays)');
      }
      let doc;
      try {
        doc = parseXML(normalized);
      } catch {
        continue;
      }
      fixSmilRootNamespace(doc, localChanges, rel);
      removeEmptySeqs(doc, localChanges, rel);
      ensureSeqEpubTextrefs(doc, rel, localChanges, rel);
      removeAllSmilMetaElements(doc, localChanges, rel);
      fixXmlIdsWithColonsInDoc(doc, localChanges, rel);
      await repairSmilTextSrcFragmentTargets(extractDir, rel, doc, relFilesSet, localChanges, rel);
      validateSmilRefs(doc, relFilesSet, localChanges, rel);
      let out = serialize(doc);
      out = ensureSmilOutputXmlDeclaration(out);
      if (out !== raw) {
        await fs.writeFile(abs, out, 'utf8');
        written.push(rel);
        changes.push(...localChanges.map((c) => `${rel}: ${c}`));
      }
    }
  } else if (mode !== 'none' && hasSmil && isEpub3) {
    const smilFiles = relFiles.filter((f) => /\.smil$/i.test(f));
    for (const rel of smilFiles) {
      const abs = path.join(extractDir, ...rel.split('/'));
      let raw;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const localChanges = [];
      const repaired = repairTruncatedSmilRawXml(raw, rel, relFilesSet, localChanges);
      const normalized = normalizeSmilRawXml(repaired);
      let doc;
      try {
        doc = parseXML(normalized);
      } catch {
        continue;
      }
      await repairSmilTextSrcFragmentTargets(extractDir, rel, doc, relFilesSet, localChanges, rel);
      let out = serialize(doc);
      out = ensureSmilOutputXmlDeclaration(out);
      if (out !== raw) {
        await fs.writeFile(abs, out, 'utf8');
        written.push(rel);
        changes.push(...localChanges.map((c) => `${rel}: ${c}`));
      }
    }
  }

  return {
    written,
    changes,
    opfPath: opfRelPath,
    mode,
    appliedHandlers,
    classification,
    fallbackFromEmptyTarget: Boolean(fallbackFromEmptyTarget)
  };
}

/**
 * Unpack EPUB buffer → deterministic fixes → repackage → EPUBCheck.
 * @param {object} [options]
 * @param {object[]} [options.messages] If set, only auto-fix handlers mapped to these EPUBCheck codes run. Empty array = no file changes.
 */
export async function runEpubAutoFixOnBuffer(epubBuffer, options = {}) {
  const buf = Buffer.isBuffer(epubBuffer) ? epubBuffer : Buffer.from(epubBuffer);
  const { messages, includeWarnings, includeNotices } = options;

  if (Array.isArray(messages) && messages.length === 0) {
    const tmpEpubPath = path.join(tmpdir(), `epubcheck-autofix-skip-${randomUUID()}.epub`);
    await fs.writeFile(tmpEpubPath, buf);
    let afterReport;
    try {
      afterReport = await runEpubcheck(tmpEpubPath, {
        includeWarnings: includeWarnings !== false,
        includeNotices: includeNotices === true
      });
    } finally {
      await fs.remove(tmpEpubPath).catch(() => {});
    }
    const classification = classifyEpubcheckMessages([]);
    return {
      written: [],
      changes: [],
      opfPath: null,
      mode: 'none',
      appliedHandlers: [],
      classification,
      fallbackFromEmptyTarget: false,
      stats: classification.stats,
      epubBuffer: buf,
      after: {
        valid: afterReport.valid,
        summary: afterReport.summary,
        messages: afterReport.report?.messages ?? []
      }
    };
  }

  const workRoot = path.join(tmpdir(), `epub-autofix-${randomUUID()}`);
  const extractDir = path.join(workRoot, 'extract');

  try {
    await fs.ensureDir(extractDir);
    await unpackEpubToDir(buf, extractDir);

    const {
      written,
      changes,
      opfPath,
      mode,
      appliedHandlers,
      classification,
      fallbackFromEmptyTarget
    } = await runEpubAutoFixOnExtractDir(extractDir, { messages });
    const outBuf = await packageDirToEpubBuffer(extractDir);

    let afterReport = null;
    const tmpEpubPath = path.join(tmpdir(), `epubcheck-autofix-${randomUUID()}.epub`);
    await fs.writeFile(tmpEpubPath, outBuf);
    try {
      afterReport = await runEpubcheck(tmpEpubPath, {
        includeWarnings: includeWarnings !== false,
        includeNotices: includeNotices === true
      });
    } finally {
      await fs.remove(tmpEpubPath).catch(() => {});
    }

    return {
      written,
      changes,
      opfPath,
      mode,
      appliedHandlers,
      classification,
      fallbackFromEmptyTarget: Boolean(fallbackFromEmptyTarget),
      /** Present when `messages` was passed: counts from EPUBCheck report (not files written). */
      stats: classification?.stats ?? null,
      epubBuffer: outBuf,
      after: {
        valid: afterReport.valid,
        summary: afterReport.summary,
        messages: afterReport.report?.messages ?? []
      }
    };
  } finally {
    await fs.remove(workRoot).catch(() => {});
  }
}
