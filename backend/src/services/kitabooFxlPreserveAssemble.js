/**
 * FXL EPUB publish for jobs imported via epubDirectImport (preserve original package).
 * Copies imported_package/, adds audio/ + smil/, merges media-overlay into the existing OPF.
 * Requires kitaboo_${jobId}/alignment.json (Sync Studio) and human_audio/*.mp3 (same rules as full assemble).
 */
import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { JSDOM } from 'jsdom';
import { EpubGenerator } from '../utils/epubGenerator.js';
import { KitabooFxlService } from './KitabooFxlService.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';

async function humanAudioFileExists(absPath) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} humanAudioDir @param {number} pageNum */
async function resolvePerPageHumanAudioPath(humanAudioDir, pageNum) {
  for (const ext of ['mp3', 'wav', 'm4a']) {
    const candidates = [
      path.join(humanAudioDir, `page_${pageNum}.${ext}`),
      path.join(humanAudioDir, `page${pageNum}.${ext}`)
    ];
    for (const p of candidates) {
      if (await humanAudioFileExists(p)) return p;
    }
  }
  return null;
}

/**
 * Build `import_package_meta` from `imported_package/` when the JSON file was never written
 * (legacy imports). Enables preserve export so SMIL/media-overlay are written into the EPUB.
 *
 * @param {string} intermediateDir - `html_intermediate/kitaboo_${jobId}`
 * @returns {Promise<object|null>}
 */
export async function discoverImportPackageMeta(intermediateDir) {
  const importedRoot = path.join(intermediateDir, 'imported_package');
  try {
    await fs.access(importedRoot);
  } catch {
    return null;
  }
  const containerPath = path.join(importedRoot, 'META-INF', 'container.xml');
  let containerXml;
  try {
    containerXml = await fs.readFile(containerPath, 'utf8');
  } catch {
    return null;
  }
  const cDom = new JSDOM(containerXml, { contentType: 'application/xml' });
  const rootfile = cDom.window.document.querySelector('rootfile');
  const fullPath = (rootfile?.getAttribute('full-path') || '').replace(/\\/g, '/').trim();
  if (!fullPath) return null;

  const opfAbs = path.join(importedRoot, ...fullPath.split('/').filter(Boolean));
  let opfXml;
  try {
    opfXml = await fs.readFile(opfAbs, 'utf8');
  } catch {
    return null;
  }

  const opfDom = new JSDOM(opfXml, { contentType: 'application/xml' });
  const opfDoc = opfDom.window.document;
  const manifest = opfDoc.querySelector('manifest');
  const spine = opfDoc.querySelector('spine');
  if (!manifest || !spine) return null;

  const itemsById = {};
  manifest.querySelectorAll('item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const props = (item.getAttribute('properties') || '').toLowerCase();
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    if (id && href) itemsById[id] = { href, props, mediaType: mt };
  });

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

  if (spineHtmlItems.length === 0) return null;

  const opfRel = fullPath;
  const opfParent = path.posix.dirname(opfRel);
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

  return {
    preserveForPublish: true,
    opfPath: opfRel,
    defaultViewportWidth: 1200,
    defaultViewportHeight: 1600,
    spine: spineMeta,
    discoveredFromPackage: true
  };
}

/**
 * @param {string} jobId
 * @param {Array} pagesData
 * @param {object} options - same subset as assembleFxlEpub (syncLevel ignored for fragment pick; uses alignment ids)
 * @param {object} preserveMeta - import_package_meta.json
 * @param {string} intermediateDir
 * @param {string} outputDir
 * @param {string} tempDir
 */
export async function assembleFxlEpubPreserveImport(
  jobId,
  pagesData,
  options,
  preserveMeta,
  intermediateDir,
  outputDir,
  tempDir
) {
  const importedRoot = path.join(intermediateDir, 'imported_package');
  try {
    await fs.access(importedRoot);
  } catch {
    throw new Error('imported_package/ missing; re-import the FXL EPUB.');
  }

  const alignmentPath = path.join(intermediateDir, 'alignment.json');
  let alignmentSegments = [];
  try {
    const raw = await fs.readFile(alignmentPath, 'utf8');
    const data = JSON.parse(raw);
    alignmentSegments = Array.isArray(data?.segments) ? data.segments : Array.isArray(data) ? data : [];
  } catch {
    alignmentSegments = [];
  }
  if (!alignmentSegments.length) {
    throw new Error(
      'Preserve-import EPUB export requires alignment.json (Sync Studio timings). Sync audio first, then publish.'
    );
  }

  // Same canonical ids as GET/PUT sync-studio and publish pagesData (fixes lookup when alignment.json ids drift).
  try {
    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    const { pages, zoneIdMapByPage } = KitabooFxlService.buildSyncStudioPagesAndZoneMaps(zonesByPage);
    alignmentSegments = KitabooFxlService.remapAlignmentSegmentsWithMaps(alignmentSegments, pages, zoneIdMapByPage);
  } catch (e) {
    console.warn('[KitabooFXL Preserve] Could not remap alignment ids to canonical zones:', e.message);
  }

  const byId = new Map();
  for (const seg of alignmentSegments) {
    if (seg == null || seg.id == null || String(seg.id).trim() === '') continue;
    byId.set(String(seg.id), seg);
  }

  const findAlignmentForZone = (z, textZones) => {
    const zid = String(z.id || '');
    let row = byId.get(zid);
    if (row && row.startTime != null && row.endTime != null) return row;
    for (const seg of alignmentSegments) {
      const resolved = KitabooFxlService.resolveSegmentIdToNormalizedZoneId(String(seg.id), textZones);
      if (resolved === zid && seg.startTime != null && seg.endTime != null) return seg;
    }
    return null;
  };

  const humanAudioDir = path.join(intermediateDir, 'human_audio');
  const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
  let sharedGlobalAudio = null;
  try {
    const files = await fs.readdir(humanAudioDir);
    for (const name of singleBookNames) {
      if (files.includes(name)) {
        sharedGlobalAudio = path.join(humanAudioDir, name);
        break;
      }
    }
    if (!sharedGlobalAudio) {
      const audioFiles = files.filter((f) => /\.(mp3|wav|m4a)$/i.test(f));
      const nonPageOnly = audioFiles.filter((f) => !/^page_?\d+\./i.test(f));
      if (nonPageOnly.length === 1) {
        sharedGlobalAudio = path.join(humanAudioDir, nonPageOnly[0]);
      }
    }
  } catch {
    // no human_audio
  }

  const workspace = path.join(tempDir, 'preserve_pkg');
  await fs.mkdir(workspace, { recursive: true });
  await fs.cp(importedRoot, workspace, { recursive: true });

  const opfRel = preserveMeta.opfPath.replace(/\\/g, '/');
  const opfAbs = path.join(workspace, opfRel);
  const opfDirRel = path.posix.dirname(opfRel);
  const opfDirAbs = path.dirname(opfAbs);

  const smilDirAbs = path.join(opfDirAbs, 'smil');
  const audioDirAbs = path.join(opfDirAbs, 'audio');
  await fs.mkdir(smilDirAbs, { recursive: true });
  await fs.mkdir(audioDirAbs, { recursive: true });

  /** @type {Array<{ pageNum: number, manifestId: string, smilRelToOpf: string, audioRelToOpf: string, duration: number, smilItemId: string, audioItemId: string }>} */
  const overlayPages = [];

  const spine = preserveMeta.spine || [];
  let totalDuration = 0;

  if (!sharedGlobalAudio) {
    for (const spineRow of spine) {
      const pp = await resolvePerPageHumanAudioPath(humanAudioDir, spineRow.pageNumber);
      if (!pp) {
        throw new Error(
          `Preserve-import export needs human_audio/page_${spineRow.pageNumber}.mp3 (or .wav/.m4a) for each page, or a single-book file in human_audio (narration.mp3, full.mp3, audio.mp3, or book.mp3).`
        );
      }
    }
  }

  const copiedAudioBasenames = new Set();

  for (const spineRow of spine) {
    const pageNum = spineRow.pageNumber;
    const page = pagesData.find((p) => (p.pageNumber || 0) === pageNum) || {};
    let pageZones = page.zones || [];
    const textZones = pageZones
      .filter((z) => z.type === 'text' || z.content)
      .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));

    let frags = [];
    for (const z of textZones) {
      const row = findAlignmentForZone(z, textZones);
      if (row && row.startTime != null && row.endTime != null) {
        frags.push({
          id: String(z.id),
          startTime: Number(row.startTime),
          endTime: Number(row.endTime)
        });
      }
    }
    // Keep saved times as-is (Sync Studio manual edits); only ensure end > start for valid SMIL.
    frags = frags.map((f) => {
      const st = Number(f.startTime) || 0;
      let en = Number(f.endTime) ?? st;
      if (!Number.isFinite(en) || en <= st) en = st + 0.001;
      return { id: f.id, startTime: st, endTime: en };
    });

    if (frags.length === 0) {
      console.warn(`[KitabooFXL Preserve] Page ${pageNum}: no alignment rows for zone ids; skipping SMIL for this page.`);
      continue;
    }

    const pageDur = frags.length ? Math.max(...frags.map((f) => f.endTime)) : 0;
    totalDuration += pageDur;

    const smilName = `page${pageNum}.smil`;
    const smilAbs = path.join(smilDirAbs, smilName);
    const smilRelToOpf = path.posix.join('smil', smilName);

    const xhtmlAbs = path.join(workspace, spineRow.xhtmlPathFromEpubRoot.replace(/\\/g, '/'));
    const xhtmlSrcForSmil = path
      .relative(path.dirname(smilAbs), xhtmlAbs)
      .split(path.sep)
      .join('/');

    const perPagePath = await resolvePerPageHumanAudioPath(humanAudioDir, pageNum);
    let srcAudioAbs;
    let audioFileBase;
    let usedPerPageFile = false;
    if (perPagePath) {
      srcAudioAbs = perPagePath;
      audioFileBase = path.basename(perPagePath);
      usedPerPageFile = true;
    } else {
      srcAudioAbs = sharedGlobalAudio;
      audioFileBase = path.basename(sharedGlobalAudio);
    }

    const destAudioAbs = path.join(audioDirAbs, audioFileBase);
    if (!copiedAudioBasenames.has(audioFileBase)) {
      await fs.copyFile(srcAudioAbs, destAudioAbs);
      copiedAudioBasenames.add(audioFileBase);
    }
    if (usedPerPageFile && /^page_\d+\.mp3$/i.test(audioFileBase)) {
      await fs.unlink(path.join(audioDirAbs, `page${pageNum}.mp3`)).catch(() => {});
    }

    const audioSrcForSmil = path
      .relative(path.dirname(smilAbs), destAudioAbs)
      .split(path.sep)
      .join('/');

    const smilContent = EpubGenerator.generateFxlSmil(
      {
        xhtmlFileName: xhtmlSrcForSmil,
        audioFileName: audioSrcForSmil,
        jobId,
        pageNum
      },
      frags,
      { minDurationSec: 0.001, preserveExactTimes: true }
    );
    // Imported packages (or a prior export) may have left pageN.smil next to the OPF; we publish under smil/ only.
    await fs.unlink(path.join(opfDirAbs, smilName)).catch(() => {});
    await fs.writeFile(smilAbs, smilContent, 'utf8');

    const smilItemId = `smil_overlay_${pageNum}`;
    const audioItemId = usedPerPageFile ? `audio_overlay_${pageNum}` : 'audio_overlay_book';
    overlayPages.push({
      pageNum,
      manifestId: spineRow.manifestId,
      smilRelToOpf,
      audioRelToOpf: path.posix.join('audio', audioFileBase),
      duration: pageDur,
      smilItemId,
      audioItemId
    });
  }

  if (overlayPages.length === 0) {
    throw new Error('No SMIL pages produced. Check that alignment.json ids match zone ids in the imported EPUB.');
  }

  let opfXml = await fs.readFile(opfAbs, 'utf8');
  opfXml = mergeMediaOverlayIntoOpf(opfXml, {
    overlayPages,
    bookDurationSec: totalDuration
  });
  await fs.writeFile(opfAbs, opfXml, 'utf8');
  await removeUnreferencedRootSmilAtOpf(opfDirAbs, opfXml);

  const epubFileName = `fxl_${jobId}.epub`;
  const finalPath = path.join(outputDir, epubFileName);
  await zipEpubFromWorkspace(workspace, finalPath);

  const checkResult = await KitabooFxlService.checkGeneratedEpub(finalPath);
  if (checkResult.ok) {
    console.log(
      `[KitabooFXL] Preserve-import EPUB assembled at ${finalPath} (${overlayPages.length} SMIL overlays, original XHTML kept). Validation: ${checkResult.pages} XHTML, ${checkResult.smilCount} SMIL, ${checkResult.audioCount} audio.`
    );
  } else {
    console.warn(`[KitabooFXL] Preserve-import EPUB written at ${finalPath} but validation reported: ${checkResult.error}`);
  }
  return finalPath;
}

/**
 * Delete OPF-directory `pageN.smil` files that are not listed in the manifest (leftover from imported_package/).
 */
async function removeUnreferencedRootSmilAtOpf(opfDirAbs, opfXml) {
  const dom = new JSDOM(opfXml, { contentType: 'application/xml' });
  const manifest = dom.window.document.querySelector('manifest');
  if (!manifest) return;
  const referencedBasenames = new Set();
  for (const item of [...manifest.querySelectorAll('item')]) {
    const href = (item.getAttribute('href') || '').replace(/\\/g, '/').trim();
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    if (!mt.includes('smil') && !href.toLowerCase().endsWith('.smil')) continue;
    const dir = path.posix.dirname(href);
    if (dir !== '.' && dir !== '') continue;
    referencedBasenames.add(path.posix.basename(href));
  }
  let entries;
  try {
    entries = await fs.readdir(opfDirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !/^page\d+\.smil$/i.test(ent.name)) continue;
    if (!referencedBasenames.has(ent.name)) {
      await fs.unlink(path.join(opfDirAbs, ent.name)).catch(() => {});
    }
  }
}

/**
 * Insert manifest items and media-overlay on spine itemrefs. Best-effort XML string patch.
 */
function mergeMediaOverlayIntoOpf(opfXml, { overlayPages, bookDurationSec }) {
  const dom = new JSDOM(opfXml, { contentType: 'application/xml' });
  const doc = dom.window.document;
  const m = doc.querySelector('manifest') || doc.getElementsByTagName('manifest')[0];
  const s = doc.querySelector('spine') || doc.getElementsByTagName('spine')[0];
  const md = doc.querySelector('metadata') || doc.getElementsByTagName('metadata')[0];
  if (!m || !s) {
    throw new Error('OPF has no manifest or spine; cannot merge media overlay.');
  }

  // Remove prior manifest entries for our smil/pageN.smil paths so we do not duplicate hrefs; readers may otherwise keep old SMIL.
  const smilHrefsToReplace = new Set(
    overlayPages.map((p) => {
      const name = `smil/page${p.pageNum}.smil`;
      return name.replace(/\\/g, '/');
    })
  );
  const manifestItems = [...m.querySelectorAll('item')];
  for (const item of manifestItems) {
    const href = (item.getAttribute('href') || '').replace(/\\/g, '/').trim();
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    const isSmil = mt.includes('smil') || href.endsWith('.smil');
    if (!isSmil) continue;
    for (const want of smilHrefsToReplace) {
      if (href === want || href.endsWith('/' + want)) {
        item.remove();
        break;
      }
    }
  }

  // Drop root-level pageN.smil manifest rows (same folder as OPF) when we replace with smil/pageN.smil — avoids two SMIL copies in the zip.
  const overlayPageNums = new Set(overlayPages.map((p) => p.pageNum));
  for (const item of [...m.querySelectorAll('item')]) {
    const href = (item.getAttribute('href') || '').replace(/\\/g, '/').trim();
    const mt = (item.getAttribute('media-type') || '').toLowerCase();
    const isSmil = mt.includes('smil') || href.endsWith('.smil');
    if (!isSmil) continue;
    if (href.includes('smil/')) continue;
    const base = path.posix.basename(href);
    const numMatch = /^page(\d+)\.smil$/i.exec(base);
    if (!numMatch) continue;
    const n = parseInt(numMatch[1], 10);
    if (overlayPageNums.has(n)) item.remove();
  }

  // Remove our overlay ids from a previous export so manifest ids stay unique.
  for (const p of overlayPages) {
    const oldSmil = m.querySelector(`item[id="smil_overlay_${p.pageNum}"]`);
    if (oldSmil) oldSmil.remove();
  }
  const oldBookAudio = m.querySelector('item[id="audio_overlay_book"]');
  if (oldBookAudio) oldBookAudio.remove();
  for (const p of overlayPages) {
    if (p.audioItemId && p.audioItemId.startsWith('audio_overlay_') && p.audioItemId !== 'audio_overlay_book') {
      const oldA = m.querySelector(`item[id="${p.audioItemId}"]`);
      if (oldA) oldA.remove();
    }
  }

  // Legacy ids from pre-preserve exports (smil5, audio5 → audio/page5.mp3) conflict with smil_overlay_5 + audio/page_5.mp3.
  for (const p of overlayPages) {
    const n = p.pageNum;
    const legSmil = m.querySelector(`item[id="smil${n}"]`);
    if (legSmil) legSmil.remove();
    const legAudio = m.querySelector(`item[id="audio${n}"]`);
    if (legAudio) legAudio.remove();
  }

  // Stale duration rows pointing at #smil5 (no such id) or old #smil_overlay_* before re-append.
  if (md) {
    for (const el of [...md.querySelectorAll('meta')]) {
      const prop = el.getAttribute('property') || '';
      const ref = el.getAttribute('refines') || '';
      if (prop !== 'media:duration' || !ref) continue;
      if (/^#smil\d+$/.test(ref) || /^#smil_overlay_\d+$/.test(ref)) el.remove();
    }
  }

  const itemrefs = [...s.querySelectorAll('itemref')];
  for (const ir of itemrefs) {
    ir.removeAttribute('media-overlay');
  }

  const seenAudioIds = new Set();
  for (const p of overlayPages) {
    const smilItem = doc.createElement('item');
    smilItem.setAttribute('id', p.smilItemId);
    smilItem.setAttribute('href', p.smilRelToOpf);
    smilItem.setAttribute('media-type', 'application/smil+xml');
    m.appendChild(smilItem);

    if (!seenAudioIds.has(p.audioItemId)) {
      seenAudioIds.add(p.audioItemId);
      const audioItem = doc.createElement('item');
      audioItem.setAttribute('id', p.audioItemId);
      audioItem.setAttribute('href', p.audioRelToOpf);
      audioItem.setAttribute('media-type', 'audio/mpeg');
      m.appendChild(audioItem);
    }
  }

  // EPUB 3 Media Overlays: each overlaid XHTML manifest item MUST reference the SMIL item (same as full assembleFxlEpub).
  for (const p of overlayPages) {
    const xhtmlItem = m.querySelector(`item[id="${p.manifestId}"]`);
    if (!xhtmlItem) continue;
    const mt = (xhtmlItem.getAttribute('media-type') || '').toLowerCase();
    if (!mt.includes('html')) continue;
    xhtmlItem.setAttribute('media-overlay', p.smilItemId);
    const props = (xhtmlItem.getAttribute('properties') || '').trim();
    const tokens = new Set(props.split(/\s+/).filter(Boolean));
    tokens.add('media-overlay');
    xhtmlItem.setAttribute('properties', [...tokens].join(' '));
  }

  for (const ir of itemrefs) {
    const idref = ir.getAttribute('idref');
    const hit = overlayPages.find((p) => p.manifestId === idref);
    if (hit) {
      ir.setAttribute('media-overlay', hit.smilItemId);
    }
  }

  if (md) {
    for (const p of overlayPages) {
      const meta = doc.createElement('meta');
      meta.setAttribute('property', 'media:duration');
      meta.setAttribute('refines', `#${p.smilItemId}`);
      meta.textContent = `${Number(p.duration || 0).toFixed(3)}s`;
      md.appendChild(meta);
    }
  }

  if (md) {
    const hasDur = [...md.getElementsByTagName('meta')].some(
      (el) => (el.getAttribute('property') || '') === 'media:duration' && !el.getAttribute('refines')
    );
    if (!hasDur) {
      const meta = doc.createElement('meta');
      meta.setAttribute('property', 'media:duration');
      meta.textContent = `${Number(bookDurationSec || 0).toFixed(3)}s`;
      md.appendChild(meta);
    }
    const hasActive = [...md.querySelectorAll('meta')].some(
      (el) => (el.getAttribute('property') || '') === 'media:active-class'
    );
    if (!hasActive) {
      const active = doc.createElement('meta');
      active.setAttribute('property', 'media:active-class');
      active.textContent = '-epub-media-overlay-active';
      md.appendChild(active);
    }
  }

  const ser = new dom.window.XMLSerializer();
  let out = ser.serializeToString(doc);
  if (!out.trim().startsWith('<?xml')) {
    out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
  }
  return out;
}

async function zipEpubFromWorkspace(workspace, finalPath) {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const mimetypePath = path.join(workspace, 'mimetype');
  const metaInf = path.join(workspace, 'META-INF');
  const hasMimetype = await fs
    .access(mimetypePath)
    .then(() => true)
    .catch(() => false);
  const hasMetaInf = await fs
    .access(metaInf)
    .then(() => true)
    .catch(() => false);

  const entries = await fs.readdir(workspace);
  const skip = new Set(['mimetype', 'META-INF']);

  await new Promise((resolve, reject) => {
    const output = createWriteStream(finalPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);

    if (hasMimetype) {
      archive.file(mimetypePath, { name: 'mimetype', store: true });
    }
    if (hasMetaInf) {
      archive.directory(metaInf, 'META-INF');
    }

    for (const name of entries) {
      if (skip.has(name)) continue;
      archive.directory(path.join(workspace, name), name);
    }
    archive.finalize();
  });
}
