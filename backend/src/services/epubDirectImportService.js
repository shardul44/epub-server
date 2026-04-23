import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { getEpubOutputDir, getHtmlIntermediateDir, getUploadDir } from '../config/fileStorage.js';
import { ConversionJobModel } from '../models/ConversionJob.js';
import { PdfDocumentModel } from '../models/PdfDocument.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
import { kitabooFxlJobStore } from './kitabooFxlJobStore.js';
import { ConversionService } from './conversionService.js';
import { zonesFromHeuristicWildHtml } from '../utils/wildFxlHtmlHeuristic.js';

/** @param {import('jszip')} zip */
function listOpfPaths(zip) {
  return Object.keys(zip.files).filter(
    (n) => !zip.files[n].dir && n.toLowerCase().endsWith('.opf')
  );
}

/**
 * @param {import('jszip')} zip
 * @param {string} opfPath
 * @param {string} href
 */
function resolveZipEntry(zip, opfPath, href) {
  if (!href) return null;
  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '') : '';
  const normalized = path.posix.normalize(path.posix.join(opfDir, href)).replace(/^\//, '');
  let f = zip.file(normalized);
  if (f) return f;
  const alt = normalized.replace(/^OEBPS\//i, '');
  f = zip.file(alt);
  if (f) return f;
  const base = href.split('/').pop();
  const keys = Object.keys(zip.files);
  const hit = keys.find((k) => !zip.files[k].dir && k.endsWith(base));
  return hit ? zip.file(hit) : null;
}

function parseViewport(doc) {
  const meta = doc.querySelector('meta[name="viewport"]');
  const content = meta?.getAttribute('content') || '';
  const w = /(?:^|;|\s)width\s*=\s*(\d+)/i.exec(content);
  const h = /(?:^|;|\s)height\s*=\s*(\d+)/i.exec(content);
  return {
    width: w ? parseInt(w[1], 10) : 1200,
    height: h ? parseInt(h[1], 10) : 1600
  };
}

function parseCssPx(style, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`, 'i');
  const m = re.exec(style || '');
  return m ? parseFloat(m[1]) : null;
}

/**
 * @param {Document} doc
 * @param {number} pageNum
 */
function zonesFromHtmlSmilTargets(doc, pageNum) {
  const candidates = [];
  const seen = new Set();
  const push = (el) => {
    const id = el.id || el.getAttribute('id');
    const cls = el.getAttribute('class') || '';
    if (!id && !cls.includes('smil-target') && !cls.includes('sentence-wrapper') && !cls.includes('word-wrapper')) return;
    const key = el;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(el);
  };

  doc.querySelectorAll('.sentence-wrapper, .word-wrapper, span.smil-target, div.smil-target').forEach(push);
  if (candidates.length === 0) {
    doc.querySelectorAll('[id*="p"][id*="_z"]').forEach(push);
  }

  const zones = [];
  let order = 0;
  for (const el of candidates) {
    const style = el.getAttribute('style') || '';
    let left = parseCssPx(style, 'left');
    let top = parseCssPx(style, 'top');
    let width = parseCssPx(style, 'width');
    let height = parseCssPx(style, 'height');
    const fsMatch = /font-size\s*:\s*([0-9.]+)px/i.exec(style);
    const fontSize = fsMatch ? parseFloat(fsMatch[1]) : 16;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (left == null) left = 0;
    if (top == null) top = 0;
    if (width == null) width = Math.max(24, text.length * fontSize * 0.45);
    if (height == null) height = Math.max(fontSize * 1.2, 24);
    const zid = el.id && String(el.id).trim() ? String(el.id).trim() : `p${pageNum}_z${order}_s0`;
    zones.push({
      id: zid,
      type: 'text',
      x: left,
      y: top,
      w: width,
      h: height,
      readingOrder: ++order,
      content: text,
      fontSize
    });
  }
  return zones;
}

/**
 * @param {Document} doc
 * @param {number} pageNum
 */
function zonesFromSvg(doc, pageNum) {
  const svg = doc.querySelector('svg');
  if (!svg) return [];
  const texts = [...doc.querySelectorAll('svg text[id], svg text.smil-target')].filter(
    (t) => (t.getAttribute('id') || '').trim().length > 0
  );
  const zones = [];
  let order = 0;
  for (const t of texts) {
    const zid = t.getAttribute('id').trim();
    const x = parseFloat(t.getAttribute('x') || '0') || 0;
    const y = parseFloat(t.getAttribute('y') || '0') || 0;
    const st = t.getAttribute('style') || '';
    const fsMatch = /font-size\s*:\s*([0-9.]+)px/i.exec(st);
    const fontSize = fsMatch ? parseFloat(fsMatch[1]) : 14;
    const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const w = Math.max(40, text.length * fontSize * 0.55);
    const h = Math.max(fontSize * 1.3, 20);
    zones.push({
      id: zid,
      type: 'text',
      x,
      y,
      w,
      h,
      readingOrder: ++order,
      content: text,
      fontSize
    });
  }
  if (zones.length === 0) {
    const tspans = doc.querySelectorAll('svg tspan[id].smil-target');
    let ro = 0;
    tspans.forEach((el) => {
      const zid = el.getAttribute('id').trim();
      const x = parseFloat(el.getAttribute('x') || '0') || 0;
      const y = parseFloat(el.getAttribute('y') || '0') || 0;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const fontSize = 14;
      zones.push({
        id: zid,
        type: 'text',
        x,
        y,
        w: Math.max(40, text.length * fontSize * 0.55),
        h: fontSize * 1.3,
        readingOrder: ++ro,
        content: text,
        fontSize
      });
    });
  }
  return zones;
}

async function bufferToWebpFile(buf, outPath) {
  try {
    await sharp(buf, { failOn: 'none' }).webp({ quality: 88 }).toFile(outPath);
  } catch (e) {
    await sharp(buf).resize({ width: 2048, height: 2048, fit: 'inside' }).webp({ quality: 88 }).toFile(outPath);
  }
}

/** First url(...) inside a CSS fragment (background / background-image). */
function extractUrlFromCssFragment(fragment) {
  if (!fragment) return null;
  const m = /url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/i.exec(fragment);
  if (!m) return null;
  const u = m[1].trim();
  if (u.startsWith('data:')) return null;
  return u;
}

/**
 * Inline-style background image on body/html or elements with background (FXL blanks often omit img.bi).
 * @param {Document} doc
 */
function findBackgroundImageHrefInDocument(doc) {
  const scanStyle = (style) => {
    if (!style) return null;
    for (const prop of ['background-image', 'background']) {
      const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i');
      const part = re.exec(style);
      const url = extractUrlFromCssFragment(part ? part[1] : '');
      if (url) return url;
    }
    const anyUrl = /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style);
    if (anyUrl) {
      const u = anyUrl[1].trim();
      if (!u.startsWith('data:')) return u;
    }
    return null;
  };

  const els = [
    doc.body,
    doc.documentElement,
    ...doc.querySelectorAll('[style*="url("], [style*="background"]')
  ];
  for (const el of els) {
    if (!el || el.nodeType !== 1) continue;
    const hit = scanStyle(el.getAttribute('style') || '');
    if (hit) return hit;
  }
  return null;
}

/** White page when spine has no raster (e.g. blank.xhtml). */
async function writePlaceholderWebp(outPath, vw, vh) {
  const w = Math.max(100, Math.min(Number(vw) || 1200, 4096));
  const h = Math.max(100, Math.min(Number(vh) || 1600, 4096));
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .webp({ quality: 82 })
    .toFile(outPath);
}

/**
 * @param {string} opfXml
 * @returns {'reflowable' | 'fxl'}
 */
export function detectEpubLayoutMode(opfXml) {
  const dom = new JSDOM(opfXml, { contentType: 'application/xml' });
  const doc = dom.window.document;
  const metas = [...doc.querySelectorAll('meta')];
  for (const m of metas) {
    const prop = m.getAttribute('property') || m.getAttribute('name');
    const content = (m.getAttribute('content') || '').toLowerCase();
    if (prop === 'rendition:layout' && content === 'prepaginated') return 'fxl';
  }
  return 'reflowable';
}

export class EpubDirectImportService {
  /**
   * @param {Buffer} epubBuffer
   * @param {string} originalName
   * @param {'auto' | 'reflowable' | 'fxl'} mode
   */
  static async importForAudioSync(epubBuffer, originalName, mode = 'auto', owner = null) {
    const zip = await JSZip.loadAsync(epubBuffer);
    const opfPaths = listOpfPaths(zip);
    if (opfPaths.length === 0) throw new Error('No OPF package document found in EPUB');
    const opfPath = opfPaths.includes('OEBPS/content.opf') ? 'OEBPS/content.opf' : opfPaths[0];
    const opfFile = zip.file(opfPath);
    const opfXml = await opfFile.async('string');

    let layout = mode === 'auto' ? detectEpubLayoutMode(opfXml) : mode === 'fxl' ? 'fxl' : 'reflowable';
    if (mode === 'reflowable') layout = 'reflowable';
    if (mode === 'fxl') layout = 'fxl';

    if (layout === 'fxl') {
      return {
        kind: 'fxl',
        ...(await this._importFxl(zip, opfPath, opfXml, originalName, epubBuffer, owner))
      };
    }
    return { kind: 'reflowable', ...(await this._importReflowable(originalName, epubBuffer, owner)) };
  }

  static async _importReflowable(originalName, epubBuffer, owner = null) {
    const safeBase = path.basename(originalName || 'book.epub', path.extname(originalName || '')) || 'book';
    const uploadsDir = path.join(getUploadDir(), 'epub_imports');
    await fs.mkdir(uploadsDir, { recursive: true });

    const pdfRecord = await PdfDocumentModel.create({
      fileName: `${safeBase}.epub`,
      originalFileName: originalName || 'import.epub',
      filePath: path.join(uploadsDir, `stub_${Date.now()}.epub`),
      fileSize: epubBuffer.length,
      totalPages: 0,
      documentType: 'OTHER',
      pageQuality: 'DIGITAL_NATIVE',
      layoutType: 'REFLOWABLE',
      hasTables: false,
      hasFormulas: false,
      hasMultiColumn: false,
      userId: owner?.userId ?? null,
      organizationId: owner?.organizationId ?? null
    });

    await fs.writeFile(pdfRecord.file_path, epubBuffer);

    let job = await ConversionJobModel.create({
      pdfDocumentId: pdfRecord.id,
      status: 'PENDING',
      currentStep: null,
      progressPercentage: 0,
      intermediateData: JSON.stringify({
        source: 'epub_direct_import',
        originalFileName: originalName,
        layout: 'reflowable'
      })
    });

    const epubDir = getEpubOutputDir();
    await fs.mkdir(epubDir, { recursive: true });
    const destEpub = path.join(epubDir, `epub_${job.id}.epub`);
    await fs.writeFile(destEpub, epubBuffer);

    job = await ConversionJobModel.update(job.id, {
      status: 'COMPLETED',
      progressPercentage: 100,
      epubFilePath: destEpub,
      completedAt: new Date(),
      intermediateData: JSON.stringify({
        source: 'epub_direct_import',
        originalFileName: originalName,
        layout: 'reflowable'
      })
    });

    return {
      job: ConversionService.convertToDTO(job),
      syncStudioPath: `/sync-studio/${job.id}`
    };
  }

  static async _importFxl(zip, opfPath, opfXml, originalName, epubBuffer, owner = null) {
    const opfDom = new JSDOM(opfXml, { contentType: 'application/xml' });
    const opfDoc = opfDom.window.document;
    const manifest = opfDoc.querySelector('manifest');
    const spine = opfDoc.querySelector('spine');
    if (!manifest || !spine) throw new Error('Invalid OPF: missing manifest or spine');

    const itemsById = {};
    manifest.querySelectorAll('item').forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const props = (item.getAttribute('properties') || '').toLowerCase();
      const mt = (item.getAttribute('media-type') || '').toLowerCase();
      if (id && href) itemsById[id] = { href, props, mediaType: mt };
    });

    /** Ordered spine HTML items with manifest id (for preserve-import publish: SMIL → original XHTML hrefs). */
    const spineHtmlItems = [];
    spine.querySelectorAll('itemref').forEach((ref) => {
      const idref = ref.getAttribute('idref');
      const it = itemsById[idref];
      if (!it) return;
      if (it.props.includes('nav')) return;
      const isHtml =
        it.mediaType.includes('html') ||
        it.href.toLowerCase().endsWith('.xhtml') ||
        it.href.toLowerCase().endsWith('.html');
      if (!isHtml) return;
      const base = path.basename(it.href).toLowerCase();
      if (base === 'nav.xhtml' || base === 'toc.xhtml') return;
      spineHtmlItems.push({ manifestId: idref, href: it.href });
    });

    const spineHrefs = spineHtmlItems.map((s) => s.href);

    if (spineHrefs.length === 0) throw new Error('No fixed-layout pages found in spine (or only nav documents).');

    const uploadsDir = path.join(getUploadDir(), 'epub_imports');
    await fs.mkdir(uploadsDir, { recursive: true });
    const safeBase = path.basename(originalName || 'book.epub', path.extname(originalName || '')) || 'book';
    const pendingEpubPath = path.join(uploadsDir, `fxl_pending_${Date.now()}.epub`);

    const pdfRecord = await PdfDocumentModel.create({
      fileName: `${safeBase}.epub`,
      originalFileName: originalName || 'import.epub',
      filePath: pendingEpubPath,
      fileSize: epubBuffer.length,
      totalPages: spineHrefs.length,
      documentType: 'OTHER',
      pageQuality: 'DIGITAL_NATIVE',
      layoutType: 'FIXED_LAYOUT',
      hasTables: false,
      hasFormulas: false,
      hasMultiColumn: false,
      userId: owner?.userId ?? null,
      organizationId: owner?.organizationId ?? null
    });

    await fs.writeFile(pendingEpubPath, epubBuffer);

    let job = await ConversionJobModel.create({
      pdfDocumentId: pdfRecord.id,
      status: 'COMPLETED',
      currentStep: null,
      progressPercentage: 100,
      intermediateData: JSON.stringify({
        source: 'epub_direct_import',
        originalFileName: originalName,
        layout: 'fxl'
      }),
      completedAt: new Date()
    });

    const jobId = String(job.id);
    const finalEpubPath = path.join(uploadsDir, `fxl_stub_${jobId}.epub`);
    try {
      await fs.rename(pendingEpubPath, finalEpubPath);
    } catch {
      await fs.copyFile(pendingEpubPath, finalEpubPath);
      await fs.unlink(pendingEpubPath).catch(() => {});
    }
    await PdfDocumentModel.update(pdfRecord.id, { filePath: finalEpubPath });
    job = await ConversionJobModel.update(job.id, { epubFilePath: finalEpubPath });

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const webpDir = path.join(intermediateDir, 'webp');
    await fs.mkdir(webpDir, { recursive: true });

    const importedPackageDir = path.join(intermediateDir, 'imported_package');
    await fs.mkdir(importedPackageDir, { recursive: true });
    for (const name of Object.keys(zip.files)) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      const safeName = name.replace(/\\/g, '/');
      const outPath = path.join(importedPackageDir, safeName);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const buf = await entry.async('nodebuffer');
      await fs.writeFile(outPath, buf);
    }

    const opfPosix = opfPath.replace(/\\/g, '/');
    const opfParent = path.posix.dirname(opfPosix);
    const spineMeta = [];
    spineHtmlItems.forEach((item, idx) => {
      const pageNumber = idx + 1;
      const xhtmlPathFromEpubRoot = path.posix.join(opfParent, item.href).replace(/\\/g, '/');
      spineMeta.push({
        pageNumber,
        manifestId: item.manifestId,
        href: item.href,
        xhtmlPathFromEpubRoot
      });
    });

    let defaultViewportWidth = 1200;
    let defaultViewportHeight = 1600;

    const metaJson = JSON.stringify(
      { extractionLevel: 'sentence', source: 'epub_direct_import', pageCount: spineHrefs.length },
      null,
      0
    );
    await fs.writeFile(path.join(webpDir, 'job_metadata.json'), metaJson, 'utf8');

    const pages = [];
    let pageNum = 0;

    for (const href of spineHrefs) {
      pageNum += 1;
      const xhtmlEntry = resolveZipEntry(zip, opfPath, href);
      if (!xhtmlEntry) {
        console.warn(`[EpubImport FXL] Missing spine file: ${href}`);
        continue;
      }
      let raw = await xhtmlEntry.async('string');
      raw = raw.replace(/^\uFEFF/, '');
      const dom = new JSDOM(raw, { contentType: 'application/xhtml+xml' });
      const doc = dom.window.document;
      const { width: vw, height: vh } = parseViewport(doc);
      if (pageNum === 1) {
        defaultViewportWidth = vw;
        defaultViewportHeight = vh;
      }

      let zones = zonesFromHtmlSmilTargets(doc, pageNum);
      if (zones.length === 0) {
        zones = zonesFromHeuristicWildHtml(doc, pageNum, { width: vw, height: vh });
      }
      if (zones.length === 0) zones = zonesFromSvg(doc, pageNum);

      let imgHref = null;
      const bi = doc.querySelector('img.bi');
      if (bi) imgHref = bi.getAttribute('src') || '';
      if (!imgHref) {
        const svgImg = doc.querySelector('svg image');
        if (svgImg) {
          imgHref =
            svgImg.getAttribute('href') ||
            svgImg.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
            svgImg.getAttribute('xlink:href') ||
            '';
        }
      }
      if (!imgHref) {
        const firstImg = doc.querySelector('img[src]');
        if (firstImg) imgHref = firstImg.getAttribute('src') || '';
      }
      if (!imgHref) imgHref = findBackgroundImageHrefInDocument(doc);

      const webpName = `page_${pageNum}.webp`;
      const webpAbs = path.join(webpDir, webpName);
      let usedPlaceholder = false;

      if (imgHref) {
        const hrefDir = href.includes('/') ? href.replace(/\/[^/]+$/, '') : '';
        const joinedPath = hrefDir ? path.posix.join(hrefDir, imgHref) : imgHref;
        const imgEntry =
          resolveZipEntry(zip, opfPath, joinedPath) || resolveZipEntry(zip, opfPath, imgHref);
        if (imgEntry) {
          try {
            const imgBuf = await imgEntry.async('nodebuffer');
            await bufferToWebpFile(imgBuf, webpAbs);
          } catch (e) {
            console.warn(
              `[EpubImport FXL] Page ${pageNum} (${href}): could not decode image ${imgHref}: ${e.message}`
            );
            await writePlaceholderWebp(webpAbs, vw, vh);
            usedPlaceholder = true;
          }
        } else {
          console.warn(
            `[EpubImport FXL] Page ${pageNum} (${href}): missing file in package for ${imgHref}; using placeholder`
          );
          await writePlaceholderWebp(webpAbs, vw, vh);
          usedPlaceholder = true;
        }
      } else {
        console.warn(
          `[EpubImport FXL] Page ${pageNum} (${href}): no background image (e.g. blank page); using white placeholder`
        );
        await writePlaceholderWebp(webpAbs, vw, vh);
        usedPlaceholder = true;
      }

      const meta = await sharp(webpAbs).metadata();

      if (zones.length === 0) {
        const fallbackText = (doc.body && doc.body.textContent ? doc.body.textContent : '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2000);
        if (fallbackText) {
          zones.push({
            id: `p${pageNum}_z0_s0`,
            type: 'text',
            x: 16,
            y: 24,
            w: Math.max(100, vw - 32),
            h: 48,
            readingOrder: 1,
            content: fallbackText,
            fontSize: 18
          });
        } else if (usedPlaceholder) {
          // Sync Studio drops pages with zero zones; keep blank spine pages in the list.
          zones.push({
            id: `p${pageNum}_z0_s0`,
            type: 'text',
            x: 0,
            y: 0,
            w: Math.max(8, Math.round(vw * 0.01)),
            h: Math.max(8, Math.round(vh * 0.01)),
            readingOrder: 1,
            content: ' ',
            fontSize: 12
          });
        }
      }

      await KitabooZoneModel.saveZonesForJob(jobId, pdfRecord.id, pageNum, zones);

      pages.push({
        pageNumber: pageNum,
        imagePath: `/backend/html_intermediate/kitaboo_${jobId}/webp/${webpName}`,
        dimensions: { width: meta.width || vw, height: meta.height || vh },
        pointsDimensions: null,
        zones
      });
    }

    if (pages.length === 0) throw new Error('No pages could be imported from EPUB.');

    const importPackageMeta = {
      preserveForPublish: true,
      opfPath: opfPosix,
      defaultViewportWidth,
      defaultViewportHeight,
      spine: spineMeta
    };
    await fs.writeFile(
      path.join(intermediateDir, 'import_package_meta.json'),
      JSON.stringify(importPackageMeta, null, 2),
      'utf8'
    );

    kitabooFxlJobStore.start(pdfRecord.id, jobId);
    kitabooFxlJobStore.complete(jobId, pages, [], 'sentence');

    return {
      job: ConversionService.convertToDTO(job),
      jobId,
      pdfId: pdfRecord.id,
      pageCount: pages.length,
      fxlSyncStudioPath: `/fxl-sync-studio/${jobId}`
    };
  }
}
