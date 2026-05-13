import React, { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import api from '../services/api';
import { withAuthImageQuery } from '../utils/authImageUrl';
import { getPageNumFromZoneId as resolveFxlZoneToPage, buildZoneIdToPageMap } from '../utils/kitabooZonePageId';
import './SyncStudioEpubReader.css';

function tocLabel(item) {
  if (!item?.label) return 'Untitled';
  if (typeof item.label === 'string') return item.label.trim() || 'Untitled';
  try {
    const t = item.label.textContent || item.label.innerText;
    if (t) return String(t).trim() || 'Untitled';
  } catch (_) { /* ignore */ }
  return String(item.label).replace(/<[^>]+>/g, '').trim() || 'Untitled';
}

function flattenToc(items, depth = 0) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const href = item.href;
    if (href) out.push({ label: tocLabel(item), href, depth });
    if (item.subitems && item.subitems.length) {
      out.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return out;
}

/** epub.js theme rules: selectors → property maps (see contents.addStylesheetRules). */
function buildResponsiveTheme({ dark, fxl }) {
  const color = dark ? '#e8e8ec' : '#222222';
  const background = dark ? '#1a1a1e' : '#ffffff';
  if (fxl) {
    const hl = {
      'background-color': '#e3f2fd !important',
      color: '#0d47a1 !important',
      fill: '#0d47a1 !important',
      stroke: '#0d47a1 !important',
      'stroke-width': '1.5px !important',
      'font-weight': 'bold !important'
    };
    return {
      body: { background, color, margin: '0', padding: '0', overflow: 'hidden' },
      '.sync-word-highlight': hl,
      'svg text.sync-word-highlight': hl,
      'svg tspan.sync-word-highlight': hl,
      'text.sync-word-highlight': hl,
      'tspan.sync-word-highlight': hl
    };
  }
  return {
    html: {
      'column-fill': 'auto',
      'column-gap': '0px'
    },
    body: {
      background,
      color,
      margin: '0',
      padding: '0',
      overflow: 'visible',
      'break-inside': 'auto'
    },
    '*': {
      'max-width': '100%',
      'box-sizing': 'border-box',
      'break-inside': 'avoid'
    },
    img: {
      'max-width': '100%',
      height: 'auto',
      'break-inside': 'avoid'
    },
    div: {
      'max-width': '100%',
      'break-inside': 'avoid'
    },
    p: {
      color,
      'word-break': 'break-word'
    },
    pre: {
      'max-width': '100%',
      'overflow-x': 'auto'
    },
    '.sync-word-highlight': {
      'background-color': '#e3f2fd !important',
      color: '#0d47a1 !important',
      fill: '#0d47a1 !important',
      stroke: '#0d47a1 !important',
      'stroke-width': '1.5px !important',
      'font-weight': 'bold !important'
    }
  };
}

/** Parse EPUB viewport string (meta content or package rendition:viewport). */
function parseViewportDimensions(content) {
  if (!content || typeof content !== 'string') return null;
  const w = content.match(/width\s*[:=]\s*(\d+)/i);
  const h = content.match(/height\s*[:=]\s*(\d+)/i);
  const width = w ? parseInt(w[1], 10) : null;
  const height = h ? parseInt(h[1], 10) : null;
  if (width && height) return { width, height };
  return null;
}

/** True when epub.js Layout has already applied scaler() transform on body (pre-paginated). */
function isBodyScaledByEpubjs(body) {
  if (!body?.style) return false;
  const tr = body.style.transform || '';
  const w = body.style.width || '';
  const h = body.style.height || '';
  return /scale\s*\(/.test(tr) && /^\d+px$/.test(w) && /^\d+px$/.test(h);
}

function clearManualHtmlScale(htmlEl) {
  if (!htmlEl?.style) return;
  htmlEl.style.removeProperty('transform');
  htmlEl.style.removeProperty('transform-origin');
  htmlEl.style.removeProperty('width');
  htmlEl.style.removeProperty('height');
}

/** Read SVG page size (Kitaboo/FXL exports often use viewBox only, no viewport meta). */
function readSvgPageBox(doc) {
  const svg = doc.querySelector('svg[viewBox], svg.main-svg');
  if (!svg?.viewBox?.baseVal) return null;
  const { width, height } = svg.viewBox.baseVal;
  if (width > 16 && height > 16) return { width, height };
  return null;
}

/**
 * Scale pre-paginated (FXL) iframe content to fit the stage.
 * If epub.js already scaled `body` (Layout.scaler), only size the iframe — do NOT add a second transform on `html`.
 */
function applyFxlViewportScale(view, containerEl, packageViewport) {
  const iframe = view?.iframe;
  const doc = view?.document;
  const html = doc?.documentElement;
  const body = doc?.body;
  if (!iframe || !html || !body) return;

  if (isBodyScaledByEpubjs(body)) {
    clearManualHtmlScale(html);
    const rect = body.getBoundingClientRect();
    const scaledW = Math.max(1, Math.ceil(rect.width));
    const scaledH = Math.max(1, Math.ceil(rect.height));
    iframe.style.width = `${scaledW}px`;
    iframe.style.height = `${scaledH}px`;
    const wrap = view.element;
    if (wrap) {
      wrap.style.width = `${scaledW}px`;
      wrap.style.height = `${scaledH}px`;
      wrap.style.flexShrink = '0';
    }
    return;
  }

  let width = 1024;
  let height = 768;
  let resolved = false;

  const viewportMeta = doc.querySelector("meta[name='viewport']");
  if (viewportMeta) {
    const parsed = parseViewportDimensions(viewportMeta.getAttribute('content') || '');
    if (parsed) {
      width = parsed.width;
      height = parsed.height;
      resolved = true;
    }
  }
  if (!resolved && packageViewport) {
    const parsed = parseViewportDimensions(packageViewport);
    if (parsed) {
      width = parsed.width;
      height = parsed.height;
      resolved = true;
    }
  }

  const svgBox = readSvgPageBox(doc);
  if (!resolved && svgBox) {
    width = svgBox.width;
    height = svgBox.height;
    resolved = true;
  }

  const layout = view.layout;
  if (!resolved && layout && layout.name === 'pre-paginated' && layout.columnWidth > 0 && layout.height > 0) {
    width = layout.columnWidth;
    height = layout.height;
    resolved = true;
  }

  if (!resolved) {
    if (body && (body.scrollWidth > 0 || body.scrollHeight > 0)) {
      const bw = Math.max(body.scrollWidth, html.scrollWidth);
      const bh = Math.max(body.scrollHeight, html.scrollHeight);
      if (bw > 16 && bh > 16) {
        width = bw;
        height = bh;
      }
    }
  }

  const container = containerEl;
  if (!container?.clientWidth || !container?.clientHeight) return;

  const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
  html.style.transform = `scale(${scale})`;
  html.style.transformOrigin = 'top left';
  html.style.width = `${width}px`;
  html.style.height = `${height}px`;

  const scaledW = Math.ceil(width * scale);
  const scaledH = Math.ceil(height * scale);
  iframe.style.width = `${scaledW}px`;
  iframe.style.height = `${scaledH}px`;

  const wrap = view.element;
  if (wrap) {
    wrap.style.width = `${scaledW}px`;
    wrap.style.height = `${scaledH}px`;
    wrap.style.flexShrink = '0';
  }
}

function scheduleFxlViewportScale(view, containerEl, packageViewport) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      applyFxlViewportScale(view, containerEl, packageViewport);
    });
  });
}

/** FXL EPUB spine hrefs like OEBPS/page1.xhtml or page_2.xhtml → page number */
function parseFxPageNumFromEpubHref(href) {
  const s = String(href || '');
  let m = s.match(/(?:^|[\\/])page[_\s]?(\d+)\.xhtml/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/page(\d+)\.xhtml/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Match backend zone ids: p7_z1_s0 → 7; reflowable chapter3_page6_p1_s1 → 6.
 * If we only matched ^p(N)_, reflowable IDs all fell into page 1 and word-level
 * filtering dropped sentence segments for the whole book.
 */
function getPageNumFromZoneIdReflow(zoneId) {
  if (!zoneId || typeof zoneId !== 'string') return 1;
  const m = zoneId.match(/^p(\d+)_/);
  if (m) return parseInt(m[1], 10);
  const chapterPage = zoneId.match(/chapter\d+_page(\d+)(?:_|$)/i);
  if (chapterPage) return parseInt(chapterPage[1], 10);
  const pageInId = zoneId.match(/(?:^|_)page(\d+)_/i);
  if (pageInId) return parseInt(pageInId[1], 10);
  return 1;
}

function parsePageNumFromPerPageAudioSrc(audioSrc) {
  const s = String(audioSrc || '');
  const m = s.match(/\/audio\/page\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** JSON may serialize per-page URL map keys as strings; normalize lookup. */
function resolvePerPageAudioUrl(perPageMap, pageNum) {
  if (!perPageMap || pageNum == null || pageNum < 1) return null;
  return perPageMap[pageNum] ?? perPageMap[String(pageNum)] ?? null;
}

/** Reflowable per-chapter audio: /api/.../audio/section/N */
function parseSectionIndexFromAudioSrc(audioSrc) {
  const s = String(audioSrc || '');
  const m = s.match(/\/audio\/section\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function resolvePerSectionAudioUrl(perSectionMap, sectionIndex) {
  if (perSectionMap == null || sectionIndex == null || sectionIndex < 0) return null;
  return perSectionMap[sectionIndex] ?? perSectionMap[String(sectionIndex)] ?? null;
}

/** epub.js location → spine index (matches backend getEpubSections order). */
function spineIndexFromLocation(book, loc) {
  if (!book?.spine || !loc) return null;
  if (typeof loc.start?.index === 'number' && loc.start.index >= 0) return loc.start.index;
  const href = loc?.start?.href || loc?.href || '';
  if (!href) return null;
  const want = String(href).trim().replace(/^\//, '');
  const file = want.split('/').pop();
  for (let i = 0; i < book.spine.length; i++) {
    const spineItem = book.spine.get(i);
    if (!spineItem?.href) continue;
    const ih = String(spineItem.href).replace(/^\//, '');
    if (ih === want || ih.endsWith(file) || want.endsWith(ih.split('/').pop())) {
      return i;
    }
  }
  return null;
}

function isWordLevelBlockId(id) {
  const s = String(id || '');
  return /_w\d+/i.test(s) || s.toLowerCase().includes('_w');
}

/**
 * Alignment often stores parent zone timings (p1_z1) while FXL export expands to word/sentence
 * ids (p1_z1_w0, p1_z1_s0). Resolve the best DOM node for highlighting.
 */
function collectDescendantSyncIds(doc, blockId) {
  if (!doc || !blockId) return [];
  const prefix = `${blockId}_`;
  const out = [];
  try {
    doc.querySelectorAll('[id]').forEach((node) => {
      const id = node.getAttribute && node.getAttribute('id');
      if (id && id.startsWith(prefix)) out.push(node);
    });
  } catch (_) {
    /* ignore */
  }
  if (out.length <= 1) return out;
  out.sort((a, b) => {
    if (a === b) return 0;
    try {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch (_) {
      /* ignore */
    }
    return String(a.getAttribute('id') || '').localeCompare(String(b.getAttribute('id') || ''));
  });
  return out;
}

/** Infer Kitaboo zone page number (pN_) from ids present in the visible iframe document. */
function inferZonePageNumFromDocument(doc) {
  if (!doc?.querySelectorAll) return null;
  const counts = new Map();
  try {
    doc.querySelectorAll('[id]').forEach((node) => {
      const id = node.getAttribute && node.getAttribute('id');
      if (!id || typeof id !== 'string') return;
      const m = id.match(/^p(\d+)_/);
      if (m) {
        const n = parseInt(m[1], 10);
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    });
  } catch (_) {
    return null;
  }
  if (counts.size === 0) return null;
  let best = null;
  let bestN = 0;
  for (const [n, c] of counts.entries()) {
    if (c > bestN) {
      bestN = c;
      best = n;
    }
  }
  return best;
}

/** Sync API may return `alignment` as an array or `{ segments: [...] }`. */
function coerceAlignmentSegments(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.segments)) return input.segments;
  if (Array.isArray(input.data?.segments)) return input.data.segments;
  return [];
}

/**
 * FXL XHTML is often application/xhtml+xml: getElementById may not resolve SVG ids without a DTD.
 * querySelector('#id') still finds elements with id="...".
 */
function getElementByIdRobust(doc, id) {
  if (!doc || id == null || id === '') return null;
  const sid = String(id);
  try {
    const a = doc.getElementById(sid);
    if (a) return a;
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof doc.querySelector === 'function') {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return doc.querySelector(`#${CSS.escape(sid)}`);
      }
      const esc = sid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return doc.querySelector(`[id="${esc}"]`);
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/** Inline SVG styles beat epub.js theme rules; mark and clear so highlight is visible on tspan/text. */
function clearReaderHighlightMarkup(el) {
  if (!el?.classList) return;
  try {
    el.classList.remove('sync-word-highlight');
  } catch (_) {
    /* ignore */
  }
  if (el.getAttribute && el.getAttribute('data-reader-sync-hl') === '1') {
    el.removeAttribute('data-reader-sync-hl');
    try {
      el.style.removeProperty('fill');
      el.style.removeProperty('stroke');
      el.style.removeProperty('stroke-width');
    } catch (_) {
      /* ignore */
    }
  }
}

function applyReaderHighlightMarkup(el) {
  if (!el?.classList) return;
  try {
    el.classList.add('sync-word-highlight');
  } catch (_) {
    /* ignore */
  }
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'text' || tag === 'tspan') {
    try {
      el.setAttribute('data-reader-sync-hl', '1');
      el.style.setProperty('fill', '#0d47a1', 'important');
      el.style.setProperty('stroke', '#0d47a1', 'important');
      el.style.setProperty('stroke-width', '1.5px', 'important');
    } catch (_) {
      /* ignore */
    }
  }
}

function resolveElementForSyncBlock(doc, blockId, tSeconds, blockStart, blockEnd) {
  if (!doc || !blockId) return null;
  const direct = getElementByIdRobust(doc, blockId);
  if (direct) return direct;
  const candidates = collectDescendantSyncIds(doc, blockId);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const start = Number(blockStart) || 0;
  const end = Number(blockEnd) || 0;
  const span = Math.max(end - start, 1e-6);
  const t = Number(tSeconds) || 0;
  const frac = Math.max(0, Math.min(1, (t - start) / span));

  const charLens = candidates.map((el) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return Math.max(1, text.length);
  });
  const total = charLens.reduce((s, n) => s + n, 0);
  const target = frac * total;
  let acc = 0;
  for (let i = 0; i < candidates.length; i++) {
    acc += charLens[i];
    if (target <= acc || i === candidates.length - 1) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Match Sync Studio section href to spine item for rendition.display(). */
function resolveDisplayTarget(book, href) {
  if (!book?.spine || !href) return href || null;
  const want = String(href).trim().replace(/^\//, '');
  const file = want.split('/').pop();
  for (let i = 0; i < book.spine.length; i++) {
    const spineItem = book.spine.get(i);
    if (!spineItem?.href) continue;
    const ih = String(spineItem.href).replace(/^\//, '');
    if (ih === want || ih.endsWith(file) || want.endsWith(ih.split('/').pop())) {
      return spineItem.href;
    }
  }
  return want;
}

/**
 * Authenticated epub.js reader for Sync Studio (reflowable) and FXL Sync Studio.
 * - conversion: GET /conversions/:jobId/download (conversion / EPUB-import jobs)
 * - kitaboo: GET /kitaboo/download/:jobId (FXL export from Zoning Studio)
 */
export default function SyncStudioEpubReader({
  jobId,
  spineHref,
  anchorId,
  epubSource = 'conversion',
  fixedLayout = false
}) {
  const [resolvedSource, setResolvedSource] = useState(epubSource);
  useEffect(() => {
    setResolvedSource(epubSource);
  }, [epubSource, jobId]);

  const stageRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const [loadError, setLoadError] = useState('');
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState([]);
  const [fontPct, setFontPct] = useState(100);
  const [theme, setTheme] = useState('light');
  const [anchorDebug, setAnchorDebug] = useState('');
  const [fxlMode, setFxlMode] = useState(() => fixedLayout);

  // Audio + sync studio highlighting (word/sentence/zone IDs inside the EPUB)
  const audioRef = useRef(new Audio());
  const [audioUi, setAudioUi] = useState({ playing: false, currentTime: 0, duration: 0 });
  const [syncLoadError, setSyncLoadError] = useState('');

  const [syncStudio, setSyncStudio] = useState(null);
  const syncStudioRef = useRef(null);
  /** FXL Kitaboo: zone id → page from sync-studio `pages`; empty for reflow. */
  const fxlZoneIdToPageRef = useRef(new Map());
  /** Full normalized list from alignment.json (all pages). */
  const syncBlocksAllRef = useRef([]);
  /** Subset used for findActiveBlockId: full book, or current page when using /audio/page/N. */
  const syncBlocksRef = useRef([]); // sorted [{id,start,end}]
  const blockByIdRef = useRef(new Map()); // id -> {id,start,end}
  const activeBlockIdRef = useRef(null);
  const highlightedElRef = useRef(null);
  const clickBoundDocsRef = useRef(new WeakSet());

  function formatTime(tSeconds) {
    const t = Number(tSeconds || 0);
    if (!Number.isFinite(t) || t < 0) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function resolveBlockPageNum(blockId) {
    const m = fxlZoneIdToPageRef.current;
    if (m instanceof Map && m.size > 0) {
      return resolveFxlZoneToPage(blockId, m);
    }
    return getPageNumFromZoneIdReflow(blockId);
  }

  const backendOrigin = api.defaults.baseURL?.replace(/\/api\/?$/, '') || '';
  const apiBaseEndsWithApi = /\/api\/?$/.test(api.defaults.baseURL || '');

  /** epub.js getContents() plus stage iframes — FXL sometimes only exposes the latter reliably. */
  function getDocumentsForHighlight() {
    const out = [];
    const seen = new WeakSet();
    const pushDoc = (d) => {
      if (d && d.documentElement && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    };
    try {
      const r = renditionRef.current;
      if (r && typeof r.getContents === 'function') {
        for (const c of r.getContents()) {
          pushDoc(c?.document);
        }
      }
    } catch (_) {
      /* ignore */
    }
    try {
      const stage = stageRef.current;
      if (stage?.querySelectorAll) {
        stage.querySelectorAll('iframe').forEach((fr) => {
          try {
            pushDoc(fr.contentDocument);
          } catch (_) {
            /* ignore */
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  function resolveBackendUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('http')) return url;
    if (url.startsWith('/api/')) {
      return apiBaseEndsWithApi ? `${backendOrigin}${url}` : `${backendOrigin}${url.slice(4)}`;
    }
    if (url.startsWith('/')) return `${backendOrigin}${url}`;
    return `${backendOrigin}/${url}`;
  }

  /** <audio src> cannot send Authorization; backend accepts ?token= on GET (see authenticate middleware). */
  function resolveAuthenticatedMediaUrl(url) {
    const u = resolveBackendUrl(url);
    return u ? withAuthImageQuery(u) : u;
  }

  function normalizeAlignmentToBlocks(alignment) {
    const raw = coerceAlignmentSegments(alignment);
    const blocksAll = raw
      .map((s) => {
        const id = String(s?.id ?? s?.block_id ?? s?.blockId ?? '').trim();
        const start = Number(s?.startTime ?? s?.start_time ?? 0);
        const end = Number(s?.endTime ?? s?.end_time ?? 0);
        if (!id) return null;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (end <= start) return null;
        const si = s?.sectionIndex;
        const sectionIndex =
          si != null && Number.isFinite(Number(si)) ? Number(si) : undefined;
        return { id, start, end, sectionIndex };
      })
      .filter(Boolean);

    // Prefer word-level timing per page only. If any page in the book had word-level
    // segments, the old global filter dropped zone/sentence segments on every other page,
    // so nothing matched for highlight on those pages.
    const byPage = new Map();
    for (const b of blocksAll) {
      const p = resolveBlockPageNum(b.id);
      if (!byPage.has(p)) byPage.set(p, []);
      byPage.get(p).push(b);
    }
    const merged = [];
    for (const [, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const hasWordBlocks = list.some((x) => isWordLevelBlockId(x.id));
      merged.push(...(hasWordBlocks ? list.filter((x) => isWordLevelBlockId(x.id)) : list));
    }

    const blocks = merged.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    const byId = new Map(blocks.map((b) => [b.id, b]));
    return { blocks, byId };
  }

  /**
   * Per-page MP3 uses currentTime 0…duration; alignment stores the same per-page window for each
   * page, merged into one array — times overlap across pages. When audio is /audio/page/N,
   * only consider segments for that page so highlighting matches playback.
   *
   * Audio file index (page_1.mp3) can disagree with zone ids (p3_z1) when PDF page numbering
   * ≠ spine order. Prefer spine href + DOM id scan so visible pN_* matches alignment filter.
   */
  function rebuildActiveSyncBlocksForPlayback() {
    const all = syncBlocksAllRef.current || [];
    const audio = audioRef.current;
    const sectionFromSrc = audio && parseSectionIndexFromAudioSrc(audio.src);
    const hasSectionTagged = all.some((b) => b.sectionIndex != null && Number.isFinite(b.sectionIndex));

    if (!all.length) {
      syncBlocksRef.current = all;
      return;
    }

    if (hasSectionTagged && sectionFromSrc != null) {
      const filtered = all.filter((b) => b.sectionIndex === sectionFromSrc);
      syncBlocksRef.current = filtered.length
        ? filtered.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
        : all;
      return;
    }

    const pageFromSrc = audio && parsePageNumFromPerPageAudioSrc(audio.src);

    if (!pageFromSrc) {
      syncBlocksRef.current = all;
      return;
    }

    const filterByPage = (p) => all.filter((b) => resolveBlockPageNum(b.id) === p);
    let pageFilter = null;

    let pageFromSpine = null;
    try {
      const href = renditionRef.current?.currentLocation?.()?.start?.href || '';
      pageFromSpine = parseFxPageNumFromEpubHref(href);
    } catch (_) {
      pageFromSpine = null;
    }

    const listSpine = pageFromSpine ? filterByPage(pageFromSpine) : [];
    const listAudio = filterByPage(pageFromSrc);

    if (pageFromSpine && listSpine.length > 0) {
      pageFilter = pageFromSpine;
    } else if (listAudio.length > 0) {
      pageFilter = pageFromSrc;
    } else {
      let docPage = null;
      try {
        for (const doc of getDocumentsForHighlight()) {
          docPage = inferZonePageNumFromDocument(doc);
          if (docPage) break;
        }
      } catch (_) {
        /* ignore */
      }
      const listDoc = docPage ? filterByPage(docPage) : [];
      if (listDoc.length > 0) {
        pageFilter = docPage;
      } else {
        syncBlocksRef.current = all;
        return;
      }
    }

    const filtered = pageFilter != null ? filterByPage(pageFilter) : all;
    syncBlocksRef.current = filtered.length
      ? filtered.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
      : all;
  }

  function findActiveBlockId(tSeconds) {
    const t = Number(tSeconds || 0);
    const blocks = syncBlocksRef.current || [];
    if (!blocks.length || !Number.isFinite(t)) return null;

    // Find rightmost block whose start <= t, then validate end.
    let lo = 0;
    let hi = blocks.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].start <= t) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return null;
    const b = blocks[best];
    return t >= b.start && t <= b.end ? b.id : null;
  }

  function clearSyncHighlight() {
    clearReaderHighlightMarkup(highlightedElRef.current);
    highlightedElRef.current = null;
    activeBlockIdRef.current = null;
  }

  function applySyncHighlight(blockId, { force = false, scroll = true } = {}) {
    if (!renditionRef.current) return;

    activeBlockIdRef.current = blockId;
    if (!blockId) {
      clearReaderHighlightMarkup(highlightedElRef.current);
      highlightedElRef.current = null;
      return;
    }

    const blk = blockByIdRef.current.get(blockId);
    const audio = audioRef.current;
    const t = audio?.currentTime ?? 0;

    const docs = getDocumentsForHighlight();
    let resolved = null;
    for (const doc of docs) {
      if (!doc?.documentElement) continue;
      resolved = resolveElementForSyncBlock(doc, blockId, t, blk?.start ?? 0, blk?.end ?? 0);
      if (resolved) break;
    }

    if (!resolved) {
      clearReaderHighlightMarkup(highlightedElRef.current);
      highlightedElRef.current = null;
      return;
    }

    if (!force && resolved === highlightedElRef.current && resolved.isConnected) return;

    if (highlightedElRef.current && highlightedElRef.current !== resolved) {
      clearReaderHighlightMarkup(highlightedElRef.current);
    }

    applyReaderHighlightMarkup(resolved);
    highlightedElRef.current = resolved;
    if (scroll) {
      try {
        resolved.scrollIntoView({ behavior: 'auto', block: 'center' });
      } catch (_) {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let resizeObserver;
    bookRef.current = null;
    renditionRef.current = null;
    setReady(false);
    setLoadError('');
    setToc([]);
    setAnchorDebug('');
    setFxlMode(false);

    if (!jobId || !stageRef.current) return undefined;

    const downloadPath =
      resolvedSource === 'kitaboo' ? `/kitaboo/download/${jobId}` : `/conversions/${jobId}/download`;

    (async () => {
      try {
        const res = await api.get(downloadPath, { responseType: 'blob' });
        const blob = res.data;
        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error('Empty EPUB response');
        }
        const arrayBuffer = await blob.arrayBuffer();
        if (cancelled || !stageRef.current) return;

        const book = ePub(arrayBuffer);
        bookRef.current = book;
        await book.ready;
        if (cancelled || !stageRef.current) return;

        const metaLayout = String(book.packaging?.metadata?.layout || book.package?.metadata?.layout || '').toLowerCase();
        const isPrePaginatedMeta = metaLayout === 'pre-paginated';
        const useFxlRendering = Boolean(fixedLayout || isPrePaginatedMeta);
        const packageViewport = book.packaging?.metadata?.viewport || book.package?.metadata?.viewport;

        if (!cancelled) setFxlMode(useFxlRendering);

        // FXL: paginated + spread none for page-fit; reflowable: paginated + minSpreadWidth. FXL also gets viewport scale in `rendered`.
        const rendition = book.renderTo(stageRef.current, {
          width: '100%',
          height: '100%',
          allowScriptedContent: false,
          ...(useFxlRendering
            ? {
                layout: 'pre-paginated',
                flow: 'paginated',
                spread: 'none',
                minSpreadWidth: 0
              }
            : { flow: 'paginated', spread: 'auto', minSpreadWidth: 800 })
        });
        renditionRef.current = rendition;

        rendition.on('relocated', (loc) => {
          const s = syncStudioRef.current;

          if (resolvedSource === 'conversion' && s?.perSectionAudioUrls && Object.keys(s.perSectionAudioUrls).length > 0) {
            const bk = bookRef.current;
            const spineIdx = spineIndexFromLocation(bk, loc);
            if (spineIdx == null) return;
            const secPath = resolvePerSectionAudioUrl(s.perSectionAudioUrls, spineIdx);
            if (!secPath) return;
            const url = resolveAuthenticatedMediaUrl(secPath);
            const audio = audioRef.current;
            if (!audio || !url) return;
            if (String(audio.src).includes(`/audio/section/${spineIdx}`)) {
              rebuildActiveSyncBlocksForPlayback();
              return;
            }
            const wasPlaying = !audio.paused;
            audio.pause();
            audio.src = url;
            audio.load();
            setAudioUi((prev) => ({ ...prev, currentTime: 0, playing: false }));
            rebuildActiveSyncBlocksForPlayback();
            clearSyncHighlight();
            if (wasPlaying) audio.play().catch(() => {});
            return;
          }

          if (resolvedSource !== 'kitaboo') return;
          if (!s?.perPageAudioUrls || Object.keys(s.perPageAudioUrls).length === 0) return;
          const main = s.audioUrl || '';
          if (main && !/\/audio\/page\//.test(main)) return;
          const href = loc?.start?.href || loc?.href || '';
          const pageNum = parseFxPageNumFromEpubHref(href);
          const pageAudioPath = resolvePerPageAudioUrl(s.perPageAudioUrls, pageNum);
          if (!pageNum || !pageAudioPath) return;
          const url = resolveAuthenticatedMediaUrl(pageAudioPath);
          const audio = audioRef.current;
          if (!audio || !url) return;
          const wasPlaying = !audio.paused;
          audio.pause();
          audio.src = url;
          audio.load();
          setAudioUi((prev) => ({ ...prev, currentTime: 0, playing: false }));
          rebuildActiveSyncBlocksForPlayback();
          clearSyncHighlight();
          if (wasPlaying) audio.play().catch(() => {});
        });

        rendition.themes.default(buildResponsiveTheme({ dark: false, fxl: useFxlRendering }));
        rendition.themes.register('syncDark', buildResponsiveTheme({ dark: true, fxl: useFxlRendering }));

        // Verbose console: in dev, localStorage.setItem('epubReaderDebug','1') then reload.
        const epubDebug =
          import.meta.env.DEV &&
          typeof localStorage !== 'undefined' &&
          localStorage.getItem('epubReaderDebug') === '1';

        if (epubDebug) {
          rendition.on('layout', (props, changed) => {
            console.log('[SyncStudioEpubReader] layout', props, changed);
          });
        }

        const lastFxlViewRef = { current: null };
        if (useFxlRendering && stageRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            const v = lastFxlViewRef.current;
            if (v) scheduleFxlViewportScale(v, stageRef.current, packageViewport);
          });
          resizeObserver.observe(stageRef.current);
        }

        let didScrollFallbackProbe = false;
        rendition.on('rendered', (section, view) => {
          if (useFxlRendering) {
            lastFxlViewRef.current = view;
          }
          try {
            if (typeof view?.expand === 'function') {
              view.expand(true);
            } else if (typeof view?.contents?.resizeCheck === 'function') {
              view.contents.resizeCheck();
            }
          } catch (_) {
            /* ignore */
          }
          try {
            const stage = stageRef.current;
            if (stage && typeof rendition.resize === 'function') {
              rendition.resize(stage.clientWidth, stage.clientHeight);
            }
          } catch (_) {
            /* ignore */
          }

          if (useFxlRendering) {
            try {
              scheduleFxlViewportScale(view, stageRef.current, packageViewport);
            } catch (_) {
              /* ignore */
            }
          }

          if (!useFxlRendering && !didScrollFallbackProbe && view?.document) {
            didScrollFallbackProbe = true;
            try {
              const absCount = view.document.querySelectorAll('[style*="position:absolute"]').length;
              if (absCount > 10 && typeof rendition.flow === 'function') {
                rendition.flow('scrolled');
              }
            } catch (_) {
              /* ignore */
            }
          }

          // Audio-sync click + highlight re-apply (works in reflowable and FXL)
          try {
            const doc = view?.document;
            if (doc) {
              // Bind click handler once per rendered iframe document
              if (!clickBoundDocsRef.current.has(doc)) {
                clickBoundDocsRef.current.add(doc);
                doc.addEventListener(
                  'click',
                  (e) => {
                    const target = e?.target;
                    if (!target) return;

                    // Walk up the DOM until we find an element with an id
                    let node = target;
                    let clickedId = null;
                    // eslint-disable-next-line no-constant-condition
                    while (node && node !== doc) {
                      const idAttr =
                        node.id ||
                        (typeof node.getAttribute === 'function' ? node.getAttribute('id') : null);
                      if (idAttr) {
                        clickedId = idAttr;
                        break;
                      }
                      node = node.parentNode;
                    }
                    if (!clickedId) return;

                    const blk = blockByIdRef.current.get(clickedId);
                    if (!blk) return;

                    // Jump audio + update highlight immediately (timeupdate will keep it in sync)
                    const audio = audioRef.current;
                    if (!audio) return;
                    applySyncHighlight(clickedId, { force: true, scroll: true });
                    audio.currentTime = Math.max(0, blk.start + 0.001);
                    audio.play().catch(() => {});
                  },
                  true
                );
              }

              // If the current active block exists in this page, re-apply highlight after re-render.
              const activeId = activeBlockIdRef.current;
              if (activeId) {
                applySyncHighlight(activeId, { force: true, scroll: false });
              }
            }
          } catch (_) {
            /* ignore */
          }

          if (!epubDebug) return;
          const doc = view?.document;
          if (!doc?.body) return;
          try {
            doc.querySelectorAll('[style]').forEach((el) => {
              const s = el.getAttribute('style') || '';
              if (/\bwidth\s*:/i.test(s) || /\bwidth\s*=/.test(s)) {
                console.log('[SyncStudioEpubReader] inline width:', el.tagName, s.slice(0, 200));
              }
            });
          } catch (_) {
            /* ignore */
          }
          const html = doc.body.innerHTML;
          const max = 12000;
          console.log(
            '[SyncStudioEpubReader] rendered',
            section?.href,
            html.length > max ? `${html.slice(0, max)}… (${html.length} chars total)` : html
          );
        });

        try {
          const nav = await book.loaded.navigation;
          setToc(flattenToc(nav?.toc || []));
        } catch {
          setToc([]);
        }

        if (cancelled) return;

        // epub.js often needs an explicit display() before the iframe paints; anchor navigation still runs in the effect below.
        const initialTarget = resolveDisplayTarget(book, spineHref);
        if (initialTarget) {
          await rendition.display(initialTarget).catch(() => rendition.display());
        } else {
          await rendition.display().catch(() => {});
        }

        if (cancelled) return;
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          const status = e?.response?.status;
          if (status === 404 && resolvedSource === 'conversion') {
            setResolvedSource('kitaboo');
            return;
          }
          if (status === 404 && resolvedSource === 'kitaboo') {
            setLoadError(
              'No FXL EPUB on the server yet. Use Export FXL EPUB 3 in Zoning Studio, then open Reader again.'
            );
          } else {
            setLoadError(e?.response?.data?.error || e?.message || 'Could not load EPUB for reader.');
          }
          console.error('[SyncStudioEpubReader]', e);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        resizeObserver?.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        bookRef.current?.destroy?.();
      } catch (_) {
        /* ignore */
      }
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [jobId, epubSource, fixedLayout, resolvedSource]);

  // Load audio + sync alignment blocks (word/sentence/zone ids + timings)
  useEffect(() => {
    let cancelled = false;

    // Reset
    clearSyncHighlight();
    setSyncStudio(null);
    syncStudioRef.current = null;
    syncBlocksAllRef.current = [];
    syncBlocksRef.current = [];
    blockByIdRef.current = new Map();
    fxlZoneIdToPageRef.current = new Map();
    setSyncLoadError('');

    setAudioUi({ playing: false, currentTime: 0, duration: 0 });
    const audio = audioRef.current;
    try {
      audio.pause();
      audio.src = '';
      audio.currentTime = 0;
    } catch (_) {
      /* ignore */
    }

    if (!jobId) return undefined;

    (async () => {
      try {
        const endpoint =
          resolvedSource === 'kitaboo'
            ? `/kitaboo/sync-studio/${jobId}`
            : `/audio-sync/sync-studio/${jobId}`;

        const res = await api.get(endpoint);
        if (cancelled) return;
        const data = res.data?.data ?? res.data ?? {};

        setSyncStudio(data);
        syncStudioRef.current = data;
        fxlZoneIdToPageRef.current =
          resolvedSource === 'kitaboo' ? buildZoneIdToPageMap(data.pages || []) : new Map();

        const { blocks, byId } = normalizeAlignmentToBlocks(data?.alignment ?? data?.segments);
        syncBlocksAllRef.current = blocks;
        blockByIdRef.current = byId;

        // Configure audio
        const audioUrl = resolveAuthenticatedMediaUrl(data?.audioUrl);
        if (audioUrl) {
          audio.src = audioUrl;
          audio.load();
          setAudioUi((prev) => ({
            ...prev,
            duration: Number(data?.audioDuration) || 0
          }));
        }
        rebuildActiveSyncBlocksForPlayback();

        // Per-page-only jobs (FXL): sync may finish after the book renders; point audio at the visible spine page.
        if (resolvedSource === 'kitaboo' && data?.perPageAudioUrls && Object.keys(data.perPageAudioUrls).length > 0) {
          requestAnimationFrame(() => {
            try {
              const s = syncStudioRef.current;
              if (!s?.perPageAudioUrls) return;
              const main = s.audioUrl || '';
              if (main && !/\/audio\/page\//.test(main)) return;
              const loc = renditionRef.current?.currentLocation?.();
              const href = loc?.start?.href || '';
              const pageNum = parseFxPageNumFromEpubHref(href);
              const pageAudioPath = resolvePerPageAudioUrl(s.perPageAudioUrls, pageNum);
              if (!pageNum || !pageAudioPath) return;
              const nextUrl = resolveAuthenticatedMediaUrl(pageAudioPath);
              const a = audioRef.current;
              if (!nextUrl || !a) return;
              if (a.src.includes(`/audio/page/${pageNum}`)) {
                rebuildActiveSyncBlocksForPlayback();
                return;
              }
              a.pause();
              a.src = nextUrl;
              a.load();
              setAudioUi((prev) => ({ ...prev, currentTime: 0, playing: false }));
              rebuildActiveSyncBlocksForPlayback();
            } catch (_) {
              /* ignore */
            }
          });
        }

        // Reflowable: one MP3 per spine chapter/section — match audio to current location when sync loads after EPUB.
        if (resolvedSource === 'conversion' && data?.perSectionAudioUrls && Object.keys(data.perSectionAudioUrls).length > 0) {
          requestAnimationFrame(() => {
            try {
              const s = syncStudioRef.current;
              if (!s?.perSectionAudioUrls) return;
              const loc = renditionRef.current?.currentLocation?.();
              const spineIdx = spineIndexFromLocation(bookRef.current, loc);
              const idx =
                spineIdx != null
                  ? spineIdx
                  : Math.min(...Object.keys(s.perSectionAudioUrls).map(Number));
              const secPath = resolvePerSectionAudioUrl(s.perSectionAudioUrls, idx);
              if (secPath == null) return;
              const nextUrl = resolveAuthenticatedMediaUrl(secPath);
              const a = audioRef.current;
              if (!nextUrl || !a) return;
              if (a.src.includes(`/audio/section/${idx}`)) {
                rebuildActiveSyncBlocksForPlayback();
                return;
              }
              a.pause();
              a.src = nextUrl;
              a.load();
              setAudioUi((prev) => ({ ...prev, currentTime: 0, playing: false }));
              rebuildActiveSyncBlocksForPlayback();
            } catch (_) {
              /* ignore */
            }
          });
        }
      } catch (e) {
        if (cancelled) return;
        if (e?.response?.status === 404 && resolvedSource === 'conversion') {
          setResolvedSource('kitaboo');
          return;
        }
        console.error('[SyncStudioEpubReader] sync load error:', e);
        setSyncLoadError(e?.response?.data?.error || e?.message || 'Could not load sync data.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, epubSource, resolvedSource]);

  // After the book iframe + location exist, re-filter blocks (spine href / DOM ids were unknown at first sync load).
  useEffect(() => {
    if (!ready || !syncStudio) return;
    if (resolvedSource === 'conversion' && syncStudio.perSectionAudioUrls && Object.keys(syncStudio.perSectionAudioUrls).length > 0) {
      const loc = renditionRef.current?.currentLocation?.();
      const spineIdx = spineIndexFromLocation(bookRef.current, loc);
      if (spineIdx == null) {
        rebuildActiveSyncBlocksForPlayback();
        return;
      }
      const path = resolvePerSectionAudioUrl(syncStudio.perSectionAudioUrls, spineIdx);
      if (!path) {
        rebuildActiveSyncBlocksForPlayback();
        return;
      }
      const nextUrl = resolveAuthenticatedMediaUrl(path);
      const a = audioRef.current;
      if (!a || !nextUrl) {
        rebuildActiveSyncBlocksForPlayback();
        return;
      }
      if (!String(a.src).includes(`/audio/section/${spineIdx}`)) {
        const wasPlaying = !a.paused;
        a.pause();
        a.src = nextUrl;
        a.load();
        setAudioUi((prev) => ({ ...prev, currentTime: 0, playing: false }));
        rebuildActiveSyncBlocksForPlayback();
        clearSyncHighlight();
        if (wasPlaying) a.play().catch(() => {});
      } else {
        rebuildActiveSyncBlocksForPlayback();
      }
      return;
    }
    if (resolvedSource === 'kitaboo') {
      rebuildActiveSyncBlocksForPlayback();
    }
  }, [ready, syncStudio, resolvedSource]);

  // Drive highlight from audio time (real-time)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    let rafId = 0;
    const onTimeUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const nextId = findActiveBlockId(audio.currentTime);
        const prevBlockId = activeBlockIdRef.current;
        // Always refresh highlight: alignment may use parent zone times while DOM uses p1_z1_w0, p1_z1_w1, …
        applySyncHighlight(nextId, {
          force: true,
          scroll: Boolean(nextId) && nextId !== prevBlockId
        });

        setAudioUi((prev) => ({
          ...prev,
          currentTime: audio.currentTime || 0
        }));
      });
    };

    const onLoaded = () => {
      setAudioUi((prev) => ({
        ...prev,
        duration: Number.isFinite(audio.duration) ? audio.duration : prev.duration
      }));
    };

    const onPlay = () => setAudioUi((prev) => ({ ...prev, playing: true }));
    const onPause = () => setAudioUi((prev) => ({ ...prev, playing: false }));
    const onEnded = () => setAudioUi((prev) => ({ ...prev, playing: false }));

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      cancelAnimationFrame(rafId);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  useEffect(() => {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!ready || !rendition || !book) return;
    const run = async () => {
      const displayTarget = resolveDisplayTarget(book, spineHref);
      if (!displayTarget) return;

      const section = book.spine?.get ? book.spine.get(displayTarget) : null;
      await rendition.display(displayTarget).catch(() => rendition.display());

      if (!anchorId || !section || !section.cfiFromElement) return;

      // Search rendered iframe(s) for the target element id.
      // Important: if we pick an element from the wrong spine section, the generated CFI
      // will not correspond and epub.js may keep the same physical page.
      const contents = typeof rendition.getContents === 'function' ? rendition.getContents() : [];
      let el = null;
      const expectedSectionIndex = section?.index;
      for (const c of contents) {
        if (
          expectedSectionIndex != null &&
          c?.sectionIndex != null &&
          Number(c.sectionIndex) !== Number(expectedSectionIndex)
        ) {
          continue;
        }
        const doc = c?.document;
        if (!doc?.documentElement) continue;
        const hit = getElementByIdRobust(doc, anchorId);
        if (hit) {
          el = hit;
          break;
        }
      }

      if (el) {
        setAnchorDebug('');
        const cfi = section.cfiFromElement(el);
        if (cfi) {
          await rendition.display(cfi).catch(() => {});
        }
      } else {
        setAnchorDebug(
          `Anchor '${anchorId}' not found in the rendered EPUB section; opened at section start.`
        );
      }
    };

    run();
  }, [ready, spineHref, anchorId]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    try {
      rendition.themes.fontSize(`${fontPct}%`);
    } catch (_) {
      /* ignore */
    }
  }, [fontPct, ready]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    try {
      rendition.themes.select(theme === 'dark' ? 'syncDark' : 'default');
    } catch (_) {
      /* ignore */
    }
  }, [theme, ready]);

  const goPrev = () => {
    try {
      renditionRef.current?.prev();
    } catch (_) {
      /* ignore */
    }
  };

  const goNext = () => {
    try {
      renditionRef.current?.next();
    } catch (_) {
      /* ignore */
    }
  };

  const toggleAudio = async () => {
    const audio = audioRef.current;
    const hasSectionAudio =
      syncStudio?.perSectionAudioUrls && Object.keys(syncStudio.perSectionAudioUrls).length > 0;
    if ((!syncStudio?.audioUrl && !hasSectionAudio) || !audio) return;
    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (e) {
      console.error('[SyncStudioEpubReader] audio toggle error:', e);
    }
  };

  const onTocChange = (e) => {
    const href = e.target.value;
    e.target.value = '';
    if (!href || !renditionRef.current || !bookRef.current) return;
    const t = resolveDisplayTarget(bookRef.current, href);
    renditionRef.current.display(t || href).catch(() => renditionRef.current.display());
  };

  if (loadError) {
    return (
      <div className="sync-studio-epub-root sync-studio-epub-error">
        <p>{loadError}</p>
        <p className="sync-studio-epub-hint">
          {resolvedSource === 'kitaboo'
            ? 'Reader uses the same file as download from Zoning Studio. Fixed-layout rendering in the browser may differ from a desktop reader.'
            : 'The job needs an EPUB on the server (complete conversion, Save & export, or EPUB import). Use HTML preview for tap-to-sync.'}
        </p>
      </div>
    );
  }

  return (
    <div className="sync-studio-epub-root">
      <div className="sync-studio-epub-toolbar">
        <button type="button" className="sync-studio-epub-btn" onClick={goPrev} title="Previous page">
          ‹ Prev
        </button>
        <button type="button" className="sync-studio-epub-btn" onClick={goNext} title="Next page">
          Next ›
        </button>
        <select className="sync-studio-epub-select" onChange={onTocChange} defaultValue="" aria-label="Table of contents">
          <option value="" disabled>
            TOC…
          </option>
          {toc.map((t, i) => (
            <option key={`${t.href}-${i}`} value={t.href}>
              {'\u00A0'.repeat(Math.min(t.depth * 2, 12))}
              {t.label}
            </option>
          ))}
        </select>
        <span className="sync-studio-epub-sep" aria-hidden />
        <button type="button" className="sync-studio-epub-btn" onClick={() => setFontPct((p) => Math.max(70, p - 10))} title="Smaller type">
          A−
        </button>
        <button type="button" className="sync-studio-epub-btn" onClick={() => setFontPct((p) => Math.min(160, p + 10))} title="Larger type">
          A+
        </button>
        <span className="sync-studio-epub-fontpct">{fontPct}%</span>
        <button
          type="button"
          className="sync-studio-epub-btn"
          onClick={() => setTheme((th) => (th === 'light' ? 'dark' : 'light'))}
          title="Toggle light / dark theme inside reader"
        >
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>

        <span className="sync-studio-epub-sep" aria-hidden />
        <button
          type="button"
          className="sync-studio-epub-btn"
          onClick={toggleAudio}
          disabled={!syncStudio?.audioUrl && !(syncStudio?.perSectionAudioUrls && Object.keys(syncStudio.perSectionAudioUrls).length > 0)}
          title={
            syncStudio?.audioUrl ||
            (syncStudio?.perSectionAudioUrls && Object.keys(syncStudio.perSectionAudioUrls).length > 0)
              ? 'Play / Pause audio sync'
              : 'Audio not available for this job'
          }
        >
          {audioUi.playing ? 'Pause' : 'Play'}
        </button>
        <span className="sync-studio-epub-audio-time">
          {formatTime(audioUi.currentTime)} / {formatTime(audioUi.duration)}
        </span>
      </div>
      {syncLoadError && (
        <div className="sync-studio-epub-sync-error">
          {syncLoadError}
        </div>
      )}
      {anchorDebug && (
        <div className="sync-studio-epub-anchor-debug">
          {anchorDebug}
        </div>
      )}
      <div
        ref={stageRef}
        className={`sync-studio-epub-stage${fxlMode ? ' sync-studio-epub-stage--fxl' : ''}`}
      />
    </div>
  );
}
