import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import pdfParse from 'pdf-parse';
import { PdfExtractionService } from './pdfExtractionService.js';
import { GeminiService } from './geminiService.js';
import { getHtmlIntermediateDir, getEpubOutputDir } from '../config/fileStorage.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';
import { v4 as uuidv4 } from 'uuid';

import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import ttf2woff2 from 'ttf2woff2';

import { EpubGenerator } from '../utils/epubGenerator.js';
import { sanitizeZoneText } from '../utils/zoneTextSanitizer.js';

// Scale to match current render (PdfExtractionService.renderPagesAsImages uses 200 DPI)
const LAYOUT_PIXELS_PER_POINT = 200 / 72;
import { getPageBoundaries, getProportionalBoundaries, extractAudioSlice, splitAudioByPageBoundaries } from '../utils/audioSplitter.js';
import { TtsService } from './TtsService.js';
import { aeneasService } from './aeneasService.js';
import { whisperAlignmentService } from './whisperAlignmentService.js';
import { sileroVadService } from './sileroVadService.js';
import mfaService from './mfaService.js';

/**
 * Kitaboo-style Fixed Layout (FXL) Service
 * Implements a 100% automated engine for pixel-perfect EPUB 3 conversion.
 *
 * =============================================================================
 * THE "KITABOO SECRET" — Post-Processing and Mapping Layer
 * =============================================================================
 * Solves the "Human Narration Paradox": humans don't speak like machines,
 * but EPUB readers expect machine-like precision.
 *
 * 1. Sliding Window Scoring (aeneasService.mapFragmentsToIds)
 *    Expected timestamp from position; search limited to +/- 5 segments.
 *    Prevents "jump-ahead" when the same word appears many times.
 *
 * 2. Silence Snapping (aeneasService.refineWithZeroCrossing / snapToNearestSilence)
 *    -35dB detection; snap sentence end to start of next silence.
 *
 * 3. Weighted Word Propagation (aeneasService.propagateWordTimings)
 *    Min duration for short words; punctuation padding; weighted character counts.
 *
 * 4. Fragment Multi-Line Logic (splitZonesBySyncLevel / expandZonesToSentenceLevel)
 *    Line-based fragments so highlight follows text line-by-line in FXL.
 *
 * 5. CBR Normalization (aeneasService.normalizeAudio)
 *    VBR → CBR WAV 16kHz before alignment to fix HTML5 duration drift.
 *
 * 6. Audio–Page Association (Global Offset Mapping)
 *    When one long audio is used for the whole book: run alignment ONCE on full
 *    audio + ALL book text; map results back to pages by zone id (p1_, p2_, ...).
 *    Never run Aeneas page-by-page with full-book audio + one page's text (would
 *    stretch highlights to fill the whole file — "duration stretching").
 *
 * =============================================================================
 * GLOBAL ALIGNMENT STRATEGY (Phases 1–4)
 * =============================================================================
 * Phase 1 — Global Text Aggregation: Build combinedSegments from all pages'
 *    textZones (id + text); one "master" list in reading order.
 * Phase 2 — Single-Pass Aeneas: Run alignPlainSegments(fullAudio, combinedSegments)
 *    once; aba_no_zero=True and aba_percent_value=0.5 to avoid ghost segments.
 * Phase 3 — Refinement: Silence snapping (snapToNearestSilence) on full narration
 *    so highlight end snaps to start of next silence (-35dB); applied in
 *    aeneasService.refinePlainSegmentResults after alignment.
 * Phase 4 — Page-Level Distribution: Filter results by getPageNumFromZoneId(p1_,
 *    p2_, ...); generate one SMIL per page with clipBegin/clipEnd from master
 *    timestamps; same narration.mp3 for all pages (offset secret).
 */
export class KitabooFxlService {
  static _fontMappingCache = {};

  static isWoff2ConvertibleFont(filename = '') {
    const lower = String(filename).toLowerCase();
    return lower.endsWith('.ttf') || lower.endsWith('.otf');
  }

  static getWoff2FileName(filename = '') {
    if (!filename) return null;
    const idx = String(filename).lastIndexOf('.');
    if (idx <= 0) return null;
    return `${String(filename).slice(0, idx)}.woff2`;
  }

  static async writeWoff2IfPossible(srcBuffer, destPath, fontFileName) {
    if (!KitabooFxlService.isWoff2ConvertibleFont(fontFileName)) return false;
    try {
      const out = ttf2woff2(srcBuffer);
      await fs.writeFile(destPath, out);
      return true;
    } catch (e) {
      console.warn(`[KitabooFXL] WOFF2 conversion failed for ${fontFileName}: ${e.message}`);
      return false;
    }
  }

  /**
   * Safely parse a JSON object from a Gemini response string.
   * Handles code fences, extra text, and trailing characters after the JSON.
   * Returns null if parsing fails.
   * @param {string} raw
   * @returns {any|null}
   */
  static safeParseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let s = raw.trim();
    // Strip common markdown fences like ```json ... ``` or ``` ... ```
    if (s.startsWith('```')) {
      s = s.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    }
    // Find first balanced { ... } block, respecting strings/escapes
    let depth = 0;
    let start = -1;
    let end = -1;
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (start === -1 || end === -1) return null;
    const slice = s.slice(start, end);
    try {
      return JSON.parse(slice);
    } catch (e) {
      // Second-chance: strip trailing commas before } or ] which Gemini sometimes emits.
      try {
        const cleaned = slice.replace(/,\s*(?=[}\]])/g, '');
        return JSON.parse(cleaned);
      } catch (e2) {
        console.warn('[KitabooFXL] safeParseJsonObject failed:', e2.message, slice.slice(0, 200));
        return null;
      }
    }
  }

  /**
   * Fix abbreviation corruption from PDF duplicate layers / word boundaries: Ph.DD. -> Ph.D., M.AA. -> M.A., etc.
   * @param {string} text
   * @returns {string}
   */
  static normalizeAbbreviationCorruption(text) {
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

  /**
   * Fix common last-glyph truncations seen in some PDF text layers (e.g. "Directo" -> "Director").
   * This is intentionally surgical (only known credit-role words) to avoid changing valid words.
   * @param {string} text
   * @returns {string}
   */
  static normalizeCommonTruncations(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\bEditorial Directo\b/g, 'Editorial Director')
      .replace(/\bProduction Directo\b/g, 'Production Director')
      .replace(/\bCreative Directo\b/g, 'Creative Director')
      .replace(/\bPhoto Edito\b/g, 'Photo Editor')
      .replace(/\bPublishe\b/g, 'Publisher');
  }

  /** Convert bbox (x, y, w, h) to polygon points [[x,y], [x+w,y], [x+w,y+h], [x,y+h]]. Used so all zones are stored as polygons. */
  static bboxToPoints(x, y, w, h) {
    const x0 = Number(x) || 0;
    const y0 = Number(y) || 0;
    const ww = Number(w) || 1;
    const hh = Number(h) || 1;
    return [[x0, y0], [x0 + ww, y0], [x0 + ww, y0 + hh], [x0, y0 + hh]];
  }

  /**
   * Build polygon points that hug the text block (exclude gap between line ends and starts).
   * Traces: top of first line → right side (step at each line) → bottom of last line → left side back to start.
   * @param {Array<{bbox?: number[], origin?: number[], text?: string}>} lines
   * @param {{ defaultW?: number, defaultH?: number }} [opts]
   * @returns {number[][]} points [[x,y], ...] or null
   */
  static linesToOutlinePoints(lines, opts = {}) {
    const defaultW = opts.defaultW || 50;
    const defaultH = opts.defaultH || 14;
    const paddingLeft = Number(opts.paddingLeft) || 0;
    const paddingTop = Number(opts.paddingTop) || 0;
    if (!lines || lines.length === 0) return null;
    const getBounds = (ln) => {
      if (ln.bbox && ln.bbox.length >= 4) {
        return { left: ln.bbox[0], top: ln.bbox[1], right: ln.bbox[2], bottom: ln.bbox[3] };
      }
      const ox = Number(ln.origin?.[0]) || 0;
      const oy = Number(ln.origin?.[1]) || 0;
      return { left: ox, top: oy, right: ox + defaultW, bottom: oy + defaultH };
    };
    if (lines.length === 1) {
      const b = getBounds(lines[0]);
      return KitabooFxlService.bboxToPoints(b.left - paddingLeft, b.top - paddingTop, (b.right - b.left) + paddingLeft, (b.bottom - b.top) + paddingTop);
    }
    const pts = [];
    const b = lines.map(ln => getBounds(ln));
    // Top edge: first line left (minus padding so "P" isn't cut) → first line right
    pts.push([b[0].left - paddingLeft, b[0].top - paddingTop]);
    pts.push([b[0].right, b[0].top - paddingTop]);
    pts.push([b[0].right, b[0].bottom]);
    // Right side: step down at each line (so we don't include gap to next line's start)
    for (let i = 1; i < b.length; i++) {
      pts.push([b[i].right, b[i].top]);
      pts.push([b[i].right, b[i].bottom]);
    }
    // Bottom-left: last line right → last line left (with left padding)
    pts.push([b[b.length - 1].left - paddingLeft, b[b.length - 1].bottom]);
    pts.push([b[b.length - 1].left - paddingLeft, b[b.length - 1].top]);
    // Left side: back up to first line top (exclude gap between lines)
    for (let i = b.length - 2; i >= 0; i--) {
      pts.push([b[i].left - paddingLeft, b[i].top]);
    }
    return pts;
  }

  /**
   * Process a PDF document through the Kitaboo FXL workflow
   * @param {string} jobId - The conversion job ID
   * @param {string} pdfPath - Path to the PDF file
   * @param {number} pdfId - The PDF document ID
   * @returns {Promise<Object>} Results of the conversion
   */
  /**
   * Get PDF page count (lightweight, no rendering). Used to skip Phase 1 when WebP cache is valid.
   */
  static async getPdfPageCount(pdfPath) {
    const pdfData = await fs.readFile(pdfPath);
    const result = await pdfParse(pdfData);
    return result.numpages || 0;
  }

  /**
   * Load existing WebP assets from disk (dimensions via sharp). Used when skipping Phase 1.
   */
  static async loadExistingWebpAssets(webpDir) {
    const files = await fs.readdir(webpDir);
    const webpFiles = files.filter(f => f.endsWith('.webp'));
    webpFiles.sort((a, b) => {
      const na = parseInt(a.match(/page_?(\d+)/i)?.[1] || '0', 10);
      const nb = parseInt(b.match(/page_?(\d+)/i)?.[1] || '0', 10);
      return na - nb;
    });
    const assets = [];
    for (const fileName of webpFiles) {
      const webpPath = path.join(webpDir, fileName);
      const metadata = await sharp(webpPath).metadata();
      assets.push({
        path: webpPath,
        fileName,
        dimensions: { width: metadata.width || 0, height: metadata.height || 0 }
      });
    }
    return assets;
  }

  /**
   * @param {string} jobId
   * @param {string} pdfPath
   * @param {string|number} pdfId
   * @param {(progress: number, currentStep: string) => void} [onProgress] - optional progress callback (0-100, step label)
   */
  static async processPdf(jobId, pdfPath, pdfId, onProgress) {
    const report = (p, step) => { if (typeof onProgress === 'function') onProgress(p, step); };
    console.log(`[KitabooFXL] Starting FXL workflow for PDF ${pdfId} (Job ${jobId})`);

    report(0, 'Starting...');
    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const webpDir = path.join(intermediateDir, 'webp');
    await fs.mkdir(webpDir, { recursive: true });

    let normalizedAssets;
    try {
      report(5, 'Checking WebP cache...');
      const pdfPageCount = await this.getPdfPageCount(pdfPath);
      const existingWebps = await fs.readdir(webpDir).catch(() => []);
      const webpFiles = existingWebps.filter(f => f.endsWith('.webp'));
      webpFiles.sort((a, b) => {
        const na = parseInt(a.match(/page_?(\d+)/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/page_?(\d+)/i)?.[1] || '0', 10);
        return na - nb;
      });
      if (pdfPageCount > 0 && webpFiles.length === pdfPageCount) {
        console.log(`[KitabooFXL] Reusing existing WebP cache (${webpFiles.length} pages) — skipping Phase 1`);
        normalizedAssets = await this.loadExistingWebpAssets(webpDir);
      } else {
        throw new Error('Cache miss or page count mismatch');
      }
    } catch {
      // PHASE 1: High-Fidelity Ingestion (Normalization to 300 DPI WebP)
      report(5, 'Phase 1: Rendering PDF...');
      console.log(`[KitabooFXL] Phase 1: Normalizing PDF to 300 DPI WebP`);
      normalizedAssets = await this.normalizeToWebP(pdfPath, webpDir, report);
    }

    report(90, 'Phase 2: Automated zoning...');
    const existingZones = await KitabooZoneModel.getZonesByJobId(jobId);
    let finalZones = [];

    if (Object.keys(existingZones).length > 0) {
      console.log(`[KitabooFXL] Found existing zones in database for job ${jobId}`);
      finalZones = normalizedAssets.map((_, index) => existingZones[index + 1] || []);
    } else {
      console.log(`[KitabooFXL] Phase 2: Automated Zoning via Gemini`);
      finalZones = await this.performAutomatedZoning(normalizedAssets, jobId);
      for (let i = 0; i < finalZones.length; i++) {
        await KitabooZoneModel.saveZonesForJob(jobId, pdfId, i + 1, finalZones[i]);
      }
    }

    report(100, 'Complete');
    return {
      jobId,
      pages: normalizedAssets.map((asset, index) => ({
        pageNumber: index + 1,
        imagePath: `/backend/html_intermediate/kitaboo_${jobId}/webp/${asset.fileName}`,
        dimensions: asset.dimensions,
        zones: finalZones[index] || []
      }))
    };
  }

  /**
   * Layout-only pipeline (classic PDF→FXL): no AI zoning, no semantic zones.
   * Phase 1: Render PDF to WebP (same as processPdf).
   * Phase 2: Extract layout fragments from PDF text engine (block→line→span bbox).
   * Use for output that matches attached EPUB: background image + positioned divs + CSS coordinate classes.
   * @param {string} jobId
   * @param {string} pdfPath
   * @param {string|number} pdfId
   * @param {(progress: number, step: string) => void} [onProgress]
   * @returns {Promise<{ jobId: string, pages: Array<{ pageNumber: number, imagePath: string, dimensions: { width, height }, layoutFragments: Array }> }>}
   */
  static async processPdfLayoutOnly(jobId, pdfPath, pdfId, onProgress) {
    const report = (p, step) => { if (typeof onProgress === 'function') onProgress(p, step); };
    console.log(`[KitabooFXL] Starting layout-only (classic FXL) workflow for PDF ${pdfId} (Job ${jobId})`);

    report(0, 'Starting...');
    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const webpDir = path.join(intermediateDir, 'webp');
    await fs.mkdir(webpDir, { recursive: true });

    let normalizedAssets;
    try {
      report(5, 'Checking WebP cache...');
      const pdfPageCount = await this.getPdfPageCount(pdfPath);
      const existingWebps = await fs.readdir(webpDir).catch(() => []);
      const webpFiles = existingWebps.filter(f => f.endsWith('.webp')).sort((a, b) => {
        const na = parseInt(a.match(/page_?(\d+)/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/page_?(\d+)/i)?.[1] || '0', 10);
        return na - nb;
      });
      if (pdfPageCount > 0 && webpFiles.length === pdfPageCount) {
        normalizedAssets = await this.loadExistingWebpAssets(webpDir);
      } else {
        throw new Error('Cache miss');
      }
    } catch {
      report(5, 'Phase 1: Rendering PDF...');
      normalizedAssets = await this.normalizeToWebP(pdfPath, webpDir, report);
    }

    report(50, 'Phase 2: Extracting layout fragments from PDF...');
    const layoutResult = await PdfExtractionService.extractLayoutFragments(pdfPath, {
      fragmentLevel: 'span',
      scalePixelsPerPoint: LAYOUT_PIXELS_PER_POINT
    });

    const layoutByPage = Object.fromEntries((layoutResult.pages || []).map(p => [p.pageNumber, p]));
    const pages = normalizedAssets.map((asset, index) => {
      const pageNum = index + 1;
      const layoutPage = layoutByPage[pageNum] || {};
      return {
        pageNumber: pageNum,
        imagePath: `/backend/html_intermediate/kitaboo_${jobId}/webp/${asset.fileName}`,
        dimensions: asset.dimensions,
        layoutFragments: layoutPage.fragments || []
      };
    });

    const layoutSavePath = path.join(intermediateDir, 'layout_fragments.json');
    await fs.writeFile(layoutSavePath, JSON.stringify({ pages: layoutResult.pages }, null, 2), 'utf8').catch(() => { });

    report(100, 'Complete');
    return { jobId, pages };
  }

  /**
   * High-Fidelity: Use inpainting only — clean (text-removed) background + drawn text overlay.
   * When true: use page_N_clean.png and draw text on top (opaque); no original image.
   */
  static shouldUseCleanImage(pageNumber, items) {
    return true; // Use inpainting only (clean image + text layer)
  }

  /**
   * High-Fidelity Pipeline (PyMuPDF + OpenCV + FXL)
   * Implements the requested 3-Phase workflow:
   * Phase 1: Render (PyMuPDF/Poppler) & Background Preparation
   * Phase 2: Coordinate Extraction & Text Removal (Inpainting)
   * Phase 3: Returns data for FXL reconstruction
   */
  /**
   * @param {string} jobId
   * @param {string} pdfPath
   * @param {number} pdfId
   * @param {(p: number, step: string) => void} onProgress
   * @param {{ zoneLevel?: 'word'|'sentence', tocEndPage?: number }} [options] - zone granularity; tocEndPage = last TOC page (1-based) for sentence-level rectangle zones when auto-detect fails
   */
  static async processPdfHighFidelity(jobId, pdfPath, pdfId, onProgress, options = {}) {
    const report = (p, step) => { if (typeof onProgress === 'function') onProgress(p, step); };
    const extractionLevel = 'glyph'; // Always glyph for highest fidelity; zones built from zoneLevel
    const zoneLevel = (options.zoneLevel === 'sentence') ? 'sentence' : 'word';
    console.log(`[KitabooFXL] Starting High-Fidelity workflow for PDF ${pdfId} (Job ${jobId}), extraction: glyph, zone level: ${zoneLevel}`);

    // Create output directory
    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const renderedDir = path.join(intermediateDir, 'high_fidelity_render');
    await fs.mkdir(renderedDir, { recursive: true });

    // Phase 1: Render
    report(10, 'Phase 1: High-Fidelity Rendering (300 DPI)...');
    // Use 300 DPI as requested for high quality
    const renderResult = await PdfExtractionService.renderPagesHighFidelity(pdfPath, renderedDir, 300);

    // Phase 2a: Coordinate Extraction (PyMuPDF) — always glyph level for exact positions
    report(40, 'Phase 2: Extracting Coordinates (glyph)...');
    const coordsResult = await PdfExtractionService.extractCoordinatesHighFidelity(pdfPath, renderedDir, { extractionLevel });

    // Phase 2b: Text Removal (Cleanup)
    report(60, 'Phase 2b: Image Cleanup (Inpainting)...');
    const cleanupSuccess = await PdfExtractionService.cleanupImagesHighFidelity(pdfPath, renderedDir, path.join(renderedDir, 'coords.json'));

    report(90, 'Phase 3: Structuring Data...');

    if (!coordsResult || coordsResult.length === 0) {
      console.warn('[KitabooFXL] No coordinate data from extraction; zone building will produce no zones.');
    }

    // Use Gemini to classify page types (cover, back, toc, chapter title, regular) so we can
    // apply cover-style word grouping and other special rules without hardcoding page numbers.
    const pageTypeByNumber = {};
    if (process.env.GEMINI_API_KEY) {
      try {
        for (const img of renderResult.images) {
          try {
            const imageBase64 = (await fs.readFile(img.path)).toString('base64');
            const prompt = `You are analyzing a single page image from a children's non-fiction PDF book.
Classify the VISUAL ROLE of this page into ONE of exactly these values:
- "cover" (front cover with big hero title)
- "back" (back cover)
- "toc" (table of contents)
- "chapterTitle" (chapter opener page with large chapter heading and mostly decorative content)
- "regular" (any normal content page).

Return ONLY a JSON object of the form: {"pageType":"cover"} with one of the values above. Page number: ${img.pageNumber}.`;

            const response = await GeminiService.generateContent([
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: imageBase64 } }
            ], { modelName: 'gemini-2.0-flash', priority: 'low' });

            const parsed = KitabooFxlService.safeParseJsonObject(response);
            const pt = (parsed && typeof parsed.pageType === 'string') ? parsed.pageType.trim() : '';
            if (pt) {
              pageTypeByNumber[img.pageNumber] = pt;
            }
          } catch (perPageErr) {
            console.warn(`[KitabooFXL] Gemini page-type classification failed for page ${img.pageNumber}:`, perPageErr.message);
          }
        }
      } catch (err) {
        console.warn('[KitabooFXL] Gemini page-type classification skipped:', err.message);
      }
    }

    // Fallback: if Gemini did not classify anything, treat page 1 as cover; others as regular.
    if (Object.keys(pageTypeByNumber).length === 0 && renderResult.images.length > 0) {
      pageTypeByNumber[1] = 'cover';
    }

    // Detect last TOC page: up to and including TOC → one zone per line (like copyright/credits/TOC); after TOC → sentence-level.
    // IMPORTANT: For glyph extraction (visual glyph replay + logical word/sentence grouping), we *do not* apply TOC special-casing.
    // Glyph jobs should keep true word-level zones even on TOC/credits pages so every logical word has its own zone.
    const tocEndPageDetected = (() => {
      let last = 0;
      for (const p of coordsResult || []) {
        const items = p.items || [];
        const pageText = items.map(it => (it.text || '').trim()).join(' ');
        const hasTocTitle = items.some(it => /^Table\s+of\s+Contents$/i.test((it.text || '').trim()) || /^Contents$/i.test((it.text || '').trim()));
        const hasTocLikeContent = pageText.length < 600 && /\b(Table\s+of\s+Contents|Contents)\b/i.test(pageText);
        if (hasTocTitle || hasTocLikeContent) {
          last = Math.max(last, p.page || 0);
        }
      }
      return last;
    })();
    // Sentence-level hi-fi: pages before and including TOC use rectangle zones and no sentence-level rules (one zone per line).
    // Word-level / non-sentence: for glyph extraction, disable TOC special handling.
    // When options.tocEndPage is set (e.g. when auto-detect fails), use it for sentence-level so user can force TOC range.
    const tocEndPage = (zoneLevel === 'sentence' && options.tocEndPage != null && options.tocEndPage > 0)
      ? Math.max(1, Math.floor(Number(options.tocEndPage)))
      : (zoneLevel === 'sentence') ? tocEndPageDetected : (extractionLevel === 'glyph' ? 0 : tocEndPageDetected);
    if (tocEndPage > 0) {
      console.log(`[KitabooFXL] TOC pages 1–${tocEndPage}: line-by-line zoning (rectangles); content pages ${tocEndPage + 1}+: sentence-level (polygons).`);
    }

    // Map coordsResult to pages format
    const pages = [];
    for (const img of renderResult.images) {
      const pageCoords = coordsResult.find(p => p.page === img.pageNumber);
      const tocPage = tocEndPage > 0 && img.pageNumber <= tocEndPage;
      const pageType = pageTypeByNumber[img.pageNumber] || (img.pageNumber === 1 ? 'cover' : 'regular');
      const isCoverStylePage = pageType === 'cover' || pageType === 'back' || pageType === 'chapterTitle';

      // Determine if we use the clean image (if cleanup succeeded and file exists)
      let useCleanImage = false;
      const cleanImgName = `page_${img.pageNumber}_clean.png`;
      const cleanImgPath = path.join(renderedDir, cleanImgName);

      if (cleanupSuccess) {
        try {
          await fs.access(cleanImgPath);
          useCleanImage = KitabooFxlService.shouldUseCleanImage(img.pageNumber, pageCoords?.items);
        } catch (e) {
          // Clean image doesn't exist, fall back to original
        }
      }

      if (useCleanImage) {
        console.log(`[KitabooFXL] Page ${img.pageNumber}: Using clean image (internal processing only).`);
      } else {
        console.log(`[KitabooFXL] Page ${img.pageNumber}: Using original image to preserve artistic integrity.`);
      }

      // STUDIO/FRONTEND: Always show the original image (img.fileName)
      // The clean image is only used during EPUB generation (assembleFxlEpub)
      const finalImgName = img.fileName;
      const finalImgPath = `/backend/html_intermediate/kitaboo_${jobId}/high_fidelity_render/${finalImgName}`;

      // Determine scale for coordinates (pts to pixels) if needed
      // PyMuPDF extraction returns pts, but image is 300 DPI
      const scaleX = pageCoords ? (img.width / pageCoords.width) : 1;
      const scaleY = pageCoords ? (img.height / pageCoords.height) : 1;

      // Convert coords to KitabooZone format (polygon: every zone has points from bbox)
      // Extraction is always glyph; group by word_id or sentence_id based on zoneLevel for Zoning Studio.
      // Cover-style pages (from Gemini pageType) use word-level grouping even when zoneLevel is 'sentence'
      // so hero titles like "Horses Up Close" have separate zones per word.
      const isCoverPage = zoneLevel === 'sentence' && isCoverStylePage;
      const useWordGroupingThisPage = isCoverPage || (zoneLevel === 'word');
      if (isCoverPage) {
        console.log(`[KitabooFXL] Page ${img.pageNumber} (${pageType}) using word-level grouping for hero titles.`);
      }
      // CRITICAL: Grouping is per-page only. sourceItems = this page's glyphs; byGroup is a new Map for this page.
      // (word_id in coords.json is scoped per page by the Python script; we never merge across pages.)
      let sourceItems = (pageCoords?.items || []);
      if (sourceItems.length === 0 && pageCoords) {
        console.warn(`[KitabooFXL] Page ${img.pageNumber}: coords have no items (empty page or extraction issue).`);
      }
      const idSuffix = zoneLevel === 'sentence' ? 's' : 'w';
      if (extractionLevel === 'glyph') {
        const groupKey = useWordGroupingThisPage ? (item) => item.word_id ?? item.wordId : (item) => item.sentence_id ?? item.sentenceId;
        const byGroup = new Map(); // New Map per page — do not move outside the page loop.
        sourceItems.forEach((item, idx) => {
          const key = groupKey(item);
          if (key == null) return;
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push({ item, idx });
        });
        const grouped = [];
        // Join glyph text with space between words (glyph extraction does not emit space chars; word_id marks boundaries).
        // Do not add a space before sentence-ending punctuation (. ? ! and full-width ．？！) so "muscles. A" stays one space, not "muscles . A".
        const isSentenceEndChar = (c) => /^[.?!．？！]$/.test((c || '').trim());
        const isSpaceChar = (c) => c === ' ' || c === '\u00A0';
        // Abbreviation: do not add space between ".", "D"/"A" etc. so "Ph." + "D" + "." stays "Ph.D." not "Ph. D ."
        const isAbbrevLetterAfterPeriod = (prevChar, ch) => /^[.?!．？！]$/.test((prevChar || '').trim()) && /^[A-Za-z]$/.test((ch || '').trim());
        const joinGlyphsWithSpaces = (glyphList) => {
          let s = '';
          let prevWordId = null;
          let prevChar = '';
          for (const g of glyphList) {
            const wid = g.word_id ?? g.wordId;
            const ch = (g.text || '').trim();
            // Add space at word boundary only when the current glyph is NOT already a space (PDF may emit space glyphs; don't double).
            // Skip space when previous word ended with .?! and current is single letter (abbreviation: Ph.D., M.A.Ed.).
            const atWordBoundary = prevWordId != null && wid != null && wid !== prevWordId;
            const noSpaceForAbbrev = atWordBoundary && isAbbrevLetterAfterPeriod(prevChar, ch);
            if (atWordBoundary && !noSpaceForAbbrev && !isSentenceEndChar(ch) && !isSpaceChar(ch)) {
              s += ' ';
            }
            s += g.text || '';
            prevWordId = wid;
            prevChar = (g.text || '').trim() || prevChar;
          }
          // Normalize all whitespace: collapse any run (spaces, tabs, PDF artifacts) to single space; trim. Prevents large gaps in FXL.
          let out = s.replace(/\s+/g, ' ').trim();
          // RCA: Fix duplicate-letter abbreviation corruption from PDF layers (Ph.DD. -> Ph.D., M.AA. -> M.A., M.AA.Ed. -> M.A.Ed.)
          out = KitabooFxlService.normalizeAbbreviationCorruption(out);
          // RCA: Fix common last-glyph truncations in some credit-role words ("Directo" -> "Director", "Publishe" -> "Publisher").
          out = KitabooFxlService.normalizeCommonTruncations(out);
          return out;
        };
        // Build grouped items in PDF stream order first; we'll optionally re-sort by Y/X for word-level later.
        [...byGroup.entries()].sort((a, b) => Math.min(...a[1].map(x => x.idx)) - Math.min(...b[1].map(x => x.idx))).forEach(([, group]) => {
          group.sort((a, b) => a.idx - b.idx);
          const glyphs = group.map(g => g.item);
          const text = joinGlyphsWithSpaces(glyphs);
          if (!text.trim()) return;
          const bboxes = glyphs.map(g => g.bbox).filter(b => Array.isArray(b) && b.length >= 4);
          if (!bboxes.length) return;
          const x0 = Math.min(...bboxes.map(b => b[0]));
          const y0 = Math.min(...bboxes.map(b => b[1]));
          const x1 = Math.max(...bboxes.map(b => b[2]));
          const y1 = Math.max(...bboxes.map(b => b[3]));
          const first = glyphs[0];
          const fontSize = first.size || 12;
          const item = {
            text,
            bbox: [x0, y0, x1, y1],
            font: first.font,
            font_file: first.font_file,
            size: fontSize,
            color: first.color,
            ascender: first.ascender,
            descender: first.descender,
            flags: first.flags,
            rotation: first.rotation,
            align: first.align
          };
          // Sentence-level: build lines from glyph y-clustering. On TOC pages: one zone per line (rectangles only); on content pages: polygons.
          // Detect new line using BOTH Y difference AND X reset (next word significantly left = new line).
          if (zoneLevel === 'sentence' && glyphs.length > 0) {
            const lineThresholdY = Math.max(fontSize * 0.4, 3);
            const xResetThreshold = fontSize * 0.5; // if next glyph's X is this much left of previous, it's a new line
            const lineGroups = [];
            glyphs.forEach((g) => {
              const b = g.bbox && g.bbox.length >= 4 ? g.bbox : [g.x, g.y, (g.x || 0) + fontSize * 0.6, (g.y || 0) + fontSize * 1.2];
              const cy = (b[1] + b[3]) / 2;
              const cxLeft = b[0];
              const last = lineGroups[lineGroups.length - 1];
              const prevLeft = last ? last.bboxes[last.bboxes.length - 1][0] : null;
              const isNewLineByX = prevLeft != null && cxLeft < prevLeft - xResetThreshold;
              const sameY = last && Math.abs(cy - last.y) <= lineThresholdY;
              const sameLine = sameY && !isNewLineByX;
              if (sameLine) {
                last.glyphs.push(g);
                last.bboxes.push(b);
              } else {
                lineGroups.push({ y: cy, glyphs: [g], bboxes: [b] });
              }
            });
            lineGroups.sort((a, b) => a.y - b.y);
            if (tocPage && lineGroups.length > 1) {
              // TOC / pre-TOC: one zone per line (rectangle boxes); sentence-level rules do not apply.
              // Use the first glyph of each line for that line's style (color/bold/italic) so TOC title and entries get correct per-line styling.
              lineGroups.forEach((lg) => {
                const bx = lg.bboxes;
                const lx0 = Math.min(...bx.map(b => b[0]));
                const ly0 = Math.min(...bx.map(b => b[1]));
                const lx1 = Math.max(...bx.map(b => b[2]));
                const ly1 = Math.max(...bx.map(b => b[3]));
                const lineText = joinGlyphsWithSpaces(lg.glyphs);
                const lineFirst = lg.glyphs[0];
                const lineFontSize = lineFirst.size || fontSize;
                grouped.push({
                  text: lineText,
                  bbox: [lx0, ly0, lx1, ly1],
                  font: lineFirst.font,
                  font_file: lineFirst.font_file,
                  size: lineFontSize,
                  color: lineFirst.color,
                  ascender: lineFirst.ascender,
                  descender: lineFirst.descender,
                  flags: lineFirst.flags,
                  rotation: lineFirst.rotation,
                  align: (lineFirst.align || first.align || 'left')
                });
              });
              return;
            }
            if (lineGroups.length > 1) {
              item.lines = lineGroups.map((lg) => {
                const bx = lg.bboxes;
                const lx0 = Math.min(...bx.map(b => b[0]));
                const ly0 = Math.min(...bx.map(b => b[1]));
                const lx1 = Math.max(...bx.map(b => b[2]));
                const ly1 = Math.max(...bx.map(b => b[3]));
                const lineText = joinGlyphsWithSpaces(lg.glyphs);
                return {
                  text: lineText,
                  bbox: [lx0, ly0, lx1, ly1],
                  origin: [lx0, ly0],
                  align: first.align || 'left'
                };
              });
            }
            // Sentence-level hi-fi: per-word styleRuns from glyphs (same fidelity as word-level SVG layer + cover/title styles).
            const wordsInText = text.split(/\s+/).filter(Boolean);
            const wordsFromGlyphs = [];
            let currWordId = null;
            let currFirst = null;
            for (const g of glyphs) {
              const wid = g.word_id ?? g.wordId;
              if (wid !== currWordId) {
                if (currFirst != null) wordsFromGlyphs.push({ firstGlyph: currFirst });
                currWordId = wid;
                currFirst = g;
              }
            }
            if (currFirst != null) wordsFromGlyphs.push({ firstGlyph: currFirst });
            if (wordsFromGlyphs.length === wordsInText.length && wordsFromGlyphs.length > 0) {
              let charOffset = 0;
              item.styleRuns = wordsInText.map((word, i) => {
                const start = charOffset;
                const end = charOffset + word.length;
                charOffset = end + 1; // +1 for space to next word
                const gf = wordsFromGlyphs[i].firstGlyph;
                return {
                  start,
                  end,
                  bold: !!((gf.flags || 0) & 2) || /bold/i.test(String(gf.font || '')),
                  italic: !!((gf.flags || 0) & 1) || /italic/i.test(String(gf.font || '')),
                  color: gf.color || '#000000'
                };
              });
            }
          }
          grouped.push(item);
        });
        // For Hi-Fi word-level (and cover when sentence-level), reading order = visual layout (top-to-bottom, left-to-right).
        if (zoneLevel === 'word' || (zoneLevel === 'sentence' && isCoverPage)) {
          grouped.sort((a, b) => {
            const ay = Array.isArray(a.bbox) && a.bbox.length >= 4 ? a.bbox[1] : 0;
            const byY = Array.isArray(b.bbox) && b.bbox.length >= 4 ? b.bbox[1] : 0;
            if (Math.abs(ay - byY) > 0.5) return ay - byY;
            const ax = Array.isArray(a.bbox) && a.bbox.length >= 4 ? a.bbox[0] : 0;
            const bx = Array.isArray(b.bbox) && b.bbox.length >= 4 ? b.bbox[0] : 0;
            return ax - bx;
          });
        }
        sourceItems = grouped;
      }

      const zones = sourceItems.map((item, i) => {
        const zone = {
          id: `p${img.pageNumber}_${idSuffix}${i}`,
          type: 'text',
          content: item.text,
          x: parseFloat((item.bbox[0] * scaleX).toFixed(3)),
          y: parseFloat((item.bbox[1] * scaleY).toFixed(3)),
          w: parseFloat(((item.bbox[2] - item.bbox[0]) * scaleX).toFixed(3)),
          h: parseFloat(((item.bbox[3] - item.bbox[1]) * scaleY).toFixed(3)),
          readingOrder: i + 1,
          fontSize: item.size ? parseFloat((item.size * scaleY).toFixed(3)) : 12,
          fontFamily: item.font || 'Arial',
          fontFile: item.font_file || null,
          color: item.color || '#000000',
          origin: item.origin ? [
            parseFloat((item.origin[0] * scaleX).toFixed(3)),
            parseFloat((item.origin[1] * scaleY).toFixed(3)),
            item.rotation || 0
          ] : null,
          bold: !!((item.flags || 0) & 2) || /bold/i.test(String(item.font || '')),
          italic: !!((item.flags || 0) & 1) || /italic/i.test(String(item.font || '')),
          ascender: item.ascender || 0.8,
          descender: item.descender || -0.2,
          textAlign: (item.align === 'right' || item.align === 'center') ? item.align : 'left'
        };
        // TOC pages: always rectangle (no polygon from item.lines). Content pages: use polygon for multi-line sentence zones.
        const pad = tocPage ? 2 : 0;
        zone.points = KitabooFxlService.bboxToPoints(zone.x, zone.y, (zone.w || 0) + pad, (zone.h || 0) + pad);
        const contentLen = (item.text || '').length;
        if (contentLen > 0) {
          if (Array.isArray(item.styleRuns) && item.styleRuns.length > 0) {
            zone.styleRuns = item.styleRuns;
          } else {
            const bold = !!((item.flags || 0) & 2) || /bold/i.test(String(item.font || ''));
            const italic = !!((item.flags || 0) & 1) || /italic/i.test(String(item.font || ''));
            zone.styleRuns = [{ start: 0, end: contentLen, bold, italic, color: item.color || '#000000' }];
          }
        }
        if (!tocPage && Array.isArray(item.lines) && item.lines.length > 1) {
          zone.lines = item.lines.map(ln => ({
            text: ln.text,
            origin: [parseFloat((ln.origin[0] * scaleX).toFixed(3)), parseFloat((ln.origin[1] * scaleY).toFixed(3))],
            bbox: ln.bbox ? [ln.bbox[0] * scaleX, ln.bbox[1] * scaleY, ln.bbox[2] * scaleX, ln.bbox[3] * scaleY] : null,
            align: (ln.align === 'right' || ln.align === 'center') ? ln.align : 'left'
          }));
          zone.points = KitabooFxlService.linesToOutlinePoints(zone.lines, { defaultW: zone.w / zone.lines.length, defaultH: (zone.fontSize || 12) * 1.2 });
        }
        return zone;
      });

      // Collect unique font names for AI font mapping
      const pageFonts = [...new Set(zones.filter(z => z.fontFamily).map(z => z.fontFamily))];

      // tocPage set at start of page loop (pages before and including TOC get rectangle zones, no sentence-level rules)
      // Multi-column: compute column split before clustering so we don't merge "Consultant" + "Publishing Credits" into one zone
      const pageWidthForColumns = img.width || img.dimensions?.width || (pageCoords && pageCoords.width) || 0;
      const colResult = (tocPage && pageWidthForColumns > 0 && zones.length >= 2)
        ? KitabooFxlService.detectColumnSplitX(zones, pageWidthForColumns)
        : null;
      const columnSplitX = (colResult && colResult.splitX != null) ? colResult.splitX : null;

      // Sentence-level (except cover-style pages): split any zone that contains multiple sentences into one zone per sentence.
      let zonesToCluster = zones;
      if (zoneLevel === 'sentence' && !isCoverPage && zones.length > 0) {
        const before = zones.length;
        zonesToCluster = KitabooFxlService.splitMultiSentenceZones(zones, img.pageNumber);
        if (zonesToCluster.length !== before) {
          console.log(`[KitabooFXL] Page ${img.pageNumber}: split multi-sentence zones ${before} -> ${zonesToCluster.length}.`);
        }
      }
      // New: Cluster and Deduplicate Spans to fix character overlap and redundant PDF layers.
      // Word-level zones (and cover when sentence-level uses word grouping): no merge so we keep one zone per word.
      // Sentence-level zones: allow clustering/line merging.
      const effectiveExtractionLevel = useWordGroupingThisPage ? 'word' : zoneLevel;
      let clusteredZones = (effectiveExtractionLevel === 'word')
        ? zonesToCluster
        : KitabooFxlService.clusterAndDeduplicateSpans(zonesToCluster, { extractionLevel: effectiveExtractionLevel, tocPage, columnSplitX });
      // Rule: one single-line zone for URLs (merge "http://www." + "tcmpub." + "com" into one zone at extraction/grouping).
      if (effectiveExtractionLevel === 'sentence' && clusteredZones.length > 0) {
        clusteredZones = KitabooFxlService.mergeConsecutiveUrlZones(clusteredZones);
      }

      // For multi-line sentence zones: recompute bbox from lines so it's tight (prevents elongated/wrong bbox from PDF)
      clusteredZones.forEach((z) => {
        if (Array.isArray(z.lines) && z.lines.length > 1) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const ln of z.lines) {
            if (ln.bbox && ln.bbox.length >= 4) {
              minX = Math.min(minX, ln.bbox[0]);
              minY = Math.min(minY, ln.bbox[1]);
              maxX = Math.max(maxX, ln.bbox[2]);
              maxY = Math.max(maxY, ln.bbox[3]);
            } else if (ln.origin && ln.origin.length >= 2) {
              const ox = Number(ln.origin[0]);
              const oy = Number(ln.origin[1]);
              const estW = (z.w || 100) / z.lines.length;
              const estH = (z.fontSize || 12) * 1.2;
              minX = Math.min(minX, ox);
              minY = Math.min(minY, oy);
              maxX = Math.max(maxX, ox + estW);
              maxY = Math.max(maxY, oy + estH);
            }
          }
          if (minX !== Infinity) {
            z.x = minX;
            z.y = minY;
            z.w = Math.max(maxX - minX, 1);
            z.h = Math.max(maxY - minY, 1);
          }
        }
      });

      // Cap zone height to actual text only when we have explicit multi-line data (z.lines).
      // Glyph-built sentence zones have no .lines but span multiple lines; do NOT cap them to 1 line.
      clusteredZones.forEach((z) => {
        const fsize = z.fontSize || 12;
        const lineCount = (z.lines && z.lines.length > 1) ? z.lines.length : null;
        if (lineCount != null) {
          const maxH = fsize * (lineCount * 1.4);
          if (z.h > maxH) {
            z.h = maxH;
          }
        }
        // If no .lines (e.g. zones from glyph grouping), keep z.h as-is so full sentence is covered
      });

      // Preserve exact PDF position: do not shift z.x/z.y. Only optionally shrink w/h from right/bottom so bbox hugs text.
      // Skip shrink on TOC/intro pages to prevent text collapsing (clipping last character).
      const MIN_W = 4;
      const MIN_H = 4;
      if (!tocPage) {
        clusteredZones.forEach((z) => {
          if (z.w > MIN_W && z.h > MIN_H) {
            const dx = Math.min(2, (z.w - 1) / 2);
            const dy = Math.min(2, (z.h - 1) / 2);
            z.w = Math.max(z.w - 2 * dx, 1);
            z.h = Math.max(z.h - 2 * dy, 1);
          }
        });
      }

      // All zones as polygon: use text-outline polygon for multi-line (sentence) zones, else bbox. Till TOC we use rectangle boxes only.
      // Slightly larger right padding on TOC/pre-TOC pages so long right-column lines don't look clipped.
      const clipPadR = tocPage ? 10 : 0;
      const clipPadL = 6;
      const clipPadT = 6;
      const clipPadB = tocPage ? 2 : 0;
      clusteredZones.forEach((z) => {
        const useRectBbox = tocPage; // TOC pages: rectangle per line; content pages: polygon outline
        if (!useRectBbox && Array.isArray(z.lines) && z.lines.length >= 2) {
          const outline = KitabooFxlService.linesToOutlinePoints(z.lines, { defaultW: (z.w || 100) / z.lines.length, defaultH: (z.fontSize || 12) * 1.2, paddingLeft: clipPadL, paddingTop: clipPadT });
          if (outline) z.points = outline;
          else z.points = KitabooFxlService.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        } else {
          z.points = KitabooFxlService.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        }
      });

      // Multi-column layout (TOC/intro): first column all rows, then second column all rows; one block per row
      const pageWidth = img.width || img.dimensions?.width || (pageCoords && pageCoords.width) || 0;
      let finalZones = (tocPage && clusteredZones.length >= 2 && pageWidth > 0)
        ? KitabooFxlService.reorderZonesForMultiColumnLayout(clusteredZones, pageWidth)
        : clusteredZones;
      if (tocPage && finalZones !== clusteredZones) {
        console.log(`[KitabooFXL] Page ${img.pageNumber}: multi-column layout applied (${clusteredZones.length} zones, column-first order).`);
      }

      // RCA fix: Image Credits (and similar) have one line with multiple items separated by ";". Split into one zone per item (after reorder so full-width lines stay in order).
      if (tocPage && finalZones.length > 0) {
        finalZones = KitabooFxlService.splitSemicolonSeparatedZones(finalZones, `p${img.pageNumber}`);
      }

      // Till TOC we have rectangle boxes: on TOC/pre-TOC pages (pageNumber <= tocEndPage) every zone must be a rectangle (4-point bbox), never polygon outline.
      if (tocPage && finalZones.length > 0) {
        const clipPadL = 6;
        const clipPadT = 6;
        // Slightly larger right padding so the last glyph isn't "cut" by the zone box (common on right column lines).
        const clipPadR = 10;
        const clipPadB = 2;
        finalZones.forEach((z) => {
          z.points = KitabooFxlService.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        });
      }

      // Save zones to DB (and expose to Studio). Zoning Studio must receive ONLY grouped zones (word or sentence), never raw glyph items.
      if (finalZones.length > 0) {
        await KitabooZoneModel.saveZonesForJob(jobId, pdfId, img.pageNumber, finalZones);
      }

      pages.push({
        pageNumber: img.pageNumber,
        imagePath: finalImgPath,
        dimensions: { width: img.width, height: img.height }, // Pixel dimensions (300 DPI)
        pointsDimensions: pageCoords ? { width: pageCoords.width, height: pageCoords.height } : null, // Original PDF points (72 DPI)
        zones: finalZones, // Grouped only (p6_w0, p6_w1 or p6_s0, p6_s1). Never raw pageCoords.items.
        fonts: pageFonts
      });
    }

    // Phase 4: Proactive AI Font Mapping
    const allFonts = [...new Set(pages.flatMap(p => p.fonts || []))];
    if (allFonts.length > 0 && process.env.GEMINI_API_KEY) {
      console.log(`[KitabooFXL] Analyzing ${allFonts.length} unique fonts for Gemini mapping...`);
      try {
        const prompt = `Here are the font names extracted from a PDF via PyMuPDF:
${allFonts.map(f => `- ${f}`).join('\n')}

For each font, identify the closest matching Google Font. 
Return only a JSON mapping object: { "PDF Font Name": "Google Font Name" }.`;
        const mappingJson = await GeminiService.generateContent(prompt, { modelName: 'gemini-2.0-flash' });
        const mapping = KitabooFxlService.safeParseJsonObject(mappingJson);
        if (mapping && typeof mapping === 'object') {
          KitabooFxlService._fontMappingCache = KitabooFxlService._fontMappingCache || {};
          KitabooFxlService._fontMappingCache[jobId] = mapping;
          console.log('[KitabooFXL] AI Font Mapping stored.');
        }
      } catch (err) { }
    }

    // Phase 4b: Automatic Artistic Style Refinement (Logic step requested for "apply automatic")
    // Identify headers and apply their visual styles (color, stroke) automatically.
    if (process.env.GEMINI_API_KEY) {
      console.log(`[KitabooFXL] Phase 4b: Refining artistic styles via AI...`);
      try {
        for (const page of pages) {
          const pt = pageTypeByNumber[page.pageNumber] || (page.pageNumber === 1 ? 'cover' : 'regular');
          const isHeroPage = pt === 'cover' || pt === 'chapterTitle';
          const headers = page.zones.filter(z => {
            const fs = z.fontSize || 0;
            return fs >= 20 || isHeroPage;
          }); // Focus on likely titles; always include text on hero pages
          if (headers.length === 0) continue;

          const imagePath = path.join(intermediateDir, 'high_fidelity_render', `page_${page.pageNumber}.png`);
          const imageBase64 = (await fs.readFile(imagePath)).toString('base64');

          const prompt = `Analyze this page image. I have already extracted some text zones, but I need you to identify the ARTISTIC STYLES for the following titles:
${headers.map(h => `- "${h.content}" at approx x=${h.x}, y=${h.y}`).join('\n')}

For each title, identify fill color (hex), stroke/outline color (hex), and stroke width (pixels).
IMPORTANT: If a title has MULTIPLE WORDS (e.g. "Horses Up Close"), return SEPARATE entries for each word or phrase that has a DIFFERENT style, so "Horses" can have a bold outlined style and "Up Close" a simpler style.
Example for "Horses Up Close": { "Horses": { "color": "#hex", "strokeColor": "#hex", "strokeWidth": 2 }, "Up Close": { "color": "#hex" } }.
Single-word titles: one entry. Use the exact word or phrase as key.

Return a JSON mapping: { "exact text or word": { "color": "#hex", "strokeColor": "#hex", "strokeWidth": pixels } }.
Only return JSON.`;

          const response = await GeminiService.generateContent([
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: imageBase64 } }
          ], { modelName: 'gemini-2.0-flash' });

          const styleMap = KitabooFxlService.safeParseJsonObject(response);
          if (styleMap && typeof styleMap === 'object') {
            page.zones.forEach(z => {
              let style = styleMap[z.content];
              // When zones are word-level, AI often returns one key for the full title (e.g. "All About Horses").
              // Match by finding a key that contains this zone's content; prefer the LONGEST matching key so
              // "Horses" gets the full title style ("All About Horses" = white) not a shorter key with black.
              if (!style && (z.content || '').trim()) {
                const word = (z.content || '').trim();
                const matchingKeys = Object.keys(styleMap).filter((k) => {
                  if (!k) return false;
                  if (k === word) return true;
                  const asWord = k.indexOf(` ${word} `) >= 0 || k.startsWith(`${word} `) || k.endsWith(` ${word}`);
                  return asWord || k.includes(word);
                });
                const key = matchingKeys.length > 0
                  ? matchingKeys.reduce((a, b) => (a.length >= b.length ? a : b))
                  : null;
                if (key) style = styleMap[key];
              }
              if (style) {
                z.color = style.color || z.color;
                z.strokeColor = style.strokeColor || null;
                z.strokeWidth = style.strokeWidth || null;
                if (z.strokeColor) z.type = 'header'; // Auto-promote to header if it has artistic stroke
              }
              // Sentence-level: apply per-word artistic styles so "Horses" gets same outline/gradient as word-level.
              if (Array.isArray(z.styleRuns) && z.styleRuns.length > 0 && (z.content || '').trim().includes(' ')) {
                const content = (z.content || z.text || '').trim();
                z.styleRuns.forEach((run) => {
                  const segment = content.slice(run.start, run.end).trim();
                  if (!segment) return;
                  let runStyle = styleMap[segment];
                  if (!runStyle && segment.length > 0) {
                    const matchingKeys = Object.keys(styleMap).filter((k) => k === segment || k.includes(segment) || segment.includes(k));
                    const key = matchingKeys.length > 0 ? matchingKeys.reduce((a, b) => (a.length >= b.length ? a : b)) : null;
                    if (key) runStyle = styleMap[key];
                  }
                  if (runStyle) {
                    if (runStyle.color != null) run.color = runStyle.color;
                    if (runStyle.strokeColor != null) run.strokeColor = runStyle.strokeColor;
                    if (runStyle.strokeWidth != null) run.strokeWidth = runStyle.strokeWidth;
                  }
                });
              }
            });
            // Re-save refined zones
            await KitabooZoneModel.saveZonesForJob(jobId, pdfId, page.pageNumber, page.zones);
          }
        }
        report(98, 'Phase 4b: Artistic Styles Applied');
      } catch (err) {
        console.warn('[KitabooFXL] AI Style Refinement failed:', err.message);
      }
    }


    // Phase 5: Font Discovery
    const fontDir = path.join(renderedDir, 'fonts');
    const fontsJsonPath = path.join(renderedDir, 'fonts.json');
    let extractedFonts = [];
    try {
      const mapping = JSON.parse(await fs.readFile(fontsJsonPath, 'utf8'));
      extractedFonts = Object.entries(mapping).map(([rawName, filename]) => ({
        rawName,
        filename,
        name: rawName, // The raw name used in PDF coords and AI logic
        woff2Filename: KitabooFxlService.isWoff2ConvertibleFont(filename)
          ? KitabooFxlService.getWoff2FileName(filename)
          : null,
        path: `/backend/html_intermediate/kitaboo_${jobId}/high_fidelity_render/fonts/${filename}`
      }));
      console.log(`[KitabooFXL] Discovered ${extractedFonts.length} extracted fonts via mapping.`);
    } catch (e) {
      // Fallback: directory listing (will have messy names)
      try {
        const fontFiles = await fs.readdir(fontDir);
        extractedFonts = fontFiles.map(f => ({
          filename: f,
          rawName: f.substring(0, f.lastIndexOf('.')),
          name: f.substring(0, f.lastIndexOf('.')),
          woff2Filename: KitabooFxlService.isWoff2ConvertibleFont(f)
            ? KitabooFxlService.getWoff2FileName(f)
            : null,
          path: `/backend/html_intermediate/kitaboo_${jobId}/high_fidelity_render/fonts/${f}`
        }));
        console.log(`[KitabooFXL] Discovered ${extractedFonts.length} fonts via directory listing.`);
      } catch (err) {
        // No fonts
      }
    }

    // Final Step: Persist Job Metadata to disk so it survives server restart
    const metadataPath = path.join(renderedDir, 'job_metadata.json');
    const jobMetadata = {
      jobId,
      pdfId,
      extractionLevel: 'glyph', // Always glyph; coords and EPUB use glyph-level data
      zoneLevel, // word | sentence — how zones were built for Studio
      fontMapping: KitabooFxlService._fontMappingCache[jobId] || {},
      extractedFonts,
      pagesMetadata: pages.map(p => ({
        pageNumber: p.pageNumber,
        dimensions: p.dimensions,
        pointsDimensions: p.pointsDimensions,
        pageType: pageTypeByNumber[p.pageNumber] || (p.pageNumber === 1 ? 'cover' : 'regular')
      }))
    };
    await fs.writeFile(metadataPath, JSON.stringify(jobMetadata, null, 2));
    console.log(`[KitabooFXL] Job metadata persisted to ${metadataPath}`);

    report(100, 'Complete');
    return { jobId, pages, extractedFonts };
  }

  /**
   * Normalize zone IDs so they are unique across all pages: p{pageNumber}_z{index} by reading order.
   * Preserves suffix _s0, _w0, _frag0 etc for sentence/word/fragment IDs.
   * Always sorts by readingOrder so manual edits in Studio are preserved in save and in EPUB output.
   */
  static normalizeZoneIdsForPage(pageNumber, zones) {
    if (!zones?.length) return zones;
    const sorted = [...zones].sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
    // Glyph word-level Sync Studio / alignment.json: sequential p{n}_z{i+1}_w{i} in reading order.
    // Must include BOTH short extraction ids (p11_w0) and full ids (p11_z19_w18) — mixed pages used to fall
    // through to legacy base+suffix and corrupt z slots (e.g. duplicate p11_z19, or p11_z19_w18 → p11_z1_w18).
    const glyphWordToken = (id) => {
      const s = String(id || '').trim();
      return /^p\d+_w\d+$/.test(s) || /^p\d+_z\d+_w\d+$/.test(s);
    };
    if (sorted.every(z => glyphWordToken(z.id))) {
      return sorted.map((z, i) => ({
        ...z,
        id: `p${pageNumber}_z${i + 1}_w${i}`,
        readingOrder: i + 1
      }));
    }
    return sorted.map((z, i) => {
      const base = `p${pageNumber}_z${i + 1}`;
      const oldId = (z.id && typeof z.id === 'string') ? z.id : '';
      const suffix = oldId.match(/(_s\d+(_frag\d+)?|_w\d+)$/)?.[0] || '';
      return { ...z, id: base + suffix, readingOrder: i + 1 };
    });
  }

  /**
   * Stable p{n}_z{m} prefix for a zone id (e.g. p6_z1_s0 → p6_z1, p6_z1 → p6_z1).
   * Used when matching alignment.json segment ids to normalized zone ids.
   */
  static baseZoneKey(zoneId) {
    const m = String(zoneId || '').match(/^(p\d+_z\d+)/);
    return m ? m[1] : null;
  }

  /**
   * Map a segment id from alignment.json to the canonical zone id returned by normalizeZoneIdsForPage.
   * Fixes bare p6_z1 vs p6_z1_s0 / p6_z1_w0 mismatches (saved alignment uses sentence id; DB/XHTML uses suffixed ids).
   * Does NOT bump z index — that was incorrectly done by a legacy +1 fallback in sync-studio GET.
   */
  static resolveSegmentIdToNormalizedZoneId(segmentId, normalizedZones) {
    const s = String(segmentId || '').trim();
    if (!s || !normalizedZones?.length) return null;
    const ids = new Set(normalizedZones.map(z => String(z.id)));
    if (ids.has(s)) return s;
    const base = KitabooFxlService.baseZoneKey(s);
    if (!base) return null;
    const sameBase = normalizedZones.filter(z => KitabooFxlService.baseZoneKey(String(z.id)) === base);
    if (sameBase.length === 0) return null;
    return String(sameBase[0].id);
  }

  /**
   * Build normalized pages + zoneIdMapByPage for FXL Sync Studio GET/PUT (same ids as EPUB export).
   * @param {Record<string, object[]>} zonesByPage
   * @returns {{ pages: Array<{ pageNumber: number, zones: object[] }>, zoneIdMapByPage: Record<string, Map|string|Set> }}
   */
  static buildSyncStudioPagesAndZoneMaps(zonesByPage) {
    const pageNumbers = Object.keys(zonesByPage || {})
      .map((k) => parseInt(k, 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const zoneIdMapByPage = {};
    const pages = pageNumbers
      .map((pageNum) => {
        const filtered = (zonesByPage[pageNum] || [])
          .filter((z) => (z.type === 'text' || z.content) && z.id != null && String(z.id).trim())
          .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
        const normalizedZones = KitabooFxlService.normalizeZoneIdsForPage(pageNum, filtered);
        const normalizedIdSet = new Set((normalizedZones || []).map((z) => String(z.id || '')));
        const map = new Map();
        for (let i = 0; i < filtered.length; i++) {
          const oldId = filtered[i]?.id;
          const newId = normalizedZones[i]?.id;
          if (oldId != null && newId != null) map.set(String(oldId), String(newId));
        }
        zoneIdMapByPage[pageNum] = map;
        zoneIdMapByPage[`${pageNum}__idSet`] = normalizedIdSet;
        return { pageNumber: pageNum, zones: normalizedZones };
      })
      .filter((p) => p.zones.length > 0);
    return { pages, zoneIdMapByPage };
  }

  /**
   * Remap alignment segment ids to canonical zone ids (must match GET /sync-studio and EPUB publish).
   */
  static remapAlignmentSegmentsWithMaps(segments, pages, zoneIdMapByPage) {
    return (segments || []).map((s) => {
      const id = s?.id;
      if (id == null || id === '') return s;
      const idStr = String(id);
      const p = KitabooFxlService.getPageNumFromZoneId(idStr);
      const pageZones = pages.find((pg) => pg.pageNumber === p)?.zones || [];
      const idSet = zoneIdMapByPage[`${p}__idSet`];
      const map = zoneIdMapByPage[p];

      if (map) {
        const mapped = map.get(idStr);
        if (mapped) return { ...s, id: mapped };
      }
      if (idSet && idSet.has(idStr)) return s;

      const resolved = KitabooFxlService.resolveSegmentIdToNormalizedZoneId(idStr, pageZones);
      if (resolved && resolved !== idStr) return { ...s, id: resolved };

      return s;
    });
  }

  /**
   * Apply top-to-bottom, left-to-right order to word-level zones by setting readingOrder from Y then X.
   * Call this only when loading from DB for Studio (ready) so initial display uses visual order;
   * after that, normalizeZoneIdsForPage sorts by readingOrder so user edits are preserved.
   */
  static applyYXReadingOrderToWordZones(zones) {
    if (!zones?.length) return zones;
    const wordLevel = zones.every(z => /_w\d+$/.test((z.id && typeof z.id === 'string') ? z.id : ''));
    if (!wordLevel) return zones;
    const sorted = [...zones].sort((a, b) => {
      const ya = Number(a.y ?? a.top ?? 0);
      const yb = Number(b.y ?? b.top ?? 0);
      if (Math.abs(ya - yb) > 0.5) return ya - yb;
      return (Number(a.x ?? a.left ?? 0)) - (Number(b.x ?? b.left ?? 0));
    });
    return sorted.map((z, i) => ({ ...z, readingOrder: i + 1 }));
  }

  /**
   * Save manual adjustments from the studio (job-scoped).
   * Normalizes zone IDs to p{page}_z{index} so they are unique across all pages.
   */
  static async saveManualZones(jobId, pdfId, pageNumber, zones) {
    const normalized = KitabooFxlService.normalizeZoneIdsForPage(pageNumber, zones || []);
    await KitabooZoneModel.saveZonesForJob(jobId, pdfId, pageNumber, normalized);
    return { success: true, zones: normalized };
  }

  /**
   * Pages with text zones in reading order; ids normalized to p{n}_z{i} (+ suffix) so Aeneas/Sync Studio use the same ids as GET /sync-studio.
   */
  static buildPagesWithZonesNormalized(zonesByPage) {
    const pageNumbers = Object.keys(zonesByPage).map(k => parseInt(k, 10)).filter(n => n > 0).sort((a, b) => a - b);
    return pageNumbers.map(pageNum => {
      const zones = zonesByPage[pageNum] || [];
      const textZones = zones
        .filter(z => (z.type === 'text' || z.content) && (z.content || '').trim() && (z.id != null && String(z.id).trim()))
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      const normalized = KitabooFxlService.normalizeZoneIdsForPage(pageNum, textZones);
      return { pageNum, textZones: normalized };
    }).filter(p => p.textZones.length > 0);
  }

  /** After alignment, write canonical zone ids to DB so alignment.json and Zoning Studio stay in sync (no id drift on refresh). */
  static async persistNormalizedZonesAfterAlignment(jobId, pagesWithZones) {
    if (!pagesWithZones?.length) return;
    try {
      const jobRow = await KitabooZoneModel.getJobByJobId(jobId);
      if (!jobRow?.pdfId) return;
      for (const pwz of pagesWithZones) {
        await KitabooZoneModel.saveZonesForJob(jobId, jobRow.pdfId, pwz.pageNum, pwz.textZones);
      }
      console.log(`[KitabooFXL] Persisted normalized zone ids for ${pagesWithZones.length} page(s) after alignment.`);
    } catch (e) {
      console.warn('[KitabooFXL] Failed to persist normalized zones after alignment:', e.message);
    }
  }

  /**
   * Phase 1: Convert PDF pages to 300 DPI WebP images
   * Writes to a temp file then renames to avoid Windows "Invalid argument" / file-lock when overwriting.
   * @param {(p: number, step: string) => void} [onProgress] - optional progress callback (0-100, step)
   */
  static async normalizeToWebP(pdfPath, outputDir, onProgress) {
    const report = (p, step) => { if (typeof onProgress === 'function') onProgress(p, step); };
    report(10, 'Rendering PDF pages...');
    const renderResult = await PdfExtractionService.renderPagesAsImages(pdfPath, outputDir);
    const images = renderResult.images || [];
    const total = images.length;
    report(25, `Converting to WebP (0/${total})...`);

    const writeWebpWithRetry = async (imgPath, destPath) => {
      const tmpPath = destPath + '.tmp.' + Date.now();
      const delays = [0, 400, 800, 1500];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        try {
          await sharp(imgPath)
            .webp({ quality: 90, lossless: false })
            .toFile(tmpPath);
          if (attempt > 0) await new Promise(r => setTimeout(r, delays[attempt]));
          await fs.unlink(destPath).catch(() => { });
          try {
            await fs.rename(tmpPath, destPath);
            return;
          } catch (renameErr) {
            if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
              try {
                await fs.copyFile(tmpPath, destPath);
                await fs.unlink(tmpPath).catch(() => { });
                return;
              } catch (_) {
                await fs.unlink(tmpPath).catch(() => { });
              }
            }
            throw renameErr;
          }
        } catch (err) {
          await fs.unlink(tmpPath).catch(() => { });
          if (attempt < delays.length - 1) {
            await new Promise(r => setTimeout(r, delays[attempt + 1]));
          } else {
            throw err;
          }
        }
      }
    };

    const webpAssets = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imageFileName = img.fileName.replace('.png', '.webp');
      const webpPath = path.join(outputDir, imageFileName);

      await writeWebpWithRetry(img.path, webpPath);
      report(25 + Math.round((65 * (i + 1)) / total), `Creating WebP ${i + 1}/${total}`);

      const metadata = await sharp(webpPath).metadata();

      webpAssets.push({
        path: webpPath,
        fileName: imageFileName,
        dimensions: {
          width: metadata.width,
          height: metadata.height
        }
      });

      await fs.unlink(img.path).catch(() => { });
    }

    return webpAssets;
  }

  /**
   * Split zones whose content contains multiple sentences into one zone per sentence,
   * so blocks like "A muzzle is a horse's jaw and nose. The withers are..." get separate zones with correct position.
   * Only splits when content has 2+ segments after splitting on . ! ?
   * @param {Array} zones - zones from glyph grouping (sentence-level)
   * @param {number} pageNumber - for assigning ids p${pageNumber}_s0, p${pageNumber}_s1, ...
   * @returns {Array} zones (possibly more) with one zone per sentence where applicable
   */
  static splitMultiSentenceZones(zones, pageNumber) {
    if (!zones || zones.length === 0) return zones;
    const out = [];
    for (const z of zones) {
      const content = (z.content || z.text || '').trim();
      const sentences = content.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
      if (sentences.length <= 1) {
        out.push(z);
        continue;
      }
      const zx = Number(z.x) ?? 0;
      const zy = Number(z.y) ?? 0;
      const zw = Number(z.w) ?? 0;
      const zh = Number(z.h) ?? 0;
      const totalLen = content.length;
      const lines = Array.isArray(z.lines) && z.lines.length > 0 ? z.lines : null;

      for (let i = 0; i < sentences.length; i++) {
        const sent = sentences[i];
        let x = zx, y = zy, w = zw, h = zh;
        let subLines = null;
        let subStyleRuns = null;

        if (lines && lines.length > 0) {
          const lineStart = Math.floor(i * lines.length / sentences.length);
          const lineEnd = Math.floor((i + 1) * lines.length / sentences.length);
          if (lineEnd > lineStart) {
            subLines = lines.slice(lineStart, lineEnd);
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const ln of subLines) {
              if (ln.bbox && ln.bbox.length >= 4) {
                minX = Math.min(minX, ln.bbox[0]);
                minY = Math.min(minY, ln.bbox[1]);
                maxX = Math.max(maxX, ln.bbox[2]);
                maxY = Math.max(maxY, ln.bbox[3]);
              } else if (ln.origin && ln.origin.length >= 2) {
                const ow = (z.w || 0) / lines.length;
                const oh = (z.fontSize || 12) * 1.2;
                minX = Math.min(minX, ln.origin[0]);
                minY = Math.min(minY, ln.origin[1]);
                maxX = Math.max(maxX, ln.origin[0] + ow);
                maxY = Math.max(maxY, ln.origin[1] + oh);
              }
            }
            if (minX !== Infinity) {
              x = minX;
              y = minY;
              w = Math.max(maxX - minX, 1);
              h = Math.max(maxY - minY, 1);
            }
          }
        } else if (totalLen > 0) {
          const charStart = content.indexOf(sent);
          const charEnd = charStart + sent.length;
          const ratioStart = charStart / totalLen;
          const ratioEnd = charEnd / totalLen;
          w = zw * (ratioEnd - ratioStart);
          x = zx + zw * ratioStart;
        }

        if (Array.isArray(z.styleRuns) && z.styleRuns.length > 0) {
          const charStart = content.indexOf(sent);
          const charEnd = charStart + sent.length;
          subStyleRuns = z.styleRuns
            .filter(r => r.end > charStart && r.start < charEnd)
            .map(r => ({
              start: Math.max(0, r.start - charStart),
              end: Math.min(sent.length, r.end - charStart),
              bold: r.bold,
              italic: r.italic,
              color: r.color,
              strokeColor: r.strokeColor,
              strokeWidth: r.strokeWidth
            }));
        }

        const subZone = {
          ...z,
          id: `p${pageNumber}_s${out.length}`,
          content: sent,
          text: sent,
          x, y, w, h,
          readingOrder: z.readingOrder != null ? z.readingOrder + i / sentences.length : out.length + 1,
          lines: subLines,
          styleRuns: subStyleRuns != null ? subStyleRuns : (sent.length > 0 ? [{ start: 0, end: sent.length, bold: !!z.bold, italic: !!z.italic, color: z.color || '#000000' }] : z.styleRuns)
        };
        if (subLines && subLines.length > 0) {
          subZone.points = KitabooFxlService.linesToOutlinePoints(subLines, { defaultW: w / subLines.length, defaultH: (z.fontSize || 12) * 1.2 });
        } else {
          subZone.points = KitabooFxlService.bboxToPoints(x, y, w, h);
        }
        out.push(subZone);
      }
    }
    return out.map((z, i) => ({ ...z, id: `p${pageNumber}_s${i}`, readingOrder: i + 1 }));
  }

  /**
   * High-Precision Clustering:
   * 1. Deduplicates exactly overlapping PDF text layers (OCR vs Visible).
   * 2. Merges adjacent spans on the same baseline into single logical lines (skipped when extractionLevel is 'word').
   * @param {Array} zones
   * @param {{ extractionLevel?: 'sentence'|'word' }} [options] - when 'word', do not merge so Studio shows one zone per word
   */
  static clusterAndDeduplicateSpans(zones, options = {}) {
    if (!zones || zones.length === 0) return [];
    const extractionLevel = options.extractionLevel || 'sentence';
    const tocPage = options.tocPage === true; // TOC/intro: line-by-line only, no cross-line merge
    const columnSplitX = options.columnSplitX != null && typeof options.columnSplitX === 'number' ? options.columnSplitX : null;

    // 1. Geography-based Deduplication (tighten misaligned OCR layers and PDF outline/shadow duplicates)
    // Same content + (position close or bbox overlap) => one zone; exclude adjacent same-line (e.g. "Up" "Up" in "Up Up Close").
    const unique = [];
    const overlapTolerance = 10;
    const bboxesOverlap = (a, b, margin = overlapTolerance) =>
      !(a.x + (a.w || 0) + margin < b.x || b.x + (b.w || 0) + margin < a.x ||
        a.y + (a.h || 0) + margin < b.y || b.y + (b.h || 0) + margin < a.y);
    const adjacentSameLine = (u, z, slop = 5) =>
      Math.abs((u.y ?? 0) - (z.y ?? 0)) < slop && (z.x ?? 0) >= (u.x ?? 0) + (u.w ?? 0) - 2;
    for (const z of zones) {
      const isDuplicate = unique.some(u =>
        (u.content || '').trim() === (z.content || '').trim() &&
        (Math.abs(u.x - z.x) < 6 && Math.abs(u.y - z.y) < 6 || bboxesOverlap(u, z)) &&
        !adjacentSameLine(u, z)
      );
      if (!isDuplicate) unique.push(z);
    }

    // Word-level: no merging — keep one zone per word so Studio matches EPUB word-by-word sync.
    // Also run overlap-based dedup so PDF outline/shadow layers (same content, overlapping bbox) become a single zone.
    if (extractionLevel === 'word') {
      const bboxOverlap = (a, b, marginPx = 12) => {
        const m = marginPx || 0;
        return !(a.x + (a.w || 0) + m < b.x || b.x + (b.w || 0) + m < a.x ||
          a.y + (a.h || 0) + m < b.y || b.y + (b.h || 0) + m < a.y);
      };
      const sameContent = (a, b) => (a.content || '').trim() === (b.content || '').trim();
      const adjacentOnSameLine = (a, b, lineSlop = 5) =>
        Math.abs((a.y ?? 0) - (b.y ?? 0)) < lineSlop && (b.x ?? 0) >= (a.x ?? 0) + (a.w ?? 0) - 2;
      const wordDeduped = [];
      const byReadingOrder = [...unique].sort((a, b) => {
        const ay = a.origin ? a.origin[1] : a.y;
        const by = b.origin ? b.origin[1] : b.y;
        if (Math.abs(ay - by) > 1.5) return ay - by;
        const ax = a.origin ? a.origin[0] : a.x;
        const bx = b.origin ? b.origin[0] : b.x;
        return ax - bx;
      });
      for (const z of byReadingOrder) {
        const isRedundant = wordDeduped.some(d =>
          sameContent(d, z) && (bboxOverlap(d, z) && !adjacentOnSameLine(d, z))
        );
        if (!isRedundant) wordDeduped.push(z);
      }
      return wordDeduped.map((z, i) => ({ ...z, readingOrder: i + 1 }));
    }

    // 2. Baseline Clustering (sentence-level)
    const sorted = [...unique].sort((a, b) => {
      const ay = a.origin ? a.origin[1] : a.y;
      const by = b.origin ? b.origin[1] : b.y;
      if (Math.abs(ay - by) > 1.5) return ay - by;
      const ax = a.origin ? a.origin[0] : a.x;
      const bx = b.origin ? b.origin[0] : b.x;
      return ax - bx;
    });

    const clustered = [];
    let current = null;

    const ensureStyleRuns = (zone, upToEnd) => {
      if (Array.isArray(zone.styleRuns) && zone.styleRuns.length > 0) return;
      const len = upToEnd != null ? upToEnd : (zone.content || '').length;
      if (len > 0) {
        zone.styleRuns = [{ start: 0, end: len, bold: !!zone.bold, italic: !!zone.italic, color: zone.color || '#000000' }];
      }
    };
    const appendStyleRun = (zone, start, end, bold, italic, color) => {
      ensureStyleRuns(zone, start);
      if (!zone.styleRuns) zone.styleRuns = [];
      zone.styleRuns.push({ start, end, bold: !!bold, italic: !!italic, color: color || '#000000' });
      // Coalesce adjacent runs with same style
      const runs = zone.styleRuns;
      const out = [];
      for (const r of runs) {
        const last = out[out.length - 1];
        if (last && last.end === r.start && last.bold === r.bold && last.italic === r.italic && last.color === r.color) {
          last.end = r.end;
        } else {
          out.push({ ...r });
        }
      }
      zone.styleRuns = out;
    };

    for (const z of sorted) {
      if (!current) {
        current = { ...z };
        if (current.content != null) current.content = (current.content || '').replace(/\s+/g, ' ').trim();
        ensureStyleRuns(current);
        if (!Array.isArray(current.lines) || current.lines.length === 0) {
          current.lines = [{ text: (current.content || '').trim(), bbox: [current.x, current.y, current.x + (current.w || 0), current.y + (current.h || 0)], origin: [current.x, current.y], align: current.textAlign }];
        }
        continue;
      }

      const curY = current.y ?? current.origin?.[1];
      const zY = z.y ?? z.origin?.[1];
      const curXOrigin = current.x ?? current.origin?.[0];
      const curXEnd = curXOrigin + current.w;
      const zXOrigin = z.x ?? z.origin?.[0];

      // Same line: use BOTH Y threshold AND X reset. If next zone's X is significantly left of current, it's a new line (don't merge).
      // On TOC pages use a looser threshold so one visual line (e.g. "Name, M.A.Ed., Editorial Director") from multiple PDF spans merges into one zone.
      const lineHeightPx = Math.max(current.fontSize * 0.4, 4);
      const lineHeightFull = Math.max(current.fontSize * 1.5, 12);
      const sameLineThreshold = tocPage ? Math.max(current.fontSize * 1.0, 10) : lineHeightPx;
      const isNewLineByX = zXOrigin < curXOrigin - (current.fontSize * 0.5);
      const sameLine = Math.abs(curY - zY) < sameLineThreshold && !isNewLineByX;
      // Next line (sentence wraps): z is on a line below current. Use a generous threshold so we merge until we hit a real sentence end.
      const verticalGap = zY - curY;
      const isNextLineDown = !sameLine && verticalGap > 0;
      // Period-ending logic: only for content pages (sentence-level). On TOC/intro we never merge to next line, so do not use it there.
      const currentEndsSentence = tocPage ? false : /[.!?]\s*$/.test((current.content || '').trim());
      // If current doesn't end with . ! ?, treat as sentence continuation and allow larger gap (e.g. "You would have a long tail" + "and mane.")
      const maxGap = currentEndsSentence ? lineHeightFull * 2.5 : lineHeightFull * 5;
      const nextLineDown = isNextLineDown && verticalGap < maxGap;
      const spaceThreshold = Math.max(current.fontSize * 0.5, 4);
      const adjacent = (zXOrigin - curXEnd) < spaceThreshold;
      // On TOC pages: merge same-line only within the same column (don't merge "Consultant" + "Publishing Credits").
      const curCenterX = curXOrigin + (current.w || 0) / 2;
      const zCenterX = zXOrigin + (z.w || 0) / 2;
      const sameColumn = !columnSplitX || (curCenterX < columnSplitX && zCenterX < columnSplitX) || (curCenterX >= columnSplitX && zCenterX >= columnSplitX);
      const sameLineMergeable = sameLine && (adjacent || (tocPage && sameColumn));
      const curRot = (current.origin && current.origin[2]) || 0;
      const zRot = (z.origin && z.origin[2]) || 0;

      const sameStyle = current.fontFamily === z.fontFamily &&
        (Math.abs(current.fontSize - z.fontSize) <= 1.5 || (Math.min(current.fontSize, z.fontSize) / Math.max(current.fontSize, z.fontSize, 1)) >= 0.85) &&
        current.color === z.color &&
        current.bold === z.bold &&
        current.italic === z.italic &&
        Math.abs(curRot - zRot) < 0.5;
      // On TOC pages allow merging same-line even if style differs slightly. On content pages allow same-line merge when adjacent so we can preserve word-level styles (e.g. bold "mane") in styleRuns.
      const styleOkForMerge = sameStyle || (tocPage && sameLine) || sameLineMergeable;
      const isMultiLineSentence = (current.lines?.length > 1) || (z.lines?.length > 1);
      // Don't merge into oversized zones (e.g. full paragraph / TOC block)
      const currentHeight = current.origin ? (current.h || 0) : (current.h || 0);
      const wouldBeTooTall = currentHeight > 0 && (zY + z.h - (current.origin ? current.origin[1] : current.y)) > (current.fontSize * 2.5);
      const wouldBeTooLong = ((current.content || '').length + (z.content || '').length) > 180;
      // Diagram/glossary labels like "ear", "mane", "withers", "tail" are short single words far apart.
      // When both zones are short single words with no punctuation and far apart, never merge them,
      // even if baseline clustering says they are on the same "line".
      const isShortLabel = (zone) => {
        const t = (zone.content || '').trim();
        return t.length > 0 && t.length <= 16 && !t.includes(' ') && !/[.!?]/.test(t);
      };
      // Diagram / glossary labels: when both sides are short single-word labels, never merge them
      // into a single polygon on content pages, regardless of distance. Each label stays its own zone.
      const bothShortLabels = !tocPage && isShortLabel(current) && isShortLabel(z);
      const blockMergeForLabels = bothShortLabels;

      const mergeSameLine = !blockMergeForLabels && !isMultiLineSentence && sameLineMergeable && styleOkForMerge && !wouldBeTooTall && !wouldBeTooLong;
      // Content pages: do not merge next line when current ends with . ! ? — each sentence gets its own block.
      // TOC/intro: never merge across lines (period-ending logic is not used there).
      const mergeNextLine = !blockMergeForLabels && !tocPage && nextLineDown && sameStyle && !wouldBeTooLong && (current.lines?.length || 0) < 12 && !currentEndsSentence;

      if (mergeSameLine) {
        // Add a space between words if they were separate in the PDF. Trim trailing/leading to avoid double space.
        const curTrimmed = (current.content || '').replace(/\s+$/, '');
        const zTrimmed = (z.content || '').trim();
        const gap = zXOrigin - curXEnd;
        const needsSpace = gap > 1.0 && curTrimmed.length > 0 && !curTrimmed.endsWith(' ');
        const prevLen = curTrimmed.length;
        current.content = curTrimmed + (needsSpace ? ' ' : '') + zTrimmed;
        appendStyleRun(current, prevLen + (needsSpace ? 1 : 0), current.content.length, z.bold, z.italic, z.color);
        current.w = (zXOrigin + z.w) - curXOrigin;
        current.h = Math.max(current.h, z.h);
        // Merge line geometry so sentence zone has outline for polygon (first/last line)
        const zLines = Array.isArray(z.lines) && z.lines.length > 0 ? z.lines : [{ text: (z.content || '').trim(), bbox: [z.x, z.y, z.x + (z.w || 0), z.y + (z.h || 0)], origin: [z.x, z.y], align: z.textAlign }];
        current.lines = (current.lines || []).concat(zLines);
        // RCA: Ensure merged zone content is never shorter than lines (Zoning Studio "OCR text not cutting")
        if (Array.isArray(current.lines) && current.lines.length > 0) {
          const fromLines = current.lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ');
          if (fromLines && (fromLines.length > (current.content || '').length)) current.content = fromLines;
        }
      } else if (mergeNextLine) {
        // Sentence wraps to next line: merge so one zone has multiple lines → trapezoid polygon. Trim to avoid double space.
        const curTrimmed = (current.content || '').replace(/\s+$/, '');
        const zTrimmed = (z.content || '').trim();
        const prevLen = curTrimmed.length;
        const sep = prevLen > 0 && !curTrimmed.endsWith(' ') ? ' ' : '';
        current.content = curTrimmed + sep + zTrimmed;
        appendStyleRun(current, prevLen + sep.length, current.content.length, z.bold, z.italic, z.color);
        const left = Math.min(current.x ?? 0, z.x ?? 0);
        const right = Math.max((current.x ?? 0) + (current.w || 0), (z.x ?? 0) + (z.w || 0));
        const bottom = Math.max((current.y ?? 0) + (current.h ?? 0), (z.y ?? 0) + (z.h ?? 0));
        current.x = left;
        current.w = Math.max(1, right - left);
        current.h = Math.max(1, bottom - (current.y ?? 0));
        const zLines = Array.isArray(z.lines) && z.lines.length > 0 ? z.lines : [{ text: (z.content || '').trim(), bbox: [z.x, z.y, z.x + (z.w || 0), z.y + (z.h || 0)], origin: [z.x, z.y], align: z.textAlign }];
        current.lines = (current.lines || []).concat(zLines);
        // RCA: Ensure merged zone content matches lines (Zoning Studio full OCR text)
        if (Array.isArray(current.lines) && current.lines.length > 0) {
          const fromLines = current.lines.map((l) => (l.text || '').trim()).filter(Boolean).join(' ');
          if (fromLines && (fromLines.length > (current.content || '').length)) current.content = fromLines;
        }
      } else {
        clustered.push(current);
        current = { ...z };
        // Normalize content so sentence-level zones never have multiple spaces
        if (current.content != null) current.content = (current.content || '').replace(/\s+/g, ' ').trim();
        ensureStyleRuns(current);
        if (!Array.isArray(current.lines) || current.lines.length === 0) {
          current.lines = [{ text: (current.content || '').trim(), bbox: [current.x, current.y, current.x + (current.w || 0), current.y + (current.h || 0)], origin: [current.x, current.y], align: current.textAlign }];
        }
      }
    }
    if (current) {
      if (current.content != null) current.content = (current.content || '').replace(/\s+/g, ' ').trim();
      clustered.push(current);
    }

    // 3. Split pure label-lines (diagram/glossary labels) into one zone per line when every line
    // is a short single word with no punctuation (e.g. "ear", "mane", "withers", "tail").
    const isShortLabelText = (t) => {
      const s = (t || '').trim();
      return s.length > 0 && s.length <= 16 && !s.includes(' ') && !/[.!?]/.test(s);
    };
    const expanded = [];
    for (const z of clustered) {
      if (!tocPage && extractionLevel === 'sentence' && Array.isArray(z.lines) && z.lines.length > 1) {
        const allLabelLines = z.lines.every(ln => isShortLabelText(ln.text));
        if (allLabelLines) {
          for (const ln of z.lines) {
            const text = (ln.text || '').trim();
            if (!text) continue;
            let bx = z.x, by = z.y, bw = z.w, bh = z.h;
            if (ln.bbox && ln.bbox.length >= 4) {
              bx = ln.bbox[0];
              by = ln.bbox[1];
              bw = Math.max(1, ln.bbox[2] - ln.bbox[0]);
              bh = Math.max(1, ln.bbox[3] - ln.bbox[1]);
            } else if (ln.origin && ln.origin.length >= 2) {
              const estW = (z.w || 60) / z.lines.length;
              const estH = (z.fontSize || 12) * 1.2;
              bx = ln.origin[0];
              by = ln.origin[1];
              bw = estW;
              bh = estH;
            }
            const lineZone = {
              ...z,
              content: text,
              text,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              lines: [ln],
            };
            expanded.push(lineZone);
          }
          continue;
        }
      }
      expanded.push(z);
    }

    // 4. Post-cluster Deduplication (surgical removal of redundant overlapping layers)
    // Cover pages often have duplicate text (e.g. "Horses", "Up" twice from outline/shadow layers). At sentence level,
    // drop a zone when content matches (or one contains the other) AND positions are close OR bboxes overlap.
    const bboxOverlap = (a, b, marginPx = 10) => {
      const m = marginPx || 0;
      return !(a.x + (a.w || 0) + m < b.x || b.x + (b.w || 0) + m < a.x ||
        a.y + (a.h || 0) + m < b.y || b.y + (b.h || 0) + m < a.y);
    };
    const contentMatch = (a, b) => {
      const ac = (a.content || '').trim();
      const bc = (b.content || '').trim();
      return ac === bc || (ac.length > 0 && bc.length > 0 && (ac.includes(bc) || bc.includes(ac)));
    };
    // Same content but adjacent on same line (e.g. "Up" "Up" in "Up Up Close") must not be merged.
    const adjacentOnSameLine = (d, z, lineSlop = 4) =>
      Math.abs((d.y ?? 0) - (z.y ?? 0)) < lineSlop && (z.x ?? 0) >= (d.x ?? 0) + (d.w ?? 0) - 2;

    const sortedByLength = [...clustered].sort((a, b) => (b.content || '').length - (a.content || '').length);
    const deduplicated = [];
    for (const z of sortedByLength) {
      const posClose = (d) => Math.abs(d.x - z.x) < 8 && Math.abs(d.y - z.y) < 8;
      const isRedundant = deduplicated.some(d =>
        contentMatch(d, z) && (posClose(d) || (bboxOverlap(d, z) && !adjacentOnSameLine(d, z)))
      );
      if (!isRedundant) deduplicated.push(z);
    }

    // Restore reading order (top-to-bottom, left-to-right) after deduplication
    const finalZones = deduplicated.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 10) return a.y - b.y;
      return a.x - b.x;
    });

    // Re-index IDs for safety
    return finalZones.map((z, i) => {
      const m = z.id.match(/^p(\d+)_/);
      const prefix = m ? `p${m[1]}` : 'pz';
      return { ...z, id: `${prefix}_z${i}`, readingOrder: i + 1 };
    });
  }

  /**
   * Rule: one single-line zone for URLs. Merges consecutive same-line zones that form URL parts
   * (e.g. "http://www." + "tcmpub." + "com") into one zone so Studio and EPUB show one block for the full URL.
   * Called after clusterAndDeduplicateSpans for sentence-level only.
   * @param {Array<{ id: string, content?: string, x: number, y: number, w: number, h: number, lines?: Array }>} zones
   * @returns {Array} Zones with consecutive URL parts merged; ids and readingOrder re-indexed
   */
  static mergeConsecutiveUrlZones(zones) {
    if (!zones || zones.length === 0) return zones;
    const sorted = [...zones].sort((a, b) => {
      const ay = Number(a.y ?? a.origin?.[1] ?? 0);
      const by = Number(b.y ?? b.origin?.[1] ?? 0);
      if (Math.abs(ay - by) > 6) return ay - by;
      return Number(a.x ?? a.origin?.[0] ?? 0) - Number(b.x ?? b.origin?.[0] ?? 0);
    });
    const lineSlop = 6;
    const sameLine = (a, b) => Math.abs(Number(a.y ?? 0) - Number(b.y ?? 0)) < lineSlop;
    const merged = [];
    let i = 0;
    while (i < sorted.length) {
      let z = sorted[i];
      let content = (z.content || z.text || '').trim();
      let left = Number(z.x ?? z.left ?? 0);
      let top = Number(z.y ?? z.top ?? 0);
      let right = left + Number(z.w ?? z.width ?? 0);
      let bottom = top + Number(z.h ?? 0);
      const lines = Array.isArray(z.lines) && z.lines.length > 0 ? [...z.lines] : [{ text: content, bbox: [left, top, right, bottom], origin: [left, top], align: z.textAlign || 'left' }];
      i++;
      while (i < sorted.length) {
        const next = sorted[i];
        const nextContent = (next.content || next.text || '').trim();
        if (!sameLine(z, next)) break;
        if (/\.\s*$/.test(content) && /^(com|org|net)$/i.test(nextContent)) {
          content = content.replace(/\s*\.\s*$/, '') + '.' + nextContent;
          const nx = Number(next.x ?? next.left ?? 0);
          const nw = Number(next.w ?? next.width ?? 0);
          right = nx + nw;
          bottom = Math.max(bottom, Number(next.y ?? 0) + Number(next.h ?? 0));
          if (Array.isArray(next.lines) && next.lines.length > 0) lines.push(...next.lines);
          else lines.push({ text: nextContent, bbox: [nx, next.y, nx + nw, next.y + (next.h || 0)], origin: [nx, next.y], align: next.textAlign || 'left' });
          i++;
          break;
        }
        if (/\.\s*$/.test(content) && nextContent.endsWith('.') && !/\s/.test(nextContent)) {
          content = content.replace(/\s*\.\s*$/, '') + '.' + nextContent;
          const nx = Number(next.x ?? next.left ?? 0);
          const nw = Number(next.w ?? next.width ?? 0);
          right = nx + nw;
          bottom = Math.max(bottom, Number(next.y ?? 0) + Number(next.h ?? 0));
          if (Array.isArray(next.lines) && next.lines.length > 0) lines.push(...next.lines);
          else lines.push({ text: nextContent, bbox: [nx, next.y, nx + nw, next.y + (next.h || 0)], origin: [nx, next.y], align: next.textAlign || 'left' });
          i++;
        } else break;
      }
      const mergedZone = {
        ...z,
        content,
        text: content,
        x: left,
        y: top,
        w: Math.max(1, right - left),
        h: Math.max(1, bottom - top),
        lines: lines.length > 0 ? lines : undefined
      };
      if (content.length > 0) {
        mergedZone.styleRuns = [{ start: 0, end: content.length, bold: !!z.bold, italic: !!z.italic, color: z.color || '#000000' }];
      }
      merged.push(mergedZone);
    }
    const firstId = merged[0] && merged[0].id ? String(merged[0].id) : '';
    const prefixMatch = firstId.match(/^p(\d+)_/);
    const prefix = prefixMatch ? `p${prefixMatch[1]}` : 'pz';
    return merged.map((z, idx) => ({ ...z, id: `${prefix}_z${idx}`, readingOrder: idx + 1 }));
  }

  /**
   * Detect two-column layout: returns splitX and which rows are in the two-column region (top block only).
   * Used to avoid merging across columns and to reorder only the top block; "Image Credits" and below stay single-column order.
   * @param {Array} zones - Zones with x, y, w
   * @param {number} pageWidth - Page width in same units as zone.x
   * @returns {{ splitX: number, twoColumnRowKeys: Set<number> } | null} splitX and row keys that have the column gap, or null
   */
  static detectColumnSplitX(zones, pageWidth) {
    if (!zones || zones.length < 2 || !pageWidth || pageWidth <= 0) return null;
    const minCenter = pageWidth * 0.2;
    const maxCenter = pageWidth * 0.8;
    const minGapForColumns = Math.max(pageWidth * 0.05, 25);
    const rowSlop = Math.max(25, (pageWidth / 80));

    const rowKey = (z) => Math.round((z.y ?? z.origin?.[1] ?? 0) / rowSlop) * rowSlop;
    const byRow = new Map();
    for (const z of zones) {
      const k = rowKey(z);
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(z);
    }

    let maxGap = 0;
    let splitX = null;
    const twoColumnRowKeys = new Set();
    for (const [rowK, rowZones] of byRow) {
      if (rowZones.length < 2) continue;
      const byX = [...rowZones].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      let rowMaxGap = 0;
      let rowSplitX = null;
      for (let i = 0; i < byX.length - 1; i++) {
        const rightEdge = (byX[i].x ?? 0) + (byX[i].w ?? 0);
        const nextLeft = byX[i + 1].x ?? 0;
        const gap = nextLeft - rightEdge;
        const gapCenter = (rightEdge + nextLeft) / 2;
        if (gap > rowMaxGap && gapCenter >= minCenter && gapCenter <= maxCenter) {
          rowMaxGap = gap;
          rowSplitX = gapCenter;
        }
      }
      if (rowMaxGap >= minGapForColumns && rowSplitX != null) {
        twoColumnRowKeys.add(rowK);
        if (rowMaxGap > maxGap) {
          maxGap = rowMaxGap;
          splitX = rowSplitX;
        }
      }
    }
    if (splitX == null || twoColumnRowKeys.size === 0) return null;
    return { splitX, twoColumnRowKeys };
  }

  /**
   * RCA: Image Credits (and similar) lines contain multiple semicolon-separated items; we had one zone per line.
   * Root cause: clustering only merges by geometry (same line/column); we never split by delimiters.
   * Fix: On TOC pages, split any zone whose content contains ";" into one zone per segment (proportional bbox on same line).
   * @param {Array} zones - Clustered zones (with x, y, w, h, content)
   * @param {string} pagePrefix - e.g. "p4" for id re-indexing
   * @returns {Array} Zones with semicolon-separated content split into one zone per item; ids and readingOrder re-indexed
   */
  static splitSemicolonSeparatedZones(zones, pagePrefix) {
    if (!zones || zones.length === 0) return zones || [];
    const out = [];
    for (const z of zones) {
      const content = (z.content || '').trim();
      const segments = content.split(/\s*;\s*/).map(s => s.trim()).filter(s => s.length > 0);
      if (segments.length <= 1) {
        out.push(z);
        continue;
      }
      const x0 = Number(z.x ?? 0);
      const y0 = Number(z.y ?? 0);
      const lineW = Number(z.w ?? 1);
      const lineH = Number(z.h ?? 12);
      const totalChars = segments.reduce((sum, s) => sum + s.length, 0) || 1;
      const pad = 2; // avoid clipping last character on the line
      let x = x0;
      let usedW = 0;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const ratio = seg.length / totalChars;
        const isLast = i === segments.length - 1;
        const w = isLast
          ? Math.max(1, lineW - usedW + pad) // last segment: use remaining width + padding to prevent collapse
          : Math.max(1, Math.round(lineW * ratio));
        usedW += (isLast ? w - pad : w);
        const newZone = {
          ...z,
          content: seg,
          x,
          y: y0,
          w,
          h: lineH,
          lines: [{ text: seg, bbox: [x, y0, x + w, y0 + lineH], origin: [x, y0], align: z.textAlign }]
        };
        newZone.points = KitabooFxlService.bboxToPoints(x, y0, w, lineH);
        out.push(newZone);
        x += w;
      }
    }
    return out.map((z, i) => ({
      ...z,
      id: `${pagePrefix}_z${i}`,
      readingOrder: i + 1
    }));
  }

  /**
   * Detect multi-column layout and reorder zones so reading order is: first column (all rows), then second column (all rows).
   * Order: Consultant (1), Timothy Rasinski Ph.D. (2), Kent State University (3), Publishing Credits (4), Dona Herweck Rice (5), ...
   * Each row remains one block (zone). Only applied when tocPage is true (intro/TOC). Uses horizontal gap to detect columns.
   * @param {Array} zones - Zones with x, y, w, h and id
   * @param {number} pageWidth - Page width in same units as zone.x (e.g. img.width)
   * @returns {Array} Zones reordered by column then row, with readingOrder and ids updated
   */
  static reorderZonesForMultiColumnLayout(zones, pageWidth) {
    if (!zones || zones.length < 2 || !pageWidth || pageWidth <= 0) return zones || [];
    const colResult = KitabooFxlService.detectColumnSplitX(zones, pageWidth);
    if (colResult == null) {
      return zones;
    }
    const { splitX, twoColumnRowKeys } = colResult;
    const rowSlop = Math.max(25, (pageWidth / 80));
    const rowKey = (z) => Math.round((z.y ?? z.origin?.[1] ?? 0) / rowSlop) * rowSlop;

    const inTwoCol = [];
    const singleCol = [];
    for (const z of zones) {
      if (twoColumnRowKeys.has(rowKey(z))) {
        inTwoCol.push(z);
      } else {
        singleCol.push(z);
      }
    }

    const withCol = inTwoCol.map((z) => {
      const centerX = (z.x ?? 0) + (z.w ?? 0) / 2;
      const col = centerX < splitX ? 0 : 1;
      const y = z.y ?? z.origin?.[1] ?? 0;
      const x = z.x ?? z.origin?.[0] ?? 0;
      return { ...z, _col: col, _y: y, _x: x };
    });
    const twoColSorted = withCol.sort((a, b) => {
      if (a._col !== b._col) return a._col - b._col;
      if (Math.abs(a._y - b._y) > 10) return a._y - b._y;
      return a._x - b._x;
    });
    const singleColSorted = singleCol.sort((a, b) => {
      const ay = a.y ?? a.origin?.[1] ?? 0;
      const by = b.y ?? b.origin?.[1] ?? 0;
      if (Math.abs(ay - by) > 5) return ay - by;
      return (a.x ?? 0) - (b.x ?? 0);
    });

    const reordered = [...twoColSorted, ...singleColSorted];
    const m = (reordered[0] && reordered[0].id) ? reordered[0].id.match(/^p(\d+)_/) : null;
    const prefix = m ? `p${m[1]}` : 'pz';
    return reordered.map((z, i) => {
      const { _col, _y, _x, ...rest } = z;
      return { ...rest, id: `${prefix}_z${i}`, readingOrder: i + 1 };
    });
  }

  /**
   * Expand zones to sync level (word) in memory so XHTML has one element per SMIL target.
   * When syncLevel is 'word', SMIL references p1_z0_w0, p1_z0_w1 — XHTML must have those ids.
   * Sentence level uses base zone id, so no expansion needed.
   * When extractionLevel is 'glyph', zones are already word-level from glyph pipeline; do not run proportional expansion.
   * @param {Array} zones - Base zones (e.g. from page.zones)
   * @param {string} syncLevel - 'word' or 'sentence'
   * @param {{ extractionLevel?: string }} [opts] - If extractionLevel === 'glyph', return zones unchanged (no proportional logic).
   * @returns {Array} Zones at the correct granularity for XHTML (and SMIL)
   */
  static expandZonesToSyncLevelInMemory(zones, syncLevel, opts = {}) {
    if (!zones?.length || syncLevel !== 'word') return zones || [];
    if (opts.extractionLevel === 'glyph') return zones;
    const textZones = zones.filter(z =>
      (z.type === 'text' || z.type === 'header') && (z.content || '').trim() && !/_w\d+$/.test(String(z.id || ''))
    );
    const alreadyWordLevel = zones.filter(z => /_w\d+$/.test(String(z.id || '')));
    const nonText = zones.filter(z => !textZones.includes(z) && !alreadyWordLevel.includes(z));
    // Process all text zones in strict reading order so XHTML/SMIL order matches (fixes "player starting from merged zone")
    const allTextZonesOrdered = [...textZones, ...alreadyWordLevel].sort(
      (a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999)
    );
    let nextRO = 1;
    const out = [];
    for (const zone of allTextZonesOrdered) {
      const isAlreadyWord = /_w\d+$/.test(String(zone.id || ''));
      if (isAlreadyWord) {
        out.push({ ...zone, readingOrder: nextRO++ });
        continue;
      }
      const content = (zone.content || '').trim();
      const words = content.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) {
        out.push({ ...zone, readingOrder: nextRO++ });
        continue;
      }
      const inherited = {};
      for (const key of ['fontSize', 'fontFamily', 'color', 'bold', 'italic', 'origin', 'strokeColor', 'strokeWidth', 'letterSpacing', 'textShadow', 'textAlign', 'styleRuns']) {
        if (zone[key] != null) inherited[key] = zone[key];
      }
      const fSize = zone.fontSize || 12;
      const zh = Number(zone.h) ?? 20;

      // Multi-line zone: expand per line so each word keeps its line's y (preserves vertical spacing at word level)
      if (Array.isArray(zone.lines) && zone.lines.length > 1) {
        let globalWordIdx = 0;
        for (let lineIdx = 0; lineIdx < zone.lines.length; lineIdx++) {
          const line = zone.lines[lineIdx];
          const lineText = (line.text || '').trim();
          const lineWords = lineText.split(/\s+/).filter(w => w.length > 0);
          if (lineWords.length === 0) continue;
          const lx0 = (line.origin && line.origin[0] != null) ? Number(line.origin[0]) : (Number(zone.x) ?? 0);
          const ly = (line.origin && line.origin[1] != null) ? Number(line.origin[1]) : (Number(zone.y) ?? 0);
          const lineBbox = line.bbox && line.bbox.length >= 4 ? line.bbox : null;
          const lw = lineBbox ? Math.max(1, Number(lineBbox[2]) - Number(lineBbox[0])) : (Number(zone.w) ?? 100);
          const totalChars = lineWords.reduce((s, w) => s + w.length, 0);
          let x = lx0;
          for (let wi = 0; wi < lineWords.length; wi++) {
            const word = lineWords[wi];
            const w = totalChars > 0 ? Math.max(8, Math.round(lw * (word.length / totalChars))) : Math.max(8, Math.round(lw / lineWords.length));
            out.push({
              ...zone,
              ...inherited,
              id: `${zone.id}_w${globalWordIdx}`,
              content: word,
              x: Math.round(x),
              y: Math.round(ly),
              w,
              h: zh,
              readingOrder: nextRO++
            });
            x += w;
            globalWordIdx++;
          }
        }
        continue;
      }

      // Single-line zone: expand words on one line (existing behavior)
      const zx = Number(zone.x) ?? 0;
      const zy = Number(zone.y) ?? 0;
      const zw = Number(zone.w) ?? 100;
      const totalChars = words.reduce((s, w) => s + w.length, 0);
      const estimatedCharWidth = fSize * 0.55;
      const textWidthEst = totalChars * estimatedCharWidth;
      const scalingWidth = (textWidthEst < zw * 0.8) ? textWidthEst : zw;
      let x = (scalingWidth < zw * 0.8) ? zx : zx;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const w = Math.max(8, Math.round(scalingWidth * (word.length / totalChars)));
        out.push({
          ...zone,
          ...inherited,
          id: `${zone.id}_w${i}`,
          content: word,
          x: Math.round(x),
          y: Math.round(zy),
          w,
          h: zh,
          readingOrder: nextRO++
        });
        x += w;
      }
    }
    const byRO = (a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999);
    return [...nonText, ...out].sort(byRO);
  }

  /**
   * Set of zone IDs that actually appear in the generated XHTML (for SMIL par filtering).
   * Sentence-level: one id per zone (outer tspan), no fragment ids.
   * @param {Array<{ id: string, content?: string, text?: string, lines?: Array }>} zones
   * @param {string} syncLevel
   * @returns {Set<string>}
   */
  static buildRenderedIdsForSmil(zones, syncLevel) {
    const set = new Set();
    for (const z of zones || []) {
      if (!((z.content || z.text || '').trim().length > 0)) continue;
      set.add(String(z.id || ''));
    }
    return set;
  }

  /**
   * Union of XHTML ids and Sync Studio alignment ids for this page so SMIL pars are not dropped when
   * word-level alignment.json ids and expandZonesToSyncLevelInMemory output drift (empty SMIL body).
   */
  static mergeRenderedIdsForSmilFilter(zonesForXhtmlPre, syncLevel, alignmentRowsForPage) {
    const merged = new Set(KitabooFxlService.buildRenderedIdsForSmil(zonesForXhtmlPre, syncLevel));
    for (const r of alignmentRowsForPage || []) {
      const id = String(r?.id || '').trim();
      if (id) merged.add(id);
    }
    return merged;
  }

  /**
   * When getAlignmentTime / zone grouping yields no pars but alignment.json has rows for this page,
   * emit one fragment per alignment row that passes mergeRenderedIdsForSmilFilter (avoids empty SMIL).
   */
  static buildSmilFragmentsFromAlignmentRows(zonesForXhtmlPre, syncLevel, alignmentRows) {
    if (!alignmentRows?.length) return [];
    const allowed = KitabooFxlService.mergeRenderedIdsForSmilFilter(zonesForXhtmlPre, syncLevel, alignmentRows);
    return alignmentRows
      .filter(r => allowed.has(String(r?.id || '').trim()))
      .map(r => ({
        id: String(r.id || '').trim(),
        startTime: r.startTime,
        endTime: r.endTime
      }));
  }

  /**
   * Align SMIL fragment IDs to the IDs that exist in the expanded XHTML.
   * If a fragment references a sentence id (e.g. p1_z0) but XHTML has word ids (p1_z0_w0, p1_z0_w1),
   * expand the fragment into one per word with proportional timing so the player can highlight.
   * @param {Array<{ id: string, startTime: number, endTime: number }>} fragments
   * @param {Array<{ id: string, content?: string, readingOrder?: number }>} expandedZones - From expandZonesToSyncLevelInMemory
   * @returns {Array<{ id: string, startTime: number, endTime: number }>}
   */
  static alignSmilFragmentsToExpandedZones(fragments, expandedZones) {
    if (!fragments?.length || !expandedZones?.length) return fragments || [];
    const idSet = new Set(expandedZones.map(z => z.id));
    const expandedById = new Map();
    expandedZones.forEach(z => {
      const base = String(z.id || '').replace(/_w\d+$/, '');
      if (!expandedById.has(base)) expandedById.set(base, []);
      expandedById.get(base).push(z);
    });
    expandedById.forEach((list) => list.sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999)));

    const out = [];
    for (const f of fragments) {
      const id = String(f.id || '').trim();
      if (!id) continue;
      if (idSet.has(id)) {
        out.push({ id: f.id, startTime: f.startTime, endTime: f.endTime });
        continue;
      }
      const children = expandedById.get(id) || expandedZones.filter(z => z.id === id || (String(z.id || '').startsWith(id + '_w')));
      if (children.length === 0) continue;
      const sorted = [...children].sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));
      const totalChars = sorted.reduce((sum, z) => sum + (z.content || '').length, 0);
      if (totalChars <= 0) {
        const step = (f.endTime - f.startTime) / sorted.length;
        sorted.forEach((z, i) => out.push({ id: z.id, startTime: f.startTime + i * step, endTime: f.startTime + (i + 1) * step }));
        continue;
      }
      let t = f.startTime;
      for (const z of sorted) {
        const chars = (z.content || '').length;
        const duration = (f.endTime - f.startTime) * (chars / totalChars);
        out.push({ id: z.id, startTime: t, endTime: t + duration });
        t += duration;
      }
    }
    // Word-level Sync Studio ids can mismatch expanded XHTML (z/w indexing); empty out would yield blank SMIL
    if (out.length === 0 && fragments.length > 0) {
      return fragments.map(f => ({ id: f.id, startTime: f.startTime, endTime: f.endTime }));
    }
    return out;
  }

  /**
   * Split current page zones by sync level (word or sentence).
   * useAI=true (default): call Gemini vision for box positions (exact word/sentence boxes).
   * useAI=false: proportional split from zone content + bounds — deterministic, correct order.
   * zonesFromClient: if provided, use these as the current page zones (exactly what user sees); else load from DB.
   * selectedIds: optional array of zone ids; when provided and non-empty, only those zones are split; others are left as-is.
   */
  static async splitZonesBySyncLevel(jobId, pageNumber, syncLevel, useAI = true, zonesFromClient = null, selectedIds = null) {
    const pageNum = parseInt(pageNumber, 10);
    const currentZones = Array.isArray(zonesFromClient) && zonesFromClient.length > 0
      ? zonesFromClient
      : ((await KitabooZoneModel.getZonesByJobId(jobId))[pageNum] || []);
    const textZones = currentZones.filter(z => (z.type === 'text' || z.type === 'header') && (z.content || '').trim());
    const nonTextZones = currentZones.filter(z => z.type !== 'text' && z.type !== 'header');

    if (textZones.length === 0) {
      return { zones: currentZones };
    }

    const idSet = Array.isArray(selectedIds) && selectedIds.length > 0 ? new Set(selectedIds) : null;
    const textZonesSorted = [...textZones].sort((a, b) => {
      const roA = a.readingOrder ?? 999;
      const roB = b.readingOrder ?? 999;
      if (roA !== roB) return roA - roB;
      return (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
    });
    let textZonesToSplit = idSet ? textZonesSorted.filter(z => idSet.has(z.id)) : textZonesSorted;
    let currentZonesForSplit = currentZones;

    // When user selects Sentence but stored zones are word-level, merge words into paragraphs first
    // so the sentence split runs on full paragraph text (one zone per base → many sentence zones).
    if (syncLevel === 'sentence' && textZonesToSplit.length > 0) {
      const allWordLevel = textZonesToSplit.every(z => /_w\d+$/.test(String(z.id || '')));
      if (allWordLevel) {
        const byBase = {};
        textZonesToSplit.forEach(z => {
          const id = String(z.id || '');
          const m = id.match(/^(.+)_w(\d+)$/);
          if (!m) return;
          const [, base, idx] = m;
          if (!byBase[base]) byBase[base] = [];
          byBase[base][parseInt(idx, 10)] = z;
        });
        const paragraphZones = [];
        for (const base of Object.keys(byBase)) {
          const list = byBase[base].filter(Boolean);
          const ordered = list
            .map((z, i) => ({ z, i }))
            .sort((a, b) => a.i - b.i)
            .map(({ z }) => z);
          const contents = ordered.map(z => (z.content || '').trim()).filter(Boolean);
          const xMin = Math.min(...ordered.map(z => Number(z.x ?? z.left ?? 0)));
          const yMin = Math.min(...ordered.map(z => Number(z.y ?? z.top ?? 0)));
          const xMax = Math.max(...ordered.map(z => Number(z.x ?? z.left ?? 0) + Number(z.w ?? z.width ?? 0)));
          const yMax = Math.max(...ordered.map(z => Number(z.y ?? z.top ?? 0) + Number(z.h ?? z.height ?? 0)));
          paragraphZones.push({
            id: base,
            type: 'text',
            content: contents.join(' '),
            x: Math.round(xMin),
            y: Math.round(yMin),
            w: Math.round(xMax - xMin),
            h: Math.round(yMax - yMin),
            readingOrder: ordered[0]?.readingOrder ?? 999
          });
        }
        paragraphZones.sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));
        textZonesToSplit = paragraphZones;
        currentZonesForSplit = [...nonTextZones, ...paragraphZones].sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));
      }
    }

    const proportionalChunksByZoneId = {};
    let nextReadingOrder = 1;
    for (const zone of textZonesToSplit) {
      const content = (zone.content || '').trim();
      const zx = Number(zone.x) || 0;
      const zy = Number(zone.y) || 0;
      const zw = Number(zone.w) || 100;
      const zh = Number(zone.h) || 20;
      const chunks = [];

      if (syncLevel === 'word') {
        const words = content.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) continue;
        const totalChars = words.reduce((s, w) => s + w.length, 0);

        // Inherit font/style properties from parent zone
        const inheritedProps = {};
        for (const key of ['fontSize', 'fontFamily', 'color', 'bold', 'italic', 'origin',
          'strokeColor', 'strokeWidth', 'letterSpacing', 'textShadow',
          'font', 'size', 'ascender', 'descender', 'rotation']) {
          if (zone[key] !== undefined && zone[key] !== null) inheritedProps[key] = zone[key];
        }

        // Kitaboo critical fix #4: Multi-line fragmentation — separate highlight zones per line
        // (shrink-wrapping by character count so highlight doesn't jump across whole block)
        const avgCharWidth = zw / Math.max(1, totalChars);
        const estimatedTotalWidth = totalChars * avgCharWidth;
        const estimatedLines = Math.max(1, Math.ceil(estimatedTotalWidth / zw));
        const lineHeight = Math.max(zh / estimatedLines, 12);

        // If text likely wraps (estimated width > zone width), create line fragments
        if (estimatedLines > 1 && words.length > 3) {
          // Group words into lines based on estimated character width
          const lines = [];
          let currentLine = [];
          let currentLineWidth = 0;

          for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordCharWidth = word.length * avgCharWidth;
            const spaceWidth = i > 0 ? avgCharWidth * 0.5 : 0;
            const totalWordWidth = wordCharWidth + spaceWidth;

            // Check if word would exceed line width (with some tolerance)
            if (currentLine.length > 0 && currentLineWidth + totalWordWidth > zw * 0.95) {
              lines.push([...currentLine]);
              currentLine = [];
              currentLineWidth = 0;
            }

            currentLine.push({ word, charWidth: wordCharWidth });
            currentLineWidth += totalWordWidth;
          }

          if (currentLine.length > 0) {
            lines.push(currentLine);
          }

          // Create line fragments with shrink-wrapped widths
          let charOffset = 0;
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const lineContent = line.map(w => w.word).join(' ');
            const lineCharCount = line.reduce((sum, w) => sum + w.word.length, 0);

            // Shrink-wrap calculation: width based on fragment characters
            const fragmentWidth = (lineCharCount / totalChars) * zw;

            // X-offset: start from zone x, but wrapped lines start at left margin
            const fragmentX = lineIdx === 0 ? zx : zx;

            // Y-offset: each line is offset by lineHeight
            const fragmentY = zy + (lineIdx * lineHeight);

            // Calculate precise width: from first word start to last word end
            // For first line: start at zone.x, end at zone.x + fragmentWidth
            // For wrapped lines: start at zone.x, end at zone.x + fragmentWidth
            const lineStartX = fragmentX;
            const lineEndX = fragmentX + fragmentWidth;
            const shrinkWrappedWidth = lineEndX - lineStartX;

            chunks.push({
              ...inheritedProps,
              id: `${zone.id}_frag${lineIdx}`,
              type: 'text',
              content: lineContent,
              x: Math.round(lineStartX),
              y: Math.round(fragmentY),
              w: Math.round(Math.max(shrinkWrappedWidth, 20)), // Min 20px width
              h: Math.round(lineHeight),
              readingOrder: nextReadingOrder++,
              isLineFragment: true,
              baseZoneId: zone.id,
              lineIndex: lineIdx,
              totalLines: lines.length
            });

            charOffset += lineCharCount;
          }
        } else {
          // Calculate a "tight" width for the text based on character counts and font size
          // to prevent scattering if the parent zone (zw) is unnecessarily wide.
          const fSize = inheritedProps.fontSize || 12;
          const estimatedCharWidth = fSize * 0.55; // Average for proportional fonts
          const textWidthEst = totalChars * estimatedCharWidth;

          // If the zone is significantly wider than the text, use the estimated width 
          // as the scaling basis to keep words together.
          const scalingWidth = (textWidthEst < zw * 0.8) ? textWidthEst : zw;
          const startX = (scalingWidth < zw * 0.8) ? zx : zx; // Default to left-align for now

          let x = startX;
          for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const w = Math.max(8, Math.round(scalingWidth * (word.length / totalChars)));
            chunks.push({
              ...inheritedProps,
              id: `${zone.id}_w${i}`,
              type: 'text',
              content: word,
              x: Math.round(x),
              y: Math.round(zy),
              w,
              h: zh,
              readingOrder: nextReadingOrder++
            });
            x += w;
          }
        }
      } else {
        // Sentence-level: split by . ! ? ; (sentence/clause boundaries). Fallbacks: semicolons (e.g. Image Credits), then newlines.
        let sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
        if (sentences.length <= 1 && (content || '').includes(';')) {
          sentences = content.split(/\s*;\s*/).map(s => s.trim()).filter(s => s.length > 0);
        }
        if (sentences.length <= 1 && (content || '').includes('\n')) {
          sentences = content.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
        }
        const parts = sentences.length >= 1 ? sentences : [content];
        const totalChars = (content || '').split(/\s+/).filter(w => w.length > 0).reduce((s, w) => s + w.length, 0);

        // Inherit font/style properties from parent zone
        const inheritedProps = {};
        for (const key of ['fontSize', 'fontFamily', 'color', 'bold', 'italic', 'origin',
          'strokeColor', 'strokeWidth', 'letterSpacing', 'textShadow',
          'font', 'size', 'ascender', 'descender', 'rotation']) {
          if (zone[key] !== undefined && zone[key] !== null) inheritedProps[key] = zone[key];
        }

        for (let sentIdx = 0; sentIdx < parts.length; sentIdx++) {
          const sentence = parts[sentIdx].trim();
          const sentenceWords = sentence.split(/\s+/).filter(w => w.length > 0);
          const sentenceChars = sentenceWords.reduce((sum, w) => sum + w.length, 0);

          // Estimate if this sentence wraps across multiple lines
          const avgCharWidth = zw / Math.max(1, totalChars);
          const estimatedSentenceWidth = sentenceChars * avgCharWidth;
          const estimatedLines = Math.max(1, Math.ceil(estimatedSentenceWidth / zw));
          const lineHeight = Math.max(zh / Math.max(parts.length, estimatedLines), 12);

          // If sentence likely wraps (estimated width > zone width), create line fragments
          if (estimatedLines > 1 && sentenceWords.length > 3) {
            // Group words into lines for this sentence
            const lines = [];
            let currentLine = [];
            let currentLineWidth = 0;

            for (let i = 0; i < sentenceWords.length; i++) {
              const word = sentenceWords[i];
              const wordCharWidth = word.length * avgCharWidth;
              const spaceWidth = i > 0 ? avgCharWidth * 0.5 : 0;
              const totalWordWidth = wordCharWidth + spaceWidth;

              // Check if word would exceed line width
              if (currentLine.length > 0 && currentLineWidth + totalWordWidth > zw * 0.95) {
                lines.push([...currentLine]);
                currentLine = [];
                currentLineWidth = 0;
              }

              currentLine.push({ word, charWidth: wordCharWidth });
              currentLineWidth += totalWordWidth;
            }

            if (currentLine.length > 0) {
              lines.push(currentLine);
            }

            // Create line fragments for this sentence with shrink-wrapped widths
            const sentenceY = zy + (sentIdx * (zh / parts.length));
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];
              const lineContent = line.map(w => w.word).join(' ');
              const lineCharCount = line.reduce((sum, w) => sum + w.word.length, 0);

              // Shrink-wrap calculation: width based on fragment characters
              const fragmentWidth = (lineCharCount / sentenceChars) * zw;

              // X-offset: first line of sentence starts at zone.x, wrapped lines at left margin
              const fragmentX = (sentIdx === 0 && lineIdx === 0) ? zx : zx;

              // Y-offset: each line is offset by lineHeight
              const fragmentY = sentenceY + (lineIdx * lineHeight);

              chunks.push({
                ...inheritedProps,
                id: `${zone.id}_s${sentIdx}_frag${lineIdx}`,
                type: 'text',
                content: lineContent,
                x: Math.round(fragmentX),
                y: Math.round(fragmentY),
                w: Math.round(Math.max(fragmentWidth, 20)), // Min 20px width
                h: Math.round(lineHeight),
                readingOrder: nextReadingOrder++,
                isLineFragment: true,
                baseZoneId: `${zone.id}_s${sentIdx}`, // Base ID is the sentence ID
                lineIndex: lineIdx,
                totalLines: lines.length,
                sentenceIndex: sentIdx
              });
            }
          } else {
            // Single-line sentence: create traditional sentence chunk
            const rowHeight = zh / parts.length;
            chunks.push({
              ...inheritedProps,
              id: `${zone.id}_s${sentIdx}`,
              type: 'text',
              content: sentence,
              x: zx,
              y: Math.round(zy + sentIdx * rowHeight),
              w: zw,
              h: Math.round(rowHeight),
              readingOrder: nextReadingOrder++
            });
          }
        }
      }
      proportionalChunksByZoneId[zone.id] = chunks;
    }

    const ro = (z) => z.readingOrder ?? 999;
    const allOrdered = [...currentZonesForSplit].sort((a, b) => ro(a) - ro(b) || (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
    const out = [];
    for (const z of allOrdered) {
      const chunks = idSet
        ? (idSet.has(z.id) ? proportionalChunksByZoneId[z.id] : null)
        : proportionalChunksByZoneId[z.id];
      if (chunks && chunks.length) {
        out.push(...chunks);
      } else {
        out.push(z);
      }
    }
    const zonesProportional = out.map((z, i) => ({ ...z, readingOrder: i + 1 }));

    if (!useAI) {
      return { zones: zonesProportional };
    }

    // AI path: load image and call Gemini. On timeout or error, fall back to proportional zones.
    const AI_TIMEOUT_MS = 180000; // 3 min - then fall back to proportional so user gets boxes
    try {
      const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
      const webpDir = path.join(intermediateDir, 'webp');
      let imagePath;
      let dimensions;
      try {
        const files = await fs.readdir(webpDir);
        const webpFiles = files.filter(f => f.endsWith('.webp'));
        webpFiles.sort((a, b) => {
          const na = parseInt(a.match(/page_?(\d+)/i)?.[1] || '0', 10);
          const nb = parseInt(b.match(/page_?(\d+)/i)?.[1] || '0', 10);
          return na - nb;
        });
        const fileForPage = webpFiles[pageNum - 1];
        if (!fileForPage) throw new Error(`No webp found for page ${pageNum}`);
        imagePath = path.join(webpDir, fileForPage);
        const meta = await sharp(imagePath).metadata();
        dimensions = { width: meta.width, height: meta.height };
      } catch (e) {
        throw new Error(`Page image not found for job ${jobId} page ${pageNum}: ${e.message}`);
      }

      const levelLabel = syncLevel === 'word' ? 'WORD' : 'SENTENCE';
      const idSuffix = syncLevel === 'word' ? '_w' : '_s';
      const unitName = syncLevel === 'word' ? 'word' : 'sentence';

      const imgW = dimensions.width;
      const imgH = dimensions.height;
      const zonesContext = textZones.map(z => {
        const cx = Math.round(Number(z.x) || 0);
        const cy = Math.round(Number(z.y) || 0);
        const cw = Math.round(Number(z.w) || 100);
        const ch = Math.round(Number(z.h) || 20);
        return `id: ${z.id}, content: "${(z.content || '').trim()}", region (pixels): left=${cx} top=${cy} width=${cw} height=${ch}`;
      }).join('\n');

      const prompt = syncLevel === 'word' ? `
You are analyzing a page image to detect WORD-LEVEL bounding boxes and ARTISTIC STYLES. 

**IMAGE:** ${imgW} px wide × ${imgH} px tall. Origin (0,0) = TOP-LEFT.

**TASK:** For each zone, find each COMPLETE WORD and its visual style.
Return:
- id: e.g. p1_z1_w0
- content: the word
- box_2d: [xmin, ymin, xmax, ymax] (pixels)
- color: text fill color (hex)
- strokeColor: text outline/border color if any (hex)
- strokeWidth: width of outline in pixels

**ARTISTIC TITLES:** For big titles, identify if they have a colored border (stroke).
Return ONLY the JSON array.
` : `
You are analyzing a page image to detect SENTENCE-LEVEL bounding boxes and ARTISTIC STYLES.

**IMAGE:** ${imgW} px wide × ${imgH} px tall.

**TASK:** For each zone, return one bounding box per COMPLETE SENTENCE.
Return:
- id: baseZoneId_s{index}
- content: the sentence text
- box_2d: [xmin, ymin, xmax, ymax] (pixels)
- color: text fill color (hex)
- strokeColor: text outline color if any (hex)
- strokeWidth: width of outline in pixels

Return ONLY the JSON array.
`;

      const imageBase64 = (await fs.readFile(imagePath)).toString('base64');
      const geminiPromise = GeminiService.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'image/webp', data: imageBase64 } }
      ]);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI timeout')), AI_TIMEOUT_MS)
      );
      const response = await Promise.race([geminiPromise, timeoutPromise]);

      if (!response) return { zones: zonesProportional };

      const cleaned = (response || '').replace(/```json|```/g, '').trim();
      let subZones;
      try {
        subZones = JSON.parse(cleaned);
      } catch {
        return { zones: zonesProportional };
      }

      if (!Array.isArray(subZones) || subZones.length === 0) return { zones: zonesProportional };

      // box_2d: [xmin, ymin, xmax, ymax] in pixels, or normalized 0-1 / 0-1000.
      const toPixelBox = (box4) => {
        const [a, b, c, d] = box4.map(Number);
        const xmin = Math.min(a, c);
        const xmax = Math.max(a, c);
        const yTop = Math.min(b, d);
        const yBottom = Math.max(b, d);
        const allNorm01 = [a, b, c, d].every(v => !Number.isNaN(v) && v >= 0 && v <= 1.01);
        if (allNorm01) {
          return {
            x: xmin * imgW,
            y: yTop * imgH,
            w: (xmax - xmin) * imgW,
            h: (yBottom - yTop) * imgH
          };
        }
        const fitsAsPixels = xmax <= imgW * 1.02 && yBottom <= imgH * 1.02 && xmin >= -5 && yTop >= -5 && xmax > xmin && yBottom > yTop;
        if (fitsAsPixels) {
          return { x: xmin, y: yTop, w: xmax - xmin, h: yBottom - yTop };
        }
        const allNorm1000 = [a, b, c, d].every(v => !Number.isNaN(v) && v >= 0 && v <= 1000);
        if (allNorm1000) {
          return {
            x: (xmin / 1000) * imgW,
            y: (yTop / 1000) * imgH,
            w: ((xmax - xmin) / 1000) * imgW,
            h: ((yBottom - yTop) / 1000) * imgH
          };
        }
        return { x: xmin, y: yTop, w: xmax - xmin, h: yBottom - yTop };
      };

      console.log(`[KitabooFXL] AI ${syncLevel}-level: image ${imgW}x${imgH}, got ${subZones.length} boxes`);

      // Map parent zones for property inheritance
      const parentZoneLookup = Object.fromEntries(textZonesToSplit.map(z => [String(z.id || ''), z]));

      const pixelZones = subZones
        .filter(z => {
          if (!Array.isArray(z.box_2d) || z.box_2d.length !== 4) return false;
          if (!(z.content || '').trim()) return false;
          return true;
        })
        .map((z, idx) => {
          let { x, y, w, h } = toPixelBox(z.box_2d);
          const nudgeDown = Math.min(6, Math.max(1, Math.round(0.05 * h)));
          y = y + nudgeDown;

          // Scale strokeWidth if it was given in normalized 1000-scale
          let sWidth = z.strokeWidth ? parseFloat(z.strokeWidth) : null;
          if (sWidth && [z.box_2d[0], z.box_2d[1], z.box_2d[2], z.box_2d[3]].every(v => v >= 0 && v <= 1000)) {
            sWidth = (sWidth / 1000) * imgW;
          }

          // Inherit properties from parent zone if ID pattern matches
          let inheritedProps = {};
          const baseIdForInherit = (z.id || '').replace(/(_w|_s|_frag)\d+$/, '');
          const parent = parentZoneLookup[baseIdForInherit];
          if (parent) {
            for (const key of ['fontSize', 'fontFamily', 'color', 'bold', 'italic', 'origin',
              'strokeColor', 'strokeWidth', 'letterSpacing', 'textShadow',
              'font', 'size', 'ascender', 'descender', 'rotation']) {
              if (parent[key] !== undefined && parent[key] !== null) inheritedProps[key] = parent[key];
            }
          }

          return {
            ...inheritedProps,
            id: z.id || `p${pageNum}_z${idx}`,
            type: z.type || 'text',
            content: (z.content || '').trim(),
            x: Math.round(Math.max(0, Math.min(imgW - 1, x))),
            y: Math.round(Math.max(0, Math.min(imgH - 1, y))),
            w: Math.round(Math.max(1, Math.min(imgW - x, w))),
            h: Math.round(Math.max(1, Math.min(imgH - y, h))),
            readingOrder: idx + 1,
            // AI-detected styles override only if provided
            ...(z.color && { color: z.color }),
            ...(z.strokeColor && { strokeColor: z.strokeColor }),
            ...(sWidth && { strokeWidth: parseFloat(sWidth.toFixed(2)) })
          };
        })

        .filter(z => z.w > 0 && z.h > 0)
        .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))
        .map((z, idx) => ({ ...z, readingOrder: idx + 1 }));

      // Sentence-level: if AI returned only one box per zone (paragraph-level), use proportional sentence chunks instead
      const expectedSentenceChunks = syncLevel === 'sentence'
        ? textZonesToSplit.reduce((sum, z) => sum + (proportionalChunksByZoneId[z.id]?.length || 0), 0)
        : 0;
      if (syncLevel === 'sentence' && expectedSentenceChunks > 0 && pixelZones.length <= textZonesToSplit.length) {
        console.log(`[KitabooFXL] Sentence level: AI returned ${pixelZones.length} box(es) but expected ${expectedSentenceChunks} sentence chunks. Using proportional sentence zones.`);
        return { zones: zonesProportional };
      }

      // Reindex word-level ids so they are contiguous per base (avoids w0,w1,w2,w4,w5 when w3 was filtered)
      if (syncLevel === 'word') {
        const byBase = {};
        pixelZones.forEach((z) => {
          const m = (z.id || '').match(/^(.+)_w\d+$/);
          if (!m) return;
          const base = m[1];
          if (!byBase[base]) byBase[base] = [];
          byBase[base].push(z);
        });
        Object.entries(byBase).forEach(([base, arr]) => {
          arr.sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0) || ((a.id || '').localeCompare(b.id || '')));
          arr.forEach((z, i) => { z.id = `${base}_w${i}`; });
        });
      }

      // Sanity check: if we got way too many zones, likely character-level detection
      const totalWordsInZones = textZones.reduce((sum, z) => {
        const words = (z.content || '').split(/\s+/).filter(w => w.length > 0);
        return sum + words.length;
      }, 0);

      if (syncLevel === 'word' && pixelZones.length > totalWordsInZones * 2) {
        console.warn(`[KitabooFXL] Warning: Got ${pixelZones.length} zones but expected ~${totalWordsInZones} words. This suggests character-level detection. Attempting to merge adjacent small boxes...`);

        // Group boxes by approximate row (y position within 10px)
        const rows = {};
        pixelZones.forEach(z => {
          const rowKey = Math.round(z.y / 10) * 10;
          if (!rows[rowKey]) rows[rowKey] = [];
          rows[rowKey].push(z);
        });

        // Merge small adjacent boxes in each row
        const mergedZones = [];
        Object.keys(rows).sort((a, b) => parseInt(a) - parseInt(b)).forEach(rowKey => {
          const row = rows[rowKey].sort((a, b) => a.x - b.x);
          let currentGroup = null;

          row.forEach(box => {
            if (!currentGroup) {
              currentGroup = { ...box };
            } else if (box.w < 30 && Math.abs(box.x - (currentGroup.x + currentGroup.w)) < 8 && Math.abs(box.y - currentGroup.y) < 10) {
              // Merge: extend width, combine content
              currentGroup.w = (box.x + box.w) - currentGroup.x;
              currentGroup.h = Math.max(currentGroup.h, box.h);
              currentGroup.content = (currentGroup.content + box.content).replace(/\s+/g, '');
            } else {
              // Start new group
              mergedZones.push(currentGroup);
              currentGroup = { ...box };
            }
          });
          if (currentGroup) mergedZones.push(currentGroup);
        });

        console.log(`[KitabooFXL] Merged ${pixelZones.length} character-level boxes down to ${mergedZones.length} word-level boxes`);
        pixelZones.splice(0, pixelZones.length, ...mergedZones);
        // Re-sort after merging
        pixelZones.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
        pixelZones.forEach((z, idx) => { z.readingOrder = idx + 1; });
      }

      const otherZones = currentZones.filter(z => z.type !== 'text' && z.type !== 'header');
      const mergedAI = [...otherZones, ...pixelZones].sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      return { zones: mergedAI.map((z, i) => ({ ...z, readingOrder: i + 1 })) };
    } catch (aiErr) {
      console.warn(`[KitabooFXL] AI path failed (timeout or error), using proportional zones: ${aiErr?.message || aiErr}`);
      return { zones: zonesProportional };
    }
  }

  /**
   * Phase 2: Automated Zoning using Gemini Vision
   */
  static async performAutomatedZoning(assets, jobId) {
    const allZones = [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      console.log(`[KitabooFXL] Zoning page ${i + 1}...`);

      const prompt = `
        Identify all interactive zones (text, headers, images).
        For each zone, extract:
        - type: "text" | "image" | "button" | "header"
        - content: the text content (if any)
        - id: a unique identifier (e.g., p1_z1)
        - box_2d: [ymin, xmin, ymax, xmax] in normalized coordinates (0-1000)
        - color: the text fill color (CSS hex, e.g. #FFFFFF)
        - strokeColor: the text outline color if any (CSS hex)
        - strokeWidth: the width of the outline in pixels (relative to 1000px scale)
        
        CRITICAL: For artistic titles (headers), accurately identify the fill color and stroke color to match the visual style of the PDF.
        ONLY return the JSON array.

      `;

      const response = await GeminiService.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'image/webp', data: Buffer.from(await fs.readFile(asset.path)).toString('base64') } }
      ]);

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        if (!response) {
          allZones.push([]);
          continue;
        }

        const cleanedResponse = response.replace(/```json|```/g, '').trim();
        const zones = JSON.parse(cleanedResponse);

        const pixelZones = zones
          .filter(zone => Array.isArray(zone.box_2d) && zone.box_2d.length === 4)
          .map(zone => {
            const [ymin, xmin, ymax, xmax] = zone.box_2d;
            const w = ((xmax - xmin) / 1000) * asset.dimensions.width;
            const h = ((ymax - ymin) / 1000) * asset.dimensions.height;

            // Map AI style guesses
            const sWidth = zone.strokeWidth ? parseFloat(zone.strokeWidth) : null;
            // Scale strokeWidth from 1000px coordinate space to actual pixels
            const scaledStrokeWidth = sWidth ? (sWidth / 1000) * asset.dimensions.width : null;

            return {
              ...zone,
              x: (xmin / 1000) * asset.dimensions.width,
              y: (ymin / 1000) * asset.dimensions.height,
              w: w,
              h: h,
              color: zone.color || null,
              strokeColor: zone.strokeColor || null,
              strokeWidth: scaledStrokeWidth ? parseFloat(scaledStrokeWidth.toFixed(2)) : null
            };
          });

        allZones.push(pixelZones);

      } catch (err) {
        allZones.push([]);
      }
    }

    return allZones;
  }

  /**
   * When syncLevel is 'sentence' but stored zones are word-level (e.g. from a previous Word split),
   * merge consecutive word zones (id ending _w0, _w1, ...) into sentence-level zones (base_s0, base_s1)
   * by grouping on sentence boundaries (. ! ? ; or newline in content).
   */
  static coalesceWordZonesToSentenceZones(zones) {
    if (!Array.isArray(zones) || zones.length === 0) return zones;
    const wordZones = zones.filter(z => /_w\d+$/.test(String(z.id || '')));
    if (wordZones.length === 0) return zones;
    const nonWordZones = zones.filter(z => !/_w\d+$/.test(String(z.id || '')));
    const byBase = {};
    wordZones.forEach(z => {
      const id = String(z.id || '');
      const match = id.match(/^(.+)_w(\d+)$/);
      if (!match) return;
      const [, base, idx] = match;
      if (!byBase[base]) byBase[base] = [];
      byBase[base][parseInt(idx, 10)] = z;
    });
    const sentenceZones = [];
    for (const base of Object.keys(byBase)) {
      const list = byBase[base].filter(Boolean);
      const ordered = list
        .map((z, i) => ({ z, i }))
        .sort((a, b) => a.i - b.i)
        .map(({ z }) => z);
      let sentenceIdx = 0;
      let currentWords = [];
      let currentRects = [];
      let readingOrder = ordered[0]?.readingOrder ?? 999;
      for (let i = 0; i < ordered.length; i++) {
        const z = ordered[i];
        const content = (z.content || '').trim();
        currentWords.push(content);
        const x = Number(z.x ?? z.left ?? 0);
        const y = Number(z.y ?? z.top ?? 0);
        const w = Number(z.w ?? z.width ?? 0);
        const h = Number(z.h ?? z.height ?? 0);
        currentRects.push({ x, y, w, h });
        const endsSentence = /[.!?;]\s*$/.test(content) || /\n/.test(content);
        if (endsSentence || i === ordered.length - 1) {
          const sentenceContent = currentWords.join(' ').trim();
          if (sentenceContent) {
            const xMin = Math.min(...currentRects.map(r => r.x));
            const yMin = Math.min(...currentRects.map(r => r.y));
            const xMax = Math.max(...currentRects.map(r => r.x + r.w));
            const yMax = Math.max(...currentRects.map(r => r.y + r.h));
            const mergedZone = {
              id: `${base}_s${sentenceIdx}`,
              type: z.type || 'text',
              content: sentenceContent,
              x: Math.round(xMin),
              y: Math.round(yMin),
              w: Math.round(xMax - xMin),
              h: Math.round(yMax - yMin),
              readingOrder: readingOrder + sentenceIdx
            };
            // Merge word-level styleRuns into sentence zone so EPUB SVG layer shows bold/italic/color per word
            const startIdx = i - currentWords.length + 1;
            let charOffset = 0;
            const styleRuns = [];
            for (let wi = 0; wi < currentWords.length; wi++) {
              const wz = ordered[startIdx + wi];
              const wordContent = (wz.content || '').trim();
              const runStart = charOffset;
              const runEnd = charOffset + wordContent.length;
              if (Array.isArray(wz.styleRuns) && wz.styleRuns.length > 0) {
                wz.styleRuns.forEach(r => {
                  const s = Math.max(r.start, 0);
                  const e = Math.min(r.end, wordContent.length);
                  if (e > s) styleRuns.push({ start: runStart + s, end: runStart + e, bold: !!r.bold, italic: !!r.italic, color: r.color || wz.color || '#000000' });
                });
              } else if (wordContent.length > 0 && (wz.bold || wz.italic || wz.color)) {
                styleRuns.push({ start: runStart, end: runEnd, bold: !!wz.bold, italic: !!wz.italic, color: wz.color || '#000000' });
              }
              charOffset = runEnd + 1;
            }
            if (styleRuns.length > 0) mergedZone.styleRuns = styleRuns;
            sentenceZones.push(mergedZone);
            sentenceIdx++;
          }
          currentWords = [];
          currentRects = [];
        }
      }
    }
    const out = [...nonWordZones, ...sentenceZones].sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));
    return out;
  }

  /**
   * At publish time, expand paragraph zones into sentence-level zones with true
   * Fragmented Line-Mapping: one layout for the whole paragraph so sentences that
   * share a line (e.g. "muscles. A horse") get correct x positions (Fragment A at
   * end of line 1, Fragment B at start of line 2).
   * Only runs when syncLevel is 'sentence'. Zones that are already sentence-level are left as-is.
   */
  static expandZonesToSentenceLevel(zones, syncLevel) {
    if (syncLevel !== 'sentence' || !Array.isArray(zones)) return zones;
    const out = [];
    for (const z of zones) {
      if ((z.type !== 'text' && z.type !== 'header') || !(z.content || '').trim()) {
        out.push(z);
        continue;
      }
      const id = (z.id || '').toString();
      if (/_s\d+(_frag\d+)?$/.test(id)) {
        out.push(z);
        continue;
      }
      const content = (z.content || '').trim();
      let sentences = content.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      if (sentences.length <= 1 && content.includes(';')) {
        sentences = content.split(/\s*;\s*/).map(s => s.trim()).filter(s => s.length > 0);
      }
      if (sentences.length <= 1 && content.includes('\n')) {
        sentences = content.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
      }
      const parts = sentences.length >= 1 ? sentences : [content];
      if (parts.length <= 1) {
        out.push(z);
        continue;
      }
      const zx = Number(z.x) || 0;
      const zy = Number(z.y) || 0;
      const zw = Number(z.w) || 100;
      const zh = Number(z.h) || 20;
      const totalChars = (content || '').split(/\s+/).filter(w => w.length > 0).reduce((s, w) => s + w.length, 0);
      const avgCharWidth = totalChars > 0 ? zw / totalChars : zw / 20;
      const spaceWidth = avgCharWidth * 0.5;

      // 1. Build flat word list with sentence index
      const allWords = [];
      parts.forEach((sent, sentIdx) => {
        sent.trim().split(/\s+/).filter(w => w.length > 0).forEach(word => {
          allWords.push({ word, sentenceIndex: sentIdx });
        });
      });
      if (allWords.length === 0) {
        out.push(z);
        continue;
      }

      // 2. Line-break the whole paragraph (words fill lines left to right)
      const lines = [];
      let currentLine = [];
      let currentLineWidth = 0;
      for (let i = 0; i < allWords.length; i++) {
        const { word } = allWords[i];
        const wordWidth = word.length * avgCharWidth + (i > 0 ? spaceWidth : 0);
        if (currentLine.length > 0 && currentLineWidth + wordWidth > zw * 0.98) {
          lines.push([...currentLine]);
          currentLine = [];
          currentLineWidth = 0;
        }
        const w = word.length * avgCharWidth;
        currentLine.push({ word, sentenceIndex: allWords[i].sentenceIndex, w });
        currentLineWidth += (currentLine.length >= 1 ? spaceWidth : 0) + w;
      }
      if (currentLine.length > 0) lines.push(currentLine);

      const lineHeight = Math.max(zh / lines.length, 12);
      let nextRo = z.readingOrder ?? 999;

      // 3. Assign x position to each word on each line (cumulative)
      const wordPositions = [];
      let globalIdx = 0;
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        let x = zx;
        for (let i = 0; i < line.length; i++) {
          const token = line[i];
          wordPositions.push({
            word: token.word,
            sentenceIndex: token.sentenceIndex,
            lineIndex: lineIdx,
            x,
            w: token.w,
            y: zy + lineIdx * lineHeight
          });
          x += token.w + (i < line.length - 1 ? spaceWidth : 0);
          globalIdx++;
        }
      }

      // 4. Group by (sentenceIndex, lineIndex) and emit one zone per fragment
      const fragmentKey = (si, li) => `${si}_${li}`;
      const groups = {};
      wordPositions.forEach(wp => {
        const key = fragmentKey(wp.sentenceIndex, wp.lineIndex);
        if (!groups[key]) groups[key] = [];
        groups[key].push(wp);
      });

      const orderedKeys = Object.keys(groups).sort((a, b) => {
        const [sa, la] = a.split('_').map(Number);
        const [sb, lb] = b.split('_').map(Number);
        return la !== lb ? la - lb : sa - sb;
      });

      for (const key of orderedKeys) {
        const [sentIdx, lineIdx] = key.split('_').map(Number);
        const group = groups[key];
        const first = group[0];
        const last = group[group.length - 1];
        const fragmentX = first.x;
        const fragmentW = (last.x + last.w) - first.x;
        const fragmentY = first.y;
        const fragmentContent = group.map(g => g.word).join(' ');
        const sentId = `${id}_s${sentIdx}`;
        const isMultiLine = orderedKeys.filter(k => k.startsWith(`${sentIdx}_`)).length > 1;

        out.push({
          ...z,
          id: isMultiLine ? `${sentId}_frag${lineIdx}` : sentId,
          content: fragmentContent,
          x: Math.round(fragmentX),
          y: Math.round(fragmentY),
          w: Math.round(Math.max(fragmentW, 20)),
          h: Math.round(lineHeight),
          readingOrder: nextRo++,
          isLineFragment: isMultiLine,
          baseZoneId: isMultiLine ? sentId : undefined,
          lineIndex: isMultiLine ? lineIdx : undefined,
          totalLines: isMultiLine ? orderedKeys.filter(k => k.startsWith(`${sentIdx}_`)).length : undefined
        });
      }
    }
    return out.sort((a, b) => (a.readingOrder ?? 999) - (b.readingOrder ?? 999));
  }

  /**
   * Parse page number from zone id (e.g. p1_z1_s0 → 1, p2_z3 → 2).
   * Used for Global Offset Mapping to assign aligned segments back to pages.
   */
  static getPageNumFromZoneId(zoneId) {
    if (!zoneId || typeof zoneId !== 'string') return 1;
    const m = zoneId.match(/^p(\d+)_/);
    return m ? parseInt(m[1], 10) : 1;
  }

  /**
   * Keep only the first occurrence per zone in alignment (first contiguous block in time).
   * Ensures Page 1 shows only the first time each zone is spoken, not every occurrence in the book.
   * @param {Array<{id: string, startTime: number, endTime: number}>} globalAlignment
   * @param {Array<{id: string, text: string}>} combinedSegments - zones in reading order
   * @returns {Array<{id: string, startTime: number, endTime: number}>}
   */
  static keepFirstOccurrencePerZone(globalAlignment, combinedSegments) {
    if (!globalAlignment?.length || !combinedSegments?.length) return globalAlignment || [];

    const baseId = (id) => (id || '').replace(/_w\d+$/, '');
    const byBase = {};
    for (const r of globalAlignment) {
      const b = baseId(r.id);
      if (!byBase[b]) byBase[b] = [];
      byBase[b].push({ ...r });
    }
    const CONTIGUOUS_GAP_SEC = 1.5;
    const firstRunByBase = {};
    for (const b of Object.keys(byBase)) {
      const list = byBase[b].sort((a, b2) => {
        const t = (a.startTime || 0) - (b2.startTime || 0);
        if (t !== 0) return t;
        const wa = (String(a.id).match(/_w(\d+)$/) || [])[1];
        const wb = (String(b2.id).match(/_w(\d+)$/) || [])[1];
        return (parseInt(wa, 10) || 0) - (parseInt(wb, 10) || 0);
      });
      const run = [];
      let lastEnd = -1;
      for (const seg of list) {
        const start = Number(seg.startTime) || 0;
        if (run.length === 0 || start <= lastEnd + CONTIGUOUS_GAP_SEC) {
          run.push(seg);
          lastEnd = Math.max(lastEnd, Number(seg.endTime) || 0);
        } else break;
      }
      firstRunByBase[b] = run;
    }
    const seen = new Set();
    const result = [];
    for (const s of combinedSegments) {
      const b = baseId(s.id);
      if (seen.has(b)) continue;
      seen.add(b);
      const run = firstRunByBase[b];
      if (run?.length) result.push(...run);
    }
    return result;
  }

  /**
   * Run global alignment for FXL Sync Studio (one long audio + all zones).
   * Writes alignment.json to intermediate dir and returns segments.
   * @param {string} jobId
   * @param {Object} [options] - { skipPages: number[], manualPageBoundaries: Array<{page,start,end}> }
   * @returns {Promise<{ segments: Array<{ id, startTime, endTime }> }>}
   */
  static async runGlobalAlignmentForSyncStudio(jobId, options = {}) {
    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    const humanAudioDir = path.join(intermediateDir, 'human_audio');
    const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
    let singleBookAudioPath = null;
    let perPageAudioPages = [];
    try {
      const files = await fs.readdir(humanAudioDir);
      const audioExt = ['.mp3', '.wav', '.m4a'];
      const audioFiles = files.filter(f => audioExt.some(ext => f.toLowerCase().endsWith(ext)));
      for (const name of singleBookNames) {
        if (files.includes(name)) {
          singleBookAudioPath = path.join(humanAudioDir, name);
          break;
        }
      }
      if (!singleBookAudioPath && audioFiles.length === 1) {
        singleBookAudioPath = path.join(humanAudioDir, audioFiles[0]);
      }
      // Per-page MP3: page_1.mp3, page_2.mp3, ...
      perPageAudioPages = files
        .filter(f => /^page_(\d+)\.(mp3|wav|m4a)$/i.test(f))
        .map(f => parseInt(f.match(/^page_(\d+)\./i)[1], 10))
        .sort((a, b) => a - b);
    } catch (_) { }

    const usePerPageAudio = (options.usePerPageAudio === true || options.usePerPageAudio === 'true') && perPageAudioPages.length > 0;
    if (usePerPageAudio) {
      return KitabooFxlService.runPerPageAlignmentForSyncStudio(jobId, intermediateDir, humanAudioDir, perPageAudioPages, options);
    }

    if (!singleBookAudioPath) {
      throw new Error('No single-book audio found. Upload narration.mp3 (one file for all pages) or use "MP3 per page" to upload one file per page.');
    }

    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    let pagesWithZones = KitabooFxlService.buildPagesWithZonesNormalized(zonesByPage);

    const skipPagesEnv = process.env.SKIP_ALIGNMENT_PAGES;
    const skipPagesFromEnv = skipPagesEnv ? skipPagesEnv.split(',').map(Number).filter(n => n > 0) : [];
    const skipPages = Array.isArray(options.skipPages) && options.skipPages.length > 0
      ? options.skipPages
      : skipPagesFromEnv;
    if (skipPages.length > 0) {
      console.log(`[KitabooFXL] Skipping alignment for pages: ${skipPages.join(', ')}`);
      pagesWithZones = pagesWithZones.filter(p => !skipPages.includes(p.pageNum));
    }

    const combinedSegments = [];
    for (const pwz of pagesWithZones) {
      for (const z of pwz.textZones) {
        combinedSegments.push({ id: z.id, text: z.content || '' });
      }
    }
    if (combinedSegments.length === 0) {
      throw new Error('No text zones found. Add zones in Zoning Studio first.');
    }

    const sanitized = await sanitizeZoneText(combinedSegments);
    const segmentsForAlign = sanitized.filter(s => (s.text || '').trim().length > 0);

    const useWhisperAlignment = process.env.USE_WHISPER_ALIGNMENT === '1';
    const useAeneasFirst = process.env.USE_AENEAS_FIRST === '1';
    let globalAlignment = [];
    const mfaPathsSet = process.env.MFA_DICTIONARY_PATH && process.env.MFA_ACOUSTIC_MODEL_PATH;

    if (process.env.USE_MFA === '1' && mfaPathsSet) {
      try {
        const mfaAvailable = await mfaService.isMfaAvailable();
        if (mfaAvailable) {
          globalAlignment = await mfaService.alignPlainSegments(singleBookAudioPath, segmentsForAlign, {
            language: 'eng',
            dictionaryPath: process.env.MFA_DICTIONARY_PATH,
            acousticModelPath: process.env.MFA_ACOUSTIC_MODEL_PATH
          });
          if (globalAlignment.length > 0) {
            globalAlignment = await aeneasService.refinePlainSegmentResults(singleBookAudioPath, globalAlignment, 0.3);
          }
        }
      } catch (_) { }
    }

    if (globalAlignment.length === 0 && useAeneasFirst) {
      try {
        console.log('[KitabooFXL] Trying Aeneas forced alignment first (zone text → audio phonemes)');
        globalAlignment = await aeneasService.alignPlainSegments(singleBookAudioPath, segmentsForAlign, {
          language: 'eng',
          applySilenceSnapping: true
        });
        if (globalAlignment.length > 0) {
          const maxDur = Math.max(...globalAlignment.map(r => (r.endTime || 0) - (r.startTime || 0)));
          if (maxDur > 60) {
            console.log('[KitabooFXL] Aeneas produced ghost segment (' + maxDur.toFixed(0) + 's), falling back');
            globalAlignment = [];
          }
        }
      } catch (_) { }
    }

    if (globalAlignment.length === 0 && useWhisperAlignment) {
      try {
        const available = await whisperAlignmentService.isWhisperAvailable();
        if (available) {
          globalAlignment = await whisperAlignmentService.alignPlainSegments(singleBookAudioPath, segmentsForAlign, { language: 'eng' });
          const runRefinement = process.env.SKIP_SILENCE_SNAPPING === '0' || process.env.SKIP_SILENCE_SNAPPING === 'false';
          if (globalAlignment.length > 0 && runRefinement) {
            console.log('[KitabooFXL] Running silence refinement (30–90s for long audio)...');
            const sentenceOnly = globalAlignment.filter(r => !/_w\d+$/.test(String(r.id || '')));
            const wordLevel = globalAlignment.filter(r => /_w\d+$/.test(String(r.id || '')));
            const refined = await aeneasService.refinePlainSegmentResults(singleBookAudioPath, sentenceOnly, 0.3);
            globalAlignment = [...refined, ...wordLevel];
          } else if (globalAlignment.length > 0) {
            console.log('[KitabooFXL] Skipping silence refinement (avoids 30–90s ffmpeg step)');
          }
        }
      } catch (_) { }
    }

    if (globalAlignment.length === 0) {
      globalAlignment = await aeneasService.alignPlainSegments(singleBookAudioPath, segmentsForAlign, {
        language: 'eng',
        applySilenceSnapping: true
      });
    }

    let deduped = KitabooFxlService.keepFirstOccurrencePerZone(globalAlignment, segmentsForAlign);
    let segments = deduped.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }));

    const useTwoPass = process.env.USE_TWO_PASS_ALIGNMENT === '1';
    let actualAudioDuration = 0;
    try {
      const out = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${singleBookAudioPath}"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      actualAudioDuration = parseFloat(out) || 0;
      console.log(`[KitabooFXL] Actual audio duration: ${actualAudioDuration.toFixed(2)}s`);
    } catch (e) {
      console.warn('[KitabooFXL] ffprobe to get actual audio duration failed:', e.message);
    }
    const manualBoundaries = options.manualPageBoundaries;
    const useManualBoundaries = Array.isArray(manualBoundaries) && manualBoundaries.length >= 1;

    let boundaries;
    if (useManualBoundaries) {
      boundaries = manualBoundaries.map(b => ({
        page: Number(b.page) || b.page,
        start: Number(b.start) || 0,
        end: Number(b.end) || actualAudioDuration
      })).sort((a, b) => a.page - b.page);
      console.log(`[KitabooFXL] Using manual page boundaries:`, boundaries.map(b => `Page ${b.page}: ${b.start.toFixed(2)}s–${b.end.toFixed(2)}s`).join('; '));
    } else {
      const useProportionalBoundaries = process.env.USE_PROPORTIONAL_BOUNDARIES === '1' || useTwoPass;
      boundaries = useProportionalBoundaries
        ? getProportionalBoundaries(pagesWithZones, actualAudioDuration)
        : getPageBoundaries(segments, actualAudioDuration);
    }

    // Whisper sliding-window refinement: snap each boundary start to exact phrase (skip when manual)
    const refineWithWhisper = !useManualBoundaries && useTwoPass && useWhisperAlignment && boundaries.length >= 2;
    if (refineWithWhisper) {
      try {
        const whisperAvailable = await whisperAlignmentService.isWhisperAvailable();
        if (whisperAvailable) {
          const refineDir = path.join(intermediateDir, 'whisper_refine');
          await fs.mkdir(refineDir, { recursive: true });
          const ext = path.extname(singleBookAudioPath) || '.mp3';
          const refined = [];

          for (let i = 0; i < boundaries.length; i++) {
            const b = boundaries[i];
            const firstZone = pagesWithZones.find(p => p.pageNum === b.page)?.textZones?.[0];
            let firstText = (firstZone?.content || '').trim();
            if (firstText) {
              const sanitized = await sanitizeZoneText([{ id: 'anchor', text: firstText }]);
              firstText = (sanitized[0]?.text || firstText).trim();
            }
            if (!firstText || firstText.length < 3) {
              refined.push(b);
              continue;
            }

            const lookback = 65;
            const windowDuration = 50;
            const windowStart = Math.max(0, b.start - lookback);
            const actualWindowDuration = Math.min(windowDuration, actualAudioDuration - windowStart);
            if (actualWindowDuration < 2) {
              refined.push(b);
              continue;
            }

            const slicePath = path.join(refineDir, `refine_p${b.page}${ext}`);
            try {
              extractAudioSlice(singleBookAudioPath, windowStart, actualWindowDuration, slicePath);
              const alignResult = await whisperAlignmentService.alignPlainSegments(slicePath, [{ id: 'anchor', text: firstText }], { language: 'eng' });
              const r = alignResult.find(x => !/_w\d+$/.test(String(x.id || ''))) || alignResult[0];
              if (r && typeof r.startTime === 'number') {
                const snappedStart = Number((windowStart + r.startTime).toFixed(3));
                refined.push({ page: b.page, start: snappedStart, end: b.end });
                console.log(`[KitabooFXL] Whisper snap: Page ${b.page} start ${b.start.toFixed(2)}s → ${snappedStart.toFixed(2)}s`);
              } else {
                refined.push(b);
              }
            } catch (err) {
              console.warn(`[KitabooFXL] Whisper refine failed for page ${b.page}, using proportional:`, err.message);
              refined.push(b);
            }
          }
          // Chain ends: page i ends where page i+1 starts
          for (let j = 0; j < refined.length; j++) {
            refined[j].end = j < refined.length - 1
              ? Math.max(refined[j].start + 0.1, refined[j + 1].start)
              : actualAudioDuration;
          }
          boundaries = refined;
        }
      } catch (e) {
        console.warn('[KitabooFXL] Whisper boundary refinement failed, using proportional:', e.message);
      }
    }

    const MIN_CONFIDENCE = parseFloat(process.env.PAGE_ALIGNMENT_MIN_CONFIDENCE || '0.4');

    const doTwoPass = (useTwoPass || useManualBoundaries) && boundaries.length >= 1;
    if (doTwoPass) {
      try {
        const BOUNDARY_OVERLAP_SEC = parseFloat(process.env.BOUNDARY_OVERLAP_SEC || '5');
        if (!useManualBoundaries && BOUNDARY_OVERLAP_SEC > 0) {
          boundaries = boundaries.map((b, i) => ({
            ...b,
            start: Math.max(0, b.start - BOUNDARY_OVERLAP_SEC)
          }));
          console.log(`[KitabooFXL] Applied ${BOUNDARY_OVERLAP_SEC}s overlap to boundaries`);
        }
        console.log(`[KitabooFXL] Two-pass: splitting audio into ${boundaries.length} pages, re-aligning per-page`);
        const pageAudioDir = path.join(intermediateDir, 'page_audio');
        const pageClips = await splitAudioByPageBoundaries(singleBookAudioPath, boundaries, pageAudioDir);
        const merged = [];
        for (const clip of pageClips) {
          const pageNum = clip.page;
          const pageAudioPath = clip.path ? path.resolve(clip.path) : null;
          console.log(`[KitabooFXL] Processing page ${pageNum}. Path: ${pageAudioPath || '(missing)'}`);
          if (!pageAudioPath || typeof pageAudioPath !== 'string' || !pageAudioPath.trim()) {
            console.warn(`[KitabooFXL] Missing audio path for page ${pageNum}, skipping page-level alignment.`);
            continue;
          }
          const pageSegments = pagesWithZones.find(p => p.pageNum === pageNum)?.textZones.map(z => ({ id: z.id, text: z.content || '' })) || [];
          if (pageSegments.length === 0) {
            console.log(`[KitabooFXL] Page ${pageNum} has no text zones, skipping page-level alignment.`);
            continue;
          }

          let pageAlignment = [];
          let confidence = 0;

          // Try Whisper alignment for the page
          if (useWhisperAlignment) {
            try {
              const available = await whisperAlignmentService.isWhisperAvailable();
              if (available) {
                const whisperResult = await whisperAlignmentService.alignPlainSegments(pageAudioPath, pageSegments, { language: 'eng' });
                if (whisperResult.length > 0) {
                  pageAlignment = whisperResult;
                  confidence = whisperResult[0]?.confidence || 0.5; // Use actual confidence or default
                }
              }
            } catch (e) {
              console.warn(`[KitabooFXL] Whisper alignment failed for page ${pageNum}:`, e.message);
            }
          }

          // Fallback to Aeneas if Whisper fails, returns nothing, or has low confidence
          if (pageAlignment.length === 0 || confidence < MIN_CONFIDENCE) {
            try {
              const aeneasResult = await aeneasService.alignPlainSegments(pageAudioPath, pageSegments, { language: 'eng', applySilenceSnapping: true });
              if (aeneasResult.length > 0) {
                pageAlignment = aeneasResult;
                confidence = 0.7; // Aeneas forced alignment = high confidence
              }
            } catch (e) {
              console.warn(`[KitabooFXL] Aeneas alignment failed for page ${pageNum}:`, e.message);
            }
          }

          if (pageAlignment.length > 0 && confidence >= MIN_CONFIDENCE) {
            const offset = clip.start;
            for (const r of pageAlignment) {
              merged.push({
                id: r.id,
                startTime: Number((offset + (r.startTime || 0)).toFixed(3)),
                endTime: Number((offset + (r.endTime || 0)).toFixed(3))
              });
            }
            console.log(`[KitabooFXL] Page ${pageNum} aligned with confidence ${confidence.toFixed(2)}`);
          } else {
            // Fallback to Pass 1 segments for this page (first-pass full-file alignment)
            const pageIds = new Set(pageSegments.map(s => s.id));
            const pass1ForPage = segments.filter(s => pageIds.has(s.id));
            if (pass1ForPage.length > 0) {
              for (const r of pass1ForPage) {
                merged.push({ id: r.id, startTime: r.startTime, endTime: r.endTime });
              }
              console.log(`[KitabooFXL] Page ${pageNum} using Pass 1 fallback (${pass1ForPage.length} segments)`);
            } else {
              console.warn(`[KitabooFXL] Skipping page ${pageNum}: no alignment results and no Pass 1 fallback.`);
            }
          }
        }
        segments = merged.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }));
      } catch (e) {
        console.warn('[KitabooFXL] Two-pass alignment failed, falling back to single-pass:', e.message);
      }
    }

    await fs.writeFile(
      path.join(intermediateDir, 'alignment.json'),
      JSON.stringify({ segments }, null, 2),
      'utf8'
    );
    await KitabooFxlService.persistNormalizedZonesAfterAlignment(jobId, pagesWithZones);
    return { segments };
  }

  /**
   * Run alignment when using one MP3 per page (no single long audio).
   * Aligns each page's audio with its zones; stores times as 0 → page duration per page (no cumulative offset).
   * @param {string} jobId
   * @param {string} intermediateDir
   * @param {string} humanAudioDir
   * @param {number[]} perPageAudioPages - page numbers that have page_N.mp3
   * @param {Object} options - { skipPages: number[] }
   * @returns {Promise<{ segments: Array<{ id, startTime, endTime }> }>}
   */
  static async runPerPageAlignmentForSyncStudio(jobId, intermediateDir, humanAudioDir, perPageAudioPages, options = {}) {
    const zonesByPage = await KitabooZoneModel.getZonesByJobId(jobId);
    const pagesWithZones = KitabooFxlService.buildPagesWithZonesNormalized(zonesByPage);

    const skipPages = Array.isArray(options.skipPages) && options.skipPages.length > 0 ? options.skipPages : [];
    const useWhisperAlignment = process.env.USE_WHISPER_ALIGNMENT === '1';
    const MIN_CONFIDENCE = parseFloat(process.env.PAGE_ALIGNMENT_MIN_CONFIDENCE || '0.4');
    const merged = [];

    for (const pageNum of perPageAudioPages) {
      if (skipPages.includes(pageNum)) {
        console.log(`[KitabooFXL] Page ${pageNum} skipped (in skipPages).`);
        continue;
      }
      let pageAudioPath = null;
      for (const ext of ['.mp3', '.wav', '.m4a']) {
        const p = path.join(humanAudioDir, `page_${pageNum}${ext}`);
        try {
          await fs.access(p);
          pageAudioPath = p;
          break;
        } catch { /* try next ext */ }
      }
      if (!pageAudioPath) {
        console.warn(`[KitabooFXL] Page ${pageNum} skipped: no audio file (page_${pageNum}.mp3/.wav/.m4a not found in human_audio).`);
        continue;
      }

      const pageData = pagesWithZones.find(p => p.pageNum === pageNum);
      const pageSegments = pageData?.textZones.map(z => ({ id: z.id, text: z.content || '' })) || [];
      if (pageSegments.length === 0) {
        console.warn(`[KitabooFXL] Page ${pageNum} skipped: no text zones in DB for this page. Add zones in Zoning Studio.`);
        continue;
      }

      const sanitized = await sanitizeZoneText(pageSegments);
      const segmentsForAlign = sanitized.filter(s => (s.text || '').trim().length > 0);
      if (segmentsForAlign.length === 0) {
        console.warn(`[KitabooFXL] Page ${pageNum} skipped: no non-empty zone text to align.`);
        continue;
      }

      let pageAlignment = [];
      let confidence = 0;
      if (useWhisperAlignment) {
        try {
          const available = await whisperAlignmentService.isWhisperAvailable();
          if (available) {
            const whisperResult = await whisperAlignmentService.alignPlainSegments(pageAudioPath, segmentsForAlign, { language: 'eng' });
            if (whisperResult.length > 0) {
              pageAlignment = whisperResult;
              confidence = whisperResult[0]?.confidence ?? 0.5;
            }
          }
        } catch (e) {
          console.warn(`[KitabooFXL] Per-page Whisper failed for page ${pageNum}:`, e.message);
        }
      }
      if (pageAlignment.length === 0 || confidence < MIN_CONFIDENCE) {
        try {
          const aeneasResult = await aeneasService.alignPlainSegments(pageAudioPath, segmentsForAlign, { language: 'eng', applySilenceSnapping: true });
          if (aeneasResult.length > 0) {
            pageAlignment = aeneasResult;
            confidence = 0.7;
          }
        } catch (e) {
          console.warn(`[KitabooFXL] Per-page Aeneas failed for page ${pageNum}:`, e.message);
        }
      }

      // Fallback: if both Whisper and Aeneas returned nothing, use linear spread (0 → duration) so page has segments to edit
      if (pageAlignment.length === 0) {
        try {
          const out = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${pageAudioPath}"`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          const duration = Math.max(parseFloat(out) || 0, 1);
          const n = segmentsForAlign.length;
          segmentsForAlign.forEach((seg, i) => {
            const start = (duration * i) / n;
            const end = (duration * (i + 1)) / n;
            pageAlignment.push({ id: seg.id, startTime: start, endTime: end });
          });
          console.log(`[KitabooFXL] Page ${pageNum}: no Aeneas/Whisper result; applied linear spread 0→${duration.toFixed(1)}s (${pageAlignment.length} segments).`);
        } catch (e) {
          console.warn(`[KitabooFXL] Page ${pageNum}: alignment failed and linear fallback failed:`, e.message);
        }
      }

      // Store per-page relative times (0 → page duration) so sync studio waveform 0 = start of that page's MP3
      if (pageAlignment.length > 0) {
        // Extend last segment to actual audio duration so full waveform is covered (no gap at end)
        let audioDurationSec = 0;
        try {
          const out = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${pageAudioPath}"`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          audioDurationSec = parseFloat(out) || 0;
        } catch (_) { }
        const maxEnd = Math.max(...pageAlignment.map(r => r.endTime || 0), 0);
        if (audioDurationSec > 0 && maxEnd < audioDurationSec - 0.05) {
          const byStart = [...pageAlignment].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
          const last = byStart[byStart.length - 1];
          if (last) last.endTime = audioDurationSec;
          console.log(`[KitabooFXL] Page ${pageNum}: extended last segment to audio end ${audioDurationSec.toFixed(2)}s (was ${maxEnd.toFixed(2)}s).`);
        }
        for (const r of pageAlignment) {
          merged.push({
            id: r.id,
            startTime: Number((r.startTime || 0).toFixed(3)),
            endTime: Number((r.endTime || 0).toFixed(3))
          });
        }
        const pageDuration = Math.max(...pageAlignment.map(r => r.endTime || 0), 0);
        console.log(`[KitabooFXL] Page ${pageNum} aligned (${pageAlignment.length} segments), duration ${pageDuration.toFixed(2)}s (per-page times 0→duration)`);
      }
    }

    const segments = merged.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }));
    await fs.writeFile(
      path.join(intermediateDir, 'alignment.json'),
      JSON.stringify({ segments }, null, 2),
      'utf8'
    );
    await KitabooFxlService.persistNormalizedZonesAfterAlignment(jobId, pagesWithZones);
    return { segments };
  }

  /**
   * Build synthetic XHTML for Aeneas full pipeline (Kitaboo-style).
   * One span per zone with data-read-aloud="true" and class="sync-sentence" so
   * extractTextFragments picks them up; enables score-based mapping and refinement.
   * @param {Array<{id: string, content: string}>} textZones - Zones in reading order
   * @returns {string} XHTML fragment
   */
  static buildSyntheticXhtmlForAlignment(textZones) {
    // Validate segment IDs: only include zones with a unique id so Kitaboo player can highlight
    const zones = (textZones || []).filter(z =>
      (z.content || '').trim().length > 0 &&
      (z.id != null && String(z.id).trim() !== '')
    );
    const spans = zones
      .map(z => {
        const id = String(z.id).replace(/"/g, '&quot;');
        const escaped = (EpubGenerator.escapeXml(z.content || '')).trim();
        return `<span id="${id}" class="sync-sentence" data-read-aloud="true">${escaped}</span>`;
      })
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><div>${spans}</div></body></html>`;
  }

  /**
   * Heuristic: zone is likely a page number (e.g. "6", "7") — exclude from TTS and SMIL
   * so it is not read aloud. Content is 1–4 digits only and zone is small.
   */
  static isLikelyPageNumber(zone) {
    const content = (zone.content || '').trim();
    if (!/^\d{1,4}$/.test(content)) return false;
    const w = Number(zone.w ?? zone.width ?? 0);
    const h = Number(zone.h ?? zone.height ?? 0);
    return w > 0 && h > 0 && w < 80 && h < 60;
  }

  /**
   * Phase 3: assembly into Fixed Layout EPUB 3
   */
  static async assembleFxlEpub(jobId, pagesData, options = {}) {
    let {
      syncLevel = 'word',
      voice,
      useWhisperAlignment = process.env.USE_WHISPER_ALIGNMENT === '1',
      extractedFonts = [],
      renderMode,
      fxlBodyFontFamily
    } = options;
    if (!extractedFonts || extractedFonts.length === 0) {
      try {
        const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
        const metaPath = path.join(intermediateDir, 'high_fidelity_render', 'job_metadata.json');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        extractedFonts = meta.extractedFonts || [];
        if (extractedFonts.length > 0) console.log(`[KitabooFXL] Loaded ${extractedFonts.length} fonts from job_metadata.json for consistent font-family`);
      } catch (e) {
        // no job_metadata or no extractedFonts
      }
    }
    console.log(`[KitabooFXL] Phase 3: Assembling FXL EPUB for Job ${jobId} (Sync Level: ${syncLevel}, Voice: ${voice?.name ? `${voice.name} (${voice.ssmlGender || '—'})` : 'default'})`);

    // Helper: enforce monotonic, minimum-duration fragments (Kitaboo: 200ms floor to prevent flicker).
    // IMPORTANT: preserve input order (reading order). SMIL pars must follow document/reading order
    // so that "first 3 blocks" on the page are the first 3 played; sorting by startTime would put
    // earlier global-audio segments first and break visual top-to-bottom read-aloud.
    const enforceMonotonic = (frags, minDur = 0.2) => {
      const ordered = [...(frags || [])]; // no sort — keep reading order
      const guarded = [];
      let prevEnd = 0;
      for (const f of ordered) {
        const start = Math.max(parseFloat(f.startTime) || 0, prevEnd);
        const end = Math.max(parseFloat(f.endTime) || start, start + minDur);
        guarded.push({ ...f, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
        prevEnd = end;
      }
      return guarded;
    };

    const outputDir = path.join(getEpubOutputDir(), `fxl_${jobId}`);
    const tempDir = path.join(outputDir, 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    const useClassicLayout = options.classicLayout && pagesData.some(p => Array.isArray(p.layoutFragments) && p.layoutFragments.length > 0);
    const useReferenceStructure = useClassicLayout;

    const intermediateDir = path.join(getHtmlIntermediateDir(), `kitaboo_${jobId}`);
    let preserveImportMeta = null;
    try {
      preserveImportMeta = JSON.parse(await fs.readFile(path.join(intermediateDir, 'import_package_meta.json'), 'utf8'));
    } catch (_) { }
    let preserveMod = null;
    if (!preserveImportMeta?.preserveForPublish) {
      try {
        preserveMod = await import('./kitabooFxlPreserveAssemble.js');
        const discovered = await preserveMod.discoverImportPackageMeta(intermediateDir);
        if (discovered?.preserveForPublish) {
          preserveImportMeta = discovered;
          await fs.writeFile(
            path.join(intermediateDir, 'import_package_meta.json'),
            JSON.stringify(discovered, null, 2),
            'utf8'
          ).catch(() => {});
        }
      } catch (e) {
        console.warn('[KitabooFXL] discoverImportPackageMeta:', e?.message || e);
      }
    }
    if (preserveImportMeta?.preserveForPublish && !useClassicLayout) {
      if (!preserveMod) preserveMod = await import('./kitabooFxlPreserveAssemble.js');
      return preserveMod.assembleFxlEpubPreserveImport(
        jobId,
        pagesData,
        options,
        preserveImportMeta,
        intermediateDir,
        outputDir,
        tempDir
      );
    }

    const bookUuid = uuidv4();
    const epubDir = path.join(tempDir, useReferenceStructure ? 'OPS' : 'EPUB');
    const contentPrefix = useReferenceStructure ? 'OPS' : 'EPUB';
    const imagesDir = path.join(epubDir, 'images');
    const cssDir = path.join(epubDir, 'css');
    const audioDir = path.join(epubDir, 'audio');
    await fs.mkdir(imagesDir, { recursive: true });
    if (!useReferenceStructure) await fs.mkdir(cssDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });
    if (useReferenceStructure) await fs.mkdir(path.join(epubDir, 'smil'), { recursive: true });

    let globalCoordinateMap = null;
    if (useClassicLayout && !useReferenceStructure) {
      const allFragments = pagesData.flatMap(p => (p.layoutFragments || []).map(f => ({ left: f.left, top: f.top, fontSize: f.fontSize })));
      const { coordinateMap, fragmentsWithClasses } = EpubGenerator.buildCoordinateMap(allFragments);
      globalCoordinateMap = coordinateMap;
      let idx = 0;
      for (const page of pagesData) {
        for (const f of page.layoutFragments || []) {
          Object.assign(f, fragmentsWithClasses[idx++]);
        }
      }
      console.log(`[KitabooFXL] Classic layout: ${allFragments.length} fragments, coordinate classes`);
    }

    if (useReferenceStructure) {
      await fs.writeFile(path.join(epubDir, 'default.css'), EpubGenerator.generateDefaultCssReference());
      await fs.writeFile(path.join(epubDir, 'style.css'), '/* shared styles */\n.t { font-size: 1px; }\n');
    } else {
      await fs.writeFile(
        path.join(cssDir, 'style.css'),
        useClassicLayout && globalCoordinateMap
          ? EpubGenerator.generateFxlCssClassic(globalCoordinateMap, extractedFonts, fxlBodyFontFamily)
          : EpubGenerator.generateFxlCss(extractedFonts, fxlBodyFontFamily)
      );
    }

    const manifest = [];
    const spine = [];
    let totalDuration = 0;

    // When renderMode is absolute-html, optionally load glyph-level coords for layout (only when zones are word-level).
    let glyphCoordsByPage = null;
    let extractionLevelFromJob = null;
    let zoneLevelFromJob = 'word'; // default when meta not loaded (e.g. non–Hi-Fi job)
    if (options.renderMode === 'absolute-html') {
      try {
        const renderedDir = path.join(intermediateDir, 'high_fidelity_render');
        const metaPath = path.join(renderedDir, 'job_metadata.json');
        const coordsPath = path.join(renderedDir, 'coords.json');
        const [metaRaw, coordsRaw] = await Promise.all([
          fs.readFile(metaPath, 'utf8').catch(() => null),
          fs.readFile(coordsPath, 'utf8').catch(() => null)
        ]);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          extractionLevelFromJob = meta.extractionLevel || null;
          zoneLevelFromJob = meta.zoneLevel || 'word'; // ONLY source for zoneLevel on publish (never from request body).
        }
        // CRITICAL: Glyph layout (word wrappers from glyph bbox union) ONLY when extraction===glyph AND zoneLevel===word.
        // If zoneLevel===sentence we must use zone-based XHTML (scaledZones); mixing would break highlight.
        if (coordsRaw && extractionLevelFromJob === 'glyph' && zoneLevelFromJob === 'word') {
          const coordsArray = JSON.parse(coordsRaw);
          glyphCoordsByPage = Array.isArray(coordsArray)
            ? Object.fromEntries((coordsArray || []).map(p => [p.page, p]))
            : null;
          if (glyphCoordsByPage && Object.keys(glyphCoordsByPage).length > 0) {
            console.log(`[KitabooFXL] Glyph-level coords loaded for absolute-html layout (${Object.keys(glyphCoordsByPage).length} pages).`);
          }
        }
      } catch (e) {
        console.warn('[KitabooFXL] Could not load glyph coords for absolute-html:', e.message);
      }
    }

    // Phase 4: Handle Extracted Fonts (copy into OEBPS/fonts; optional IDPF obfuscation + encryption.xml)
    const fontsDir = path.join(epubDir, 'fonts');
    const embeddedFontHrefs = [];
    if (extractedFonts && extractedFonts.length > 0) {
      await fs.mkdir(fontsDir, { recursive: true });
      const obfuscateFonts = process.env.FXL_OBFUSCATE_FONTS !== '0';
      const key = obfuscateFonts ? crypto.createHash('sha1').update('urn:uuid:' + bookUuid).digest().slice(0, 16) : null;
      for (const font of extractedFonts) {
        const src = path.join(intermediateDir, 'high_fidelity_render', 'fonts', font.filename);
        const dest = path.join(fontsDir, font.filename);
        try {
          await fs.access(src);
        } catch (_) {
          console.warn(`[KitabooFXL] Font source missing (OEBPS/fonts will be incomplete): ${src}`);
          continue;
        }
        const sourceBuf = await fs.readFile(src);
        // Generate web-safe WOFF2 when possible; CSS will prefer this.
        if (font.woff2Filename) {
          const woff2Dest = path.join(fontsDir, font.woff2Filename);
          const written = await KitabooFxlService.writeWoff2IfPossible(sourceBuf, woff2Dest, font.filename);
          if (written) {
            const woff2Href = `fonts/${font.woff2Filename}`;
            manifest.push({ id: `font_${font.name}_woff2`, href: woff2Href, mediaType: 'font/woff2' });
          } else {
            font.woff2Filename = null;
          }
        }
        const buf = Buffer.from(sourceBuf);
        if (key && buf.length > 0) {
          for (let i = 0; i < Math.min(1040, buf.length); i++) buf[i] ^= key[i % 16];
          await fs.writeFile(dest, buf);
        } else {
          await fs.copyFile(src, dest);
        }
        const mediaType = font.filename.toLowerCase().endsWith('.otf') ? 'application/vnd.ms-opentype' : 'application/x-font-ttf';
        const href = `fonts/${font.filename}`;
        manifest.push({ id: `font_${font.name}`, href, mediaType });
        embeddedFontHrefs.push(href);
        console.log(`[KitabooFXL] Embedded font included: ${font.filename}'${obfuscateFonts ? ' (obfuscated)' : ''}`);
      }
    }
    if (useReferenceStructure) {
      manifest.push({ id: 'default_ccs', href: 'default.css', mediaType: 'text/css' });
      manifest.push({ id: 'style_ccs', href: 'style.css', mediaType: 'text/css' });
      manifest.push({ id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' });
    }
    const smilDurations = {};

    // Build comprehensive Font Map for the job
    const activeFontMap = { ...(KitabooFxlService._fontMappingCache?.[jobId] || {}) };
    // If we have extracted fonts, ensure they are used by mapping their raw names to themselves (for CSS @font-face lookup)
    if (extractedFonts && extractedFonts.length > 0) {
      // The fontMapping in extractedFonts is [{filename, name, path}]
      // We want to ensure any zone using a font that we have a file for uses that font's embedded name.
      pagesData.forEach(p => {
        (p.zones || []).forEach(z => {
          if (z.fontFile) {
            // Map raw font name to itself so generateFxlPage uses it as the CSS font-family
            activeFontMap[z.fontFamily] = z.fontFamily;
          }
        });
      });
    }

    // Preliminary pass: per-page zones and human-audio detection (for Global Offset Mapping)
    const pagesWithZones = [];
    for (let i = 0; i < pagesData.length; i++) {
      const page = pagesData[i];
      const pageNum = page.pageNumber || (i + 1);
      let pageZones = page.zones || [];
      // To ensure "break, new line should exactly same as it is in pdf", we MUST NOT coalesce or expand spans for the visual layer.
      // These functions attempt to re-flow text within blocks, which contradicts absolute PDF positioning and causes "collapsed" text.
      // pageZones = KitabooFxlService.expandZonesToSentenceLevel(pageZones, syncLevel);
      // Zone Properties READING ORDER drives SMIL/read-aloud order (from DB: reading_order)
      const textZones = pageZones
        .filter(z => z.type === 'text' || z.content)
        .filter(z => !KitabooFxlService.isLikelyPageNumber(z))
        .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
      const humanAudioPath = path.join(intermediateDir, 'human_audio', `page_${pageNum}.mp3`);
      let hasHumanAudio = false;
      try {
        await fs.access(humanAudioPath);
        hasHumanAudio = true;
      } catch { }
      pagesWithZones.push({ pageNum, page, pageZones, textZones, humanAudioPath, hasHumanAudio });
    }

    // Ensure unique zone IDs per page so global alignment 1-to-1 mapping stays in sync (no duplicate ids)
    for (const pwz of pagesWithZones) {
      const idCount = {};
      pwz.textZones.forEach(z => {
        const id = String(z.id || '').trim();
        if (id) idCount[id] = (idCount[id] || 0) + 1;
      });
      const occurrence = {};
      pwz.textZones.forEach(z => {
        const id = String(z.id || '').trim();
        if (!id) return;
        const n = occurrence[id] = (occurrence[id] || 0) + 1;
        if (idCount[id] > 1) z.id = id + '_' + (n - 1);
      });
    }

    // Glyph + word: extraction uses p{n}_w{k}; Sync Studio alignment.json uses p{n}_z{i+1}_w{i} (one z and one w
    // index per word in reading order). Do NOT use normalizeZoneIdsForPage here — it strips the z slot and maps
    // p11_z19_w18 → p11_z1_w18, breaking alignment. Short ids p5_w0 still need mapping: same canonical rule fixes that.
    let normalizeGlyphWordZoneIds = false;
    try {
      const metaPath = path.join(intermediateDir, 'high_fidelity_render', 'job_metadata.json');
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      normalizeGlyphWordZoneIds = meta.extractionLevel === 'glyph' && (meta.zoneLevel || 'word') === 'word';
    } catch (_) { }
    if (normalizeGlyphWordZoneIds) {
      for (const pwz of pagesWithZones) {
        const sorted = [...pwz.textZones].sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0));
        const normalized = KitabooFxlService.normalizeZoneIdsForPage(pwz.pageNum, sorted);
        for (let i = 0; i < sorted.length; i++) {
          sorted[i].id = normalized[i].id;
          sorted[i].readingOrder = normalized[i].readingOrder;
        }
      }
      console.log('[KitabooFXL] Glyph+word: zone ids normalized (p{n}_w{k} or p{n}_z{k}_w{j} → canonical p{n}_z{i+1}_w{i}).');
    }

    // Kitaboo Secret #6: Global Offset Mapping — one long audio for whole book
    let useGlobalAudio = false;
    let globalAlignmentByPage = {};
    let sharedAudioFileName = null;
    let globalAudioPathForVad = null;
    /** Set when alignment.json already exists or global align wrote it; prevents end-of-export SMIL merge from overwriting Sync Studio data. */
    let globalAlignmentJsonWritten = false;
    const humanAudioDir = path.join(intermediateDir, 'human_audio');
    // Per-page: Sync Studio alignment (0→duration per page); used when no single-book audio
    let perPageAlignmentFromSyncStudio = {};
    try {
      const alignmentPath = path.join(intermediateDir, 'alignment.json');
      const raw = await fs.readFile(alignmentPath, 'utf8');
      const data = JSON.parse(raw);
      const segments = data?.segments || data || [];
      if (Array.isArray(segments) && segments.length > 0) {
        for (const r of segments) {
          const p = KitabooFxlService.getPageNumFromZoneId(r.id);
          if (!perPageAlignmentFromSyncStudio[p]) perPageAlignmentFromSyncStudio[p] = [];
          perPageAlignmentFromSyncStudio[p].push({ id: r.id, startTime: r.startTime, endTime: r.endTime });
        }
        // Critical for per-page-only jobs: without this, export overwrote alignment.json with SMIL-derived segments,
        // which omit likely page-number zones and can drop the last synced id vs Zoning/Sync Studio.
        globalAlignmentJsonWritten = true;
        console.log('[KitabooFXL] Loaded Sync Studio alignment for per-page export (use when human narration is per-page).');
      }
    } catch (_) { }
    const hasAnySyncStudioAlignment = Object.keys(perPageAlignmentFromSyncStudio).length > 0;

    // Phase 1: Decide single-book vs per-page human audio
    // Prefer per-page (page_1.mp3, page_2.mp3, ...) when present so FXL export uses one audio per page and Sync Studio alignment
    const singleBookNames = ['narration.mp3', 'full.mp3', 'audio.mp3', 'book.mp3'];
    let singleBookAudioPath = null;
    let hasPerPageAudioFiles = false;
    try {
      const files = await fs.readdir(humanAudioDir);
      const audioExt = ['.mp3', '.wav', '.m4a'];
      const audioFiles = files.filter(f => audioExt.some(ext => f.toLowerCase().endsWith(ext)));
      const perPageMatches = files.filter(f => /^page_\d+\.(mp3|wav|m4a)$/i.test(f));
      hasPerPageAudioFiles = perPageMatches.length > 0;
      if (!hasPerPageAudioFiles) {
        for (const name of singleBookNames) {
          if (files.includes(name)) {
            singleBookAudioPath = path.join(humanAudioDir, name);
            break;
          }
        }
        if (!singleBookAudioPath && audioFiles.length === 1) {
          singleBookAudioPath = path.join(humanAudioDir, audioFiles[0]);
        }
      } else {
        console.log(`[KitabooFXL] Per-page human audio detected (${perPageMatches.length} files: page_N.mp3). Export will use one audio file per page.`);
      }
    } catch (_) { }

    if (singleBookAudioPath) {
      // One long audio for all pages: mark every page as having human audio
      useGlobalAudio = true;
      const fullAudioPath = singleBookAudioPath;
      for (const pwz of pagesWithZones) {
        pwz.hasHumanAudio = true;
        pwz.humanAudioPath = fullAudioPath;
      }
      const alignmentPath = path.join(intermediateDir, 'alignment.json');
      let useExistingAlignment = false;
      try {
        const existing = await fs.readFile(alignmentPath, 'utf8');
        const parsed = JSON.parse(existing);
        const segments = parsed?.segments || parsed;
        if (Array.isArray(segments) && segments.length > 0) {
          for (const r of segments) {
            const p = KitabooFxlService.getPageNumFromZoneId(r.id);
            if (!globalAlignmentByPage[p]) globalAlignmentByPage[p] = [];
            globalAlignmentByPage[p].push({ id: r.id, startTime: r.startTime, endTime: r.endTime });
          }
          useExistingAlignment = true;
          globalAlignmentJsonWritten = true;
          console.log('[KitabooFXL] Using saved alignment from Sync Studio (manual or previous run).');
        }
      } catch (_) { }

      if (useExistingAlignment) {
        await fs.copyFile(fullAudioPath, path.join(audioDir, 'narration.mp3')).catch(() => { });
        sharedAudioFileName = 'narration.mp3';
        globalAudioPathForVad = fullAudioPath;
      }

      if (!useExistingAlignment) {
        const combinedSegments = [];
        for (const pwz of pagesWithZones) {
          for (const z of pwz.textZones) {
            if ((z.content || '').trim()) combinedSegments.push({ id: z.id, text: z.content || '' });
          }
        }
        if (combinedSegments.length > 0) {
          try {
            let globalAlignment = [];
            // Full Kitaboo: MFA (Montreal Forced Aligner) when USE_MFA=1 and dictionary/model paths set
            if (process.env.USE_MFA === '1') {
              try {
                const mfaAvailable = await mfaService.isMfaAvailable();
                if (mfaAvailable && process.env.MFA_DICTIONARY_PATH && process.env.MFA_ACOUSTIC_MODEL_PATH) {
                  console.log('[KitabooFXL] Using MFA alignment (Kaldi acoustic model + dictionary).');
                  globalAlignment = await mfaService.alignPlainSegments(fullAudioPath, combinedSegments, {
                    language: 'eng',
                    dictionaryPath: process.env.MFA_DICTIONARY_PATH,
                    acousticModelPath: process.env.MFA_ACOUSTIC_MODEL_PATH
                  });
                  if (globalAlignment.length > 0) {
                    const refined = await aeneasService.refinePlainSegmentResults(fullAudioPath, globalAlignment, 0.3);
                    globalAlignment = refined;
                  }
                }
              } catch (mfaErr) {
                console.warn('[KitabooFXL] MFA alignment failed, falling back:', mfaErr.message);
              }
            }
            if (globalAlignment.length === 0 && useWhisperAlignment) {
              try {
                const available = await whisperAlignmentService.isWhisperAvailable();
                if (available) {
                  console.log('[KitabooFXL] Using Whisper alignment (transcription + fuzzy match).');
                  globalAlignment = await whisperAlignmentService.alignPlainSegments(fullAudioPath, combinedSegments, { language: 'eng' });
                  if (globalAlignment.length > 0) {
                    const sentenceOnly = globalAlignment.filter(r => !/_w\d+$/.test(String(r.id || '')));
                    const wordLevel = globalAlignment.filter(r => /_w\d+$/.test(String(r.id || '')));
                    const refinedSentences = await aeneasService.refinePlainSegmentResults(fullAudioPath, sentenceOnly, 0.3);
                    globalAlignment = [...refinedSentences, ...wordLevel];
                  }
                } else {
                  console.log('[KitabooFXL] Whisper not available, using Aeneas.');
                }
              } catch (whisperErr) {
                console.warn('[KitabooFXL] Whisper alignment failed, using Aeneas:', whisperErr.message);
              }
            }
            if (globalAlignment.length === 0) {
              globalAlignment = await aeneasService.alignPlainSegments(fullAudioPath, combinedSegments, {
                language: 'eng',
                applySilenceSnapping: true
              });
            }
            // Only first occurrence per zone (Page 1 = first blocks only, not every occurrence in book)
            const dedupedAlignment = KitabooFxlService.keepFirstOccurrencePerZone(globalAlignment, combinedSegments);
            // Phase 4: Page-level distribution — filter by p1_, p2_, etc.
            for (const r of dedupedAlignment) {
              const p = KitabooFxlService.getPageNumFromZoneId(r.id);
              if (!globalAlignmentByPage[p]) globalAlignmentByPage[p] = [];
              globalAlignmentByPage[p].push(r);
            }
            await fs.copyFile(fullAudioPath, path.join(audioDir, 'narration.mp3')).catch(() => { });
            sharedAudioFileName = 'narration.mp3';
            globalAudioPathForVad = fullAudioPath;
            const segmentsForSyncStudio = dedupedAlignment.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime }));
            await fs.writeFile(path.join(intermediateDir, 'alignment.json'), JSON.stringify({ segments: segmentsForSyncStudio }, null, 2), 'utf8').catch(() => { });
            globalAlignmentJsonWritten = true;
            console.log(`[KitabooFXL] Single long audio for all pages: ${combinedSegments.length} segments across ${pagesWithZones.length} pages (narration.mp3).`);
          } catch (e) {
            console.warn('[KitabooFXL] Global alignment failed, falling back to per-page:', e.message);
            useGlobalAudio = false;
            for (const pwz of pagesWithZones) {
              pwz.hasHumanAudio = false;
              pwz.humanAudioPath = path.join(intermediateDir, 'human_audio', `page_${pwz.pageNum}.mp3`);
            }
          }
        }
      }
    } else {
      // Fallback: per-page files, or multiple files with same duration (legacy “same file copied” detection)
      const pagesWithHumanAudio = pagesWithZones.filter(pwz => pwz.hasHumanAudio);
      if (pagesWithHumanAudio.length >= 2) {
        const durations = [];
        for (const pwz of pagesWithHumanAudio) {
          try {
            const d = parseFloat(execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${pwz.humanAudioPath}"`,
              { encoding: 'utf8' }
            ).trim());
            durations.push(d);
          } catch (_) { }
        }
        const sameDuration = durations.length >= 2 && durations.every(d => Math.abs(d - durations[0]) < 0.5);
        if (sameDuration && durations[0] > 60) {
          useGlobalAudio = true;
          const fullAudioPath = pagesWithHumanAudio[0].humanAudioPath;
          const combinedSegments = [];
          for (const pwz of pagesWithZones) {
            if (!pwz.hasHumanAudio) continue;
            for (const z of pwz.textZones) {
              if ((z.content || '').trim()) combinedSegments.push({ id: z.id, text: z.content || '' });
            }
          }
          if (combinedSegments.length > 0) {
            try {
              const globalAlignment = await aeneasService.alignPlainSegments(fullAudioPath, combinedSegments, {
                language: 'eng',
                applySilenceSnapping: true
              });
              for (const r of globalAlignment) {
                const p = KitabooFxlService.getPageNumFromZoneId(r.id);
                if (!globalAlignmentByPage[p]) globalAlignmentByPage[p] = [];
                globalAlignmentByPage[p].push(r);
              }
              await fs.copyFile(fullAudioPath, path.join(audioDir, 'narration.mp3')).catch(() => { });
              sharedAudioFileName = 'narration.mp3';
              globalAudioPathForVad = fullAudioPath;
              console.log(`[KitabooFXL] Global Offset Mapping: one alignment for ${combinedSegments.length} segments across ${pagesWithHumanAudio.length} pages; Page 5+ use timestamps after previous page end.`);
            } catch (e) {
              console.warn('[KitabooFXL] Global alignment failed (same long file on multiple pages). Do NOT run Aeneas per-page with full audio.', e.message);
              useGlobalAudio = false;
              // Never run per-page Aeneas with the same long file: disable human sync for these pages
              for (const pwz of pagesWithHumanAudio) {
                pwz.hasHumanAudio = false;
              }
            }
          }
        }
      }
    }

    let addedGlobalAudioToManifest = false;
    // Full Kitaboo: Silero VAD — forbid SMIL from starting highlight inside silence (no flicker during breath)
    let globalSilencePeriods = [];
    if (useGlobalAudio && globalAudioPathForVad && process.env.USE_SILERO_VAD === '1') {
      try {
        const available = await sileroVadService.isSileroAvailable();
        if (available) {
          const vad = await sileroVadService.getSilencePeriods(globalAudioPathForVad, 0.03);
          globalSilencePeriods = vad.silence_periods || [];
          console.log(`[KitabooFXL] Silero VAD: ${globalSilencePeriods.length} silence periods (SMIL will not start highlight in silence).`);
        }
      } catch (e) {
        console.warn('[KitabooFXL] Silero VAD failed, continuing without silence constraint:', e.message);
      }
    }

    /** Same id/start/end as SMIL; Sync Studio web reader reads kitaboo_${jobId}/alignment.json (TTS never wrote this before). */
    const mergedSyncStudioSegments = [];
    const pushSegmentsForSyncStudio = (frags) => {
      if (!frags || !frags.length) return;
      for (const f of frags) {
        mergedSyncStudioSegments.push({
          id: String(f.id || ''),
          startTime: Number(Number(f.startTime).toFixed(3)),
          endTime: Number(Number(f.endTime).toFixed(3))
        });
      }
    };

    for (let i = 0; i < pagesWithZones.length; i++) {
      const { pageNum, page, pageZones, textZones, hasHumanAudio, humanAudioPath } = pagesWithZones[i];

      // Ensure every zone has a valid id so XHTML and SMIL reference the same elements (sync fix)
      pageZones.forEach((z, zi) => {
        if (z.type === 'image') return;
        const raw = z.id != null ? String(z.id).trim() : '';
        if (!raw) z.id = `p${pageNum}_z${zi}`;
      });

      const xhtmlFileName = `page${pageNum}.xhtml`;
      const smilFileName = `page${pageNum}.smil`;
      let audioFileName = `page${pageNum}.mp3`;

      let systemImagePath = page.imagePath || path.join(intermediateDir, 'webp', `page_${pageNum}.webp`);

      // Fix: If imagePath is a web URL, convert to physical path
      if (systemImagePath.startsWith('/html_intermediate/')) {
        const relativePath = systemImagePath.replace('/html_intermediate/', '');
        systemImagePath = path.join(getHtmlIntermediateDir(), relativePath);
      }

      const sourceFileName = path.basename(systemImagePath);
      const isClean = sourceFileName.toLowerCase().includes('_clean');
      const imgExt = path.extname(systemImagePath).toLowerCase() || '.webp';

      // Preserve _clean in the EPUB filename to ensure isClean works downstream
      const imageFileName = `page${pageNum}${isClean ? '_clean' : ''}${imgExt}`;
      const mediaType = imgExt === '.png' ? 'image/png' : 'image/webp';

      if (useReferenceStructure) {
        const pad = String(pageNum).padStart(4, '0');
        const vW = page.pointsDimensions?.width || page.dimensions?.width;
        const vH = page.pointsDimensions?.height || page.dimensions?.height;
        const sX = page.pointsDimensions ? (page.pointsDimensions.width / page.dimensions.width) : 1;
        const sY = page.pointsDimensions ? (page.pointsDimensions.height / page.dimensions.height) : 1;

        const scaledFrags = (Array.isArray(page.layoutFragments) ? page.layoutFragments : []).map(f => ({
          ...f,
          left: (f.left || 0) * sX,
          top: (f.top || 0) * sY,
          width: (f.width || 0) * sX,
          height: (f.height || 0) * sY,
          fontSize: (f.fontSize || 12) * sY
        }));

        const refXhtmlFileName = `page-${pad}.xhtml`;
        const refPageCssFileName = `page-${pad}.css`;
        const refBgFileName = `bg${pageNum}${imgExt}`;
        await fs.copyFile(systemImagePath, path.join(imagesDir, refBgFileName)).catch(() => { });
        const pageDataRef = {
          width: vW,
          height: vH,
          imagePath: `images/${refBgFileName}`,
          pageNum
        };
        const xhtmlContent = EpubGenerator.generateFxlPageReference(pageDataRef, scaledFrags, refPageCssFileName);
        await fs.writeFile(path.join(epubDir, refXhtmlFileName), xhtmlContent);
        const pageCssContent = EpubGenerator.generatePageCssForFragments(scaledFrags);
        await fs.writeFile(path.join(epubDir, refPageCssFileName), pageCssContent);
        manifest.push({ id: `page-${pad}_ccs`, href: refPageCssFileName, mediaType: 'text/css' });
        manifest.push({ id: `page-${pad}`, href: refXhtmlFileName, mediaType: 'application/xhtml+xml' });
        manifest.push({ id: `img${pageNum}`, href: `images/${refBgFileName}`, mediaType: mediaType, properties: i === 0 ? 'cover-image' : null });
        spine.push(`page-${pad}`);
        continue;
      }

      console.log(`[KitabooFXL] Page ${pageNum}: Copying background ${path.basename(systemImagePath)} -> images/${imageFileName}`);
      await fs.copyFile(systemImagePath, path.join(imagesDir, imageFileName)).catch((err) => {
        console.error(`[KitabooFXL] Page ${pageNum}: Failed to copy background image:`, err.message);
      });

      if (useClassicLayout && Array.isArray(page.layoutFragments) && page.layoutFragments.length > 0) {
        const vW = page.pointsDimensions?.width || page.dimensions?.width;
        const vH = page.pointsDimensions?.height || page.dimensions?.height;
        const sX = page.pointsDimensions ? (page.pointsDimensions.width / page.dimensions.width) : 1;
        const sY = page.pointsDimensions ? (page.pointsDimensions.height / page.dimensions.height) : 1;

        const scaledFragments = page.layoutFragments.map(f => ({
          ...f,
          left: (f.left || 0) * sX,
          top: (f.top || 0) * sY,
          width: (f.width || 0) * sX,
          height: (f.height || 0) * sY,
          fontSize: (f.fontSize || 12) * sY
        }));

        const isClean = imageFileName.includes('_clean');
        const xhtmlContent = EpubGenerator.generateFxlPage({
          width: vW,
          height: vH,
          imageName: imageFileName,
          pageNum
        }, scaledFragments, {
          classicLayout: true,
          // Sentences should always be visible, even when read-aloud is not active.
          // Do not make text transparent on any page.
          transparentText: false,
          fxlBodyFontFamily
        });
        await fs.writeFile(path.join(epubDir, xhtmlFileName), xhtmlContent);
        manifest.push({ id: `page${pageNum}`, href: xhtmlFileName, mediaType: 'application/xhtml+xml' });
        manifest.push({ id: `img${pageNum}`, href: `images/${imageFileName}`, mediaType: mediaType, properties: i === 0 ? 'cover-image' : null });
        spine.push(`page${pageNum}`);
        continue;
      }

      const pageText = textZones.map(z => z.content).join(' ');

      let smilFragments = [];
      let pageDuration = 0;
      const useHumanNarration = hasHumanAudio;
      // In glyph+word mode, pageZones are already word-level (p1_w0, p1_w1); do not run proportional expansion.
      const pageCoordsForPre = glyphCoordsByPage && glyphCoordsByPage[pageNum];
      const useGlyphLayoutThisPage = options.renderMode === 'absolute-html' && extractionLevelFromJob === 'glyph' && zoneLevelFromJob === 'word' && pageCoordsForPre && Array.isArray(pageCoordsForPre.items) && pageCoordsForPre.items.length > 0;
      const zonesForXhtmlPre = KitabooFxlService.expandZonesToSyncLevelInMemory(pageZones, syncLevel, useGlyphLayoutThisPage ? { extractionLevel: 'glyph' } : {});
      // Word-level non-glyph: XHTML uses expanded ids (p1_z0_w0, …). SMIL must iterate those same zones or
      // fragments keep sentence ids (p1_z0) and mergeRenderedIdsForSmilFilter strips every par (sentence level still works).
      const zonesForSmilGroup = (syncLevel === 'word' && !useGlyphLayoutThisPage)
        ? (zonesForXhtmlPre || []).filter(z =>
            (z.type === 'text' || z.content) &&
            (z.content || '').trim() &&
            !KitabooFxlService.isLikelyPageNumber(z))
          .sort((a, b) => (a.readingOrder || 0) - (b.readingOrder || 0))
        : textZones;

      if (pageText.trim() && useHumanNarration) {
        // Kitaboo Secret #6: use Global Offset Mapping when one long audio for whole book
        if (useGlobalAudio && sharedAudioFileName && globalAlignmentByPage[pageNum]?.length > 0) {
          audioFileName = sharedAudioFileName;
          const alignmentResult = globalAlignmentByPage[pageNum];
          const guardedAlignment = enforceMonotonic(alignmentResult);
          const alignmentMap = Object.fromEntries(guardedAlignment.map(r => [r.id, { startTime: r.startTime, endTime: r.endTime }]));
          const pagePrefix = `p${pageNum}`;
          const xhtmlHasZ0 = (zonesForXhtmlPre || []).some(z => {
            const zid = String(z.id || '');
            return zid === `${pagePrefix}_z0` || zid.startsWith(`${pagePrefix}_z0_`);
          });
          const alignmentHasZ0 = !!alignmentMap[`${pagePrefix}_z0`];
            const getAlignmentTime = (rawId) => {
              const id = String(rawId || '').trim();
              if (!id) return null;
              // Normalize word ids when XHTML expanded zones insert `z{n}` between page and `_w{n}`
              // Example: XHTML ids `p5_z1_w0` vs alignment ids `p5_w0`.
              const altId = id.replace(/_z\d+_/g, '_');
              if (altId !== id) return alignmentMap[altId] || null;
              const m = id.match(/^(p\d+)_z(\d+)(.*)$/);
              // Sentence-level: alignment often has p{page}_z0 for the first block while XHTML uses p{page}_z1.
              // If alignment has z0 but no XHTML zone uses _z0, map p{page}_zN → alignment p{page}_z{N-1} BEFORE direct match
              // (otherwise direct p5_z1 matches the second sentence when XHTML p5_z1 is the first).
              if (m) {
                const page = m[1];
                const zNum = parseInt(m[2], 10);
                const suffix = m[3] || '';
                if (suffix === '' && alignmentHasZ0 && !xhtmlHasZ0 && zNum >= 1) {
                  const shiftedId = `${page}_z${zNum - 1}${suffix}`;
                  if (alignmentMap[shiftedId]) return alignmentMap[shiftedId];
                }
              }
              const direct = alignmentMap[id];
              if (direct) return direct;
              if (m) {
                const page = m[1];
                const zNum = parseInt(m[2], 10);
                const suffix = m[3] || '';
                const candidates = [`${page}_z${zNum + 1}${suffix}`, `${page}_z${zNum - 1}${suffix}`];
                for (const c of candidates) {
                  const t = alignmentMap[c];
                  if (t) return t;
                }
              }
              return null;
            };
          pageDuration = guardedAlignment.length > 0 ? Math.max(...guardedAlignment.map(r => r.endTime)) : 0;

          // Warn if duration seems compressed
          if (pageDuration < 1.0 && textZones.length > 5) {
            console.warn(`[KitabooFXL] Page ${pageNum}: Suspiciously short duration ${pageDuration.toFixed(2)}s for ${textZones.length} zones. Check alignment.`);
          }

          smilDurations[`smil${pageNum}`] = pageDuration;

          const lineFragmentGroups = {};
          const regularZones = [];
          zonesForSmilGroup.forEach(zone => {
            if (zone.isLineFragment && zone.baseZoneId) {
              if (!lineFragmentGroups[zone.baseZoneId]) lineFragmentGroups[zone.baseZoneId] = [];
              lineFragmentGroups[zone.baseZoneId].push(zone);
            } else {
              regularZones.push(zone);
            }
          });
          const sortedFragmentGroups = Object.entries(lineFragmentGroups)
            .map(([baseId, fragments]) => ({
              baseId,
              fragments: fragments.sort((a, b) => (a.lineIndex || 0) - (b.lineIndex || 0)),
              readingOrder: fragments[0].readingOrder || 999
            }))
            .sort((a, b) => a.readingOrder - b.readingOrder);
          const allZoneGroups = [
            ...regularZones.map(z => ({ type: 'regular', zone: z, readingOrder: z.readingOrder || 999 })),
            ...sortedFragmentGroups.map(g => ({ type: 'fragment', ...g, readingOrder: g.readingOrder }))
          ].sort((a, b) => a.readingOrder - b.readingOrder);

          const propagatedBases = new Set();
          allZoneGroups.forEach(group => {
            if (group.type === 'fragment') {
              const frags = group.fragments;
              const times = frags.map(f => getAlignmentTime(f.id)).filter(Boolean);
              if (times.length === 0) return;
              const startTime = Math.min(...times.map(t => t.startTime));
              const endTime = Math.max(...times.map(t => t.endTime));
              frags.forEach(frag => {
                smilFragments.push({ id: frag.id, startTime, endTime });
              });
            } else {
              const zone = group.zone;
              const t = getAlignmentTime(zone.id);
              if (t) {
                smilFragments.push({ id: zone.id, startTime: t.startTime, endTime: t.endTime });
                return;
              }
              const wordMatch = String(zone.id || '').match(/_w(\d+)$/);
              if (wordMatch) {
                const baseId = zone.id.replace(/_w\d+$/, '');
                const sent = getAlignmentTime(baseId);
                if (sent && !propagatedBases.has(baseId)) {
                  const wordZones = regularZones.filter(z => z.id && String(z.id).replace(/_w\d+$/, '') === baseId);
                  wordZones.sort((a, b) => {
                    const na = parseInt((a.id || '').match(/_w(\d+)$/)?.[1] ?? '0', 10);
                    const nb = parseInt((b.id || '').match(/_w(\d+)$/)?.[1] ?? '0', 10);
                    return na - nb;
                  });
                  const totalChars = wordZones.reduce((sum, z) => sum + (z.content || '').length, 0);
                  if (totalChars > 0) {
                    const dur = sent.endTime - sent.startTime;
                    let cumulative = 0;
                    wordZones.forEach(wz => {
                      const wordChars = (wz.content || '').length;
                      const startTime = sent.startTime + (cumulative / totalChars) * dur;
                      const endTime = startTime + (wordChars / totalChars) * dur;
                      smilFragments.push({ id: wz.id, startTime, endTime });
                      cumulative += wordChars;
                    });
                    propagatedBases.add(baseId);
                  }
                }
              }
            }
          });
          // Align fragment IDs to expanded XHTML zone IDs so player highlighting works
          smilFragments = KitabooFxlService.alignSmilFragmentsToExpandedZones(smilFragments, zonesForXhtmlPre);
          // SMIL order = reading order (no sort by startTime)
          let guardedFragments = enforceMonotonic(smilFragments, 0.001);
          // Include alignment segment ids so word-level Sync Studio data is not stripped vs expanded XHTML ids
          const renderedIds = KitabooFxlService.mergeRenderedIdsForSmilFilter(
            zonesForXhtmlPre,
            syncLevel,
            globalAlignmentByPage[pageNum]
          );
          guardedFragments = guardedFragments.filter(f => renderedIds.has(String(f.id || '')));
          if (guardedFragments.length === 0 && globalAlignmentByPage[pageNum]?.length > 0) {
            const fb = KitabooFxlService.buildSmilFragmentsFromAlignmentRows(
              zonesForXhtmlPre,
              syncLevel,
              globalAlignmentByPage[pageNum]
            );
            guardedFragments = enforceMonotonic(fb, 0.001);
            if (guardedFragments.length > 0) {
              console.warn(`[KitabooFXL] Page ${pageNum}: zone→time SMIL had 0 pars; using alignment.json fallback (${guardedFragments.length} segments).`);
            }
          }
          smilFragments = guardedFragments;
          if (!globalAlignmentJsonWritten) {
            pushSegmentsForSyncStudio(guardedFragments);
          }
          const smilOptions = {
            minDurationSec: 0.001,
            silencePeriods: globalSilencePeriods,
            audioDurationSec: pageDuration
          };
          const smilContent = EpubGenerator.generateFxlSmil({
            xhtmlFileName,
            audioFileName: `audio/${audioFileName}`,
            jobId,
            pageNum
          }, guardedFragments, smilOptions);
          await fs.writeFile(path.join(epubDir, smilFileName), smilContent);
          if (guardedFragments.length > 0) {
            console.log(`[KitabooFXL] Page ${pageNum}: SMIL written with ${guardedFragments.length} fragments → ${xhtmlFileName}#${guardedFragments[0]?.id}…`);
          }
          manifest.push({ id: `smil${pageNum}`, href: smilFileName, mediaType: 'application/smil+xml' });
          if (!addedGlobalAudioToManifest) {
            manifest.push({ id: 'audio_narration', href: `audio/${sharedAudioFileName}`, mediaType: 'audio/mpeg' });
            addedGlobalAudioToManifest = true;
          }
          totalDuration += pageDuration;
        } else {
          // Per-page alignment: only when this page has its own SHORT clip (one clip per page).
          // When we have global audio (one long file for the book), NEVER run Aeneas per-page with that file —
          // it causes "duration stretching", fallback score -1.00, and wrong clipBegin/clipEnd.
          const useGlobalAudioButNoDataForPage = useGlobalAudio && sharedAudioFileName;
          let audioDurationSec = 0;
          try {
            audioDurationSec = parseFloat(execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${humanAudioPath}"`,
              { encoding: 'utf8' }
            ).trim());
          } catch (_) { }
          const FULL_BOOK_AUDIO_THRESHOLD_SEC = 90;
          const segmentCount = textZones.length;
          const syncStudioForPage = (perPageAlignmentFromSyncStudio[pageNum] || []).slice();
          const hasSyncStudioPageAlignment = syncStudioForPage.length > 0;
          // Do not skip when we already have Sync Studio alignment for this page (page_N.mp3 + alignment.json).
          // Previously useGlobalAudioButNoDataForPage always skipped the whole block, producing empty SMIL.
          let skipPerPageAeneas = false;
          if (useGlobalAudioButNoDataForPage) {
            skipPerPageAeneas = !hasSyncStudioPageAlignment;
          } else if (audioDurationSec > FULL_BOOK_AUDIO_THRESHOLD_SEC && segmentCount <= 15) {
            // Heuristic targets mistaken full-book audio pasted as page_1.mp3 — but it also fired for real
            // per-page clips (e.g. 2+ min for one page with few zones). Never skip when Sync Studio has timings.
            skipPerPageAeneas = !hasSyncStudioPageAlignment;
          }
          if (skipPerPageAeneas) {
            if (useGlobalAudioButNoDataForPage) {
              console.log(`[KitabooFXL] Page ${pageNum}: no global alignment data (e.g. image-only); skipping per-page Aeneas (Whisper-Anchor: one file only).`);
            } else {
              console.warn(`[KitabooFXL] Page ${pageNum}: SKIP per-page Aeneas — audio is ${audioDurationSec.toFixed(0)}s but page has only ${segmentCount} segments (would stretch highlights). Use "1 file (all pages)" and upload narration.mp3 for global alignment.`);
            }
          }
          if (!skipPerPageAeneas) {
            let alignmentResult = (perPageAlignmentFromSyncStudio[pageNum] || []).slice();
            if (alignmentResult.length > 0) {
              console.log(`[KitabooFXL] Page ${pageNum}: using Sync Studio alignment (${alignmentResult.length} segments).`);
            }
            if (alignmentResult.length === 0 && hasAnySyncStudioAlignment) {
              console.log(`[KitabooFXL] Page ${pageNum}: no Sync Studio alignment; skipping (no auto-align, no TTS).`);
            } else {
              const epubAudioPath = path.join(audioDir, audioFileName);
              await fs.copyFile(humanAudioPath, epubAudioPath).catch(() => { });
              try {
                if (alignmentResult.length === 0) {
                  const syntheticXhtml = this.buildSyntheticXhtmlForAlignment(textZones);
                  try {
                    const autoSyncResult = await aeneasService.autoSync(humanAudioPath, syntheticXhtml, {
                      language: 'eng',
                      granularity: 'sentence',
                      propagateWords: false,
                      disableDefaultExclusions: true,
                      detectPauses: true
                    });
                    if (autoSyncResult.sentences && autoSyncResult.sentences.length > 0) {
                      alignmentResult = autoSyncResult.sentences.map(s => ({
                        id: s.id,
                        startTime: s.startTime,
                        endTime: s.endTime
                      }));
                      console.log(`[KitabooFXL] Page ${pageNum}: human narration aligned via XHTML pipeline (${alignmentResult.length} segments, with refinement)`);
                    }
                  } catch (xhtmlErr) {
                    console.warn(`[KitabooFXL] Page ${pageNum} XHTML pipeline failed, using plain-segment alignment:`, xhtmlErr.message);
                  }
                }
                if (alignmentResult.length === 0) {
                  const segments = textZones.map(z => ({ id: z.id, text: z.content || '' }));
                  alignmentResult = await aeneasService.alignPlainSegments(humanAudioPath, segments, { language: 'eng' });
                  console.log(`[KitabooFXL] Page ${pageNum}: human narration aligned via plain segments (${alignmentResult.length} segments)`);
                }

                let audioDurationSec = 0;
                try {
                  audioDurationSec = parseFloat(execSync(
                    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${humanAudioPath}"`,
                    { encoding: 'utf8' }
                  ).trim());
                } catch (_) { }
                if (audioDurationSec > 120 && textZones.length <= 8) {
                  console.warn(`[KitabooFXL] Page ${pageNum}: audio is ${audioDurationSec.toFixed(1)}s but page has only ${textZones.length} segments. Use one clip per page (page_${pageNum}.mp3 = narration for page ${pageNum} only).`);
                }
                if (alignmentResult.length >= 2) {
                  const last = alignmentResult[alignmentResult.length - 1];
                  const lastDur = last.endTime - last.startTime;
                  const avgOthers = alignmentResult.slice(0, -1).reduce((s, r) => s + (r.endTime - r.startTime), 0) / (alignmentResult.length - 1);
                  const GHOST_THRESHOLD_SEC = 60;
                  if (lastDur > GHOST_THRESHOLD_SEC && lastDur > avgOthers * 3) {
                    const capEnd = last.startTime + Math.min(GHOST_THRESHOLD_SEC, Math.max(avgOthers * 2, 10));
                    console.warn(`[KitabooFXL] Page ${pageNum}: capping "ghost" last segment (was ${lastDur.toFixed(1)}s) to ${(capEnd - last.startTime).toFixed(1)}s. Use one clip per page.`);
                    alignmentResult[alignmentResult.length - 1] = { ...last, endTime: capEnd };
                  }
                }

                const guardedAlignment = enforceMonotonic(alignmentResult);
                const alignmentMap = Object.fromEntries(guardedAlignment.map(r => [r.id, { startTime: r.startTime, endTime: r.endTime }]));
                const pagePrefix = `p${pageNum}`;
                const xhtmlHasZ0 = (zonesForXhtmlPre || []).some(z => {
                  const zid = String(z.id || '');
                  return zid === `${pagePrefix}_z0` || zid.startsWith(`${pagePrefix}_z0_`);
                });
                const alignmentHasZ0 = !!alignmentMap[`${pagePrefix}_z0`];
                const getAlignmentTime = (rawId) => {
                  const id = String(rawId || '').trim();
                  if (!id) return null;
                  const altId = id.replace(/_z\d+_/g, '_');
                  if (altId !== id) return alignmentMap[altId] || null;
                  const m = id.match(/^(p\d+)_z(\d+)(.*)$/);
                  if (m) {
                    const page = m[1];
                    const zNum = parseInt(m[2], 10);
                    const suffix = m[3] || '';
                    if (suffix === '' && alignmentHasZ0 && !xhtmlHasZ0 && zNum >= 1) {
                      const shiftedId = `${page}_z${zNum - 1}${suffix}`;
                      if (alignmentMap[shiftedId]) return alignmentMap[shiftedId];
                    }
                  }
                  const direct = alignmentMap[id];
                  if (direct) return direct;
                  if (m) {
                    const page = m[1];
                    const zNum = parseInt(m[2], 10);
                    const suffix = m[3] || '';
                    const candidates = [`${page}_z${zNum + 1}${suffix}`, `${page}_z${zNum - 1}${suffix}`];
                    for (const c of candidates) {
                      const t = alignmentMap[c];
                      if (t) return t;
                    }
                  }
                  return null;
                };
                pageDuration = guardedAlignment.length > 0
                  ? Math.max(...guardedAlignment.map(r => r.endTime))
                  : 0;
                smilDurations[`smil${pageNum}`] = pageDuration;

                const lineFragmentGroups = {};
                const regularZones = [];
                zonesForSmilGroup.forEach(zone => {
                  if (zone.isLineFragment && zone.baseZoneId) {
                    if (!lineFragmentGroups[zone.baseZoneId]) lineFragmentGroups[zone.baseZoneId] = [];
                    lineFragmentGroups[zone.baseZoneId].push(zone);
                  } else {
                    regularZones.push(zone);
                  }
                });
                const sortedFragmentGroups = Object.entries(lineFragmentGroups)
                  .map(([baseId, fragments]) => ({
                    baseId,
                    fragments: fragments.sort((a, b) => (a.lineIndex || 0) - (b.lineIndex || 0)),
                    readingOrder: fragments[0].readingOrder || 999
                  }))
                  .sort((a, b) => a.readingOrder - b.readingOrder);
                const allZoneGroups = [
                  ...regularZones.map(z => ({ type: 'regular', zone: z, readingOrder: z.readingOrder || 999 })),
                  ...sortedFragmentGroups.map(g => ({ type: 'fragment', ...g, readingOrder: g.readingOrder }))
                ].sort((a, b) => a.readingOrder - b.readingOrder);

                const propagatedBasesPerPage = new Set();
                allZoneGroups.forEach(group => {
                  if (group.type === 'fragment') {
                    const frags = group.fragments;
                    const times = frags.map(f => getAlignmentTime(f.id)).filter(Boolean);
                    if (times.length === 0) return;
                    const startTime = Math.min(...times.map(t => t.startTime));
                    const endTime = Math.max(...times.map(t => t.endTime));
                    frags.forEach(frag => {
                      smilFragments.push({ id: frag.id, startTime, endTime });
                    });
                  } else {
                    const zone = group.zone;
                    const t = getAlignmentTime(zone.id);
                    if (t) {
                      smilFragments.push({ id: zone.id, startTime: t.startTime, endTime: t.endTime });
                      return;
                    }
                    const wordMatch = String(zone.id || '').match(/_w(\d+)$/);
                    if (wordMatch) {
                      const baseId = zone.id.replace(/_w\d+$/, '');
                      const sent = getAlignmentTime(baseId);
                      if (sent && !propagatedBasesPerPage.has(baseId)) {
                        const wordZones = regularZones.filter(z => z.id && String(z.id).replace(/_w\d+$/, '') === baseId);
                        wordZones.sort((a, b) => {
                          const na = parseInt((a.id || '').match(/_w(\d+)$/)?.[1] ?? '0', 10);
                          const nb = parseInt((b.id || '').match(/_w(\d+)$/)?.[1] ?? '0', 10);
                          return na - nb;
                        });
                        const totalChars = wordZones.reduce((sum, z) => sum + (z.content || '').length, 0);
                        if (totalChars > 0) {
                          const dur = sent.endTime - sent.startTime;
                          let cumulative = 0;
                          wordZones.forEach(wz => {
                            const wordChars = (wz.content || '').length;
                            const startTime = sent.startTime + (cumulative / totalChars) * dur;
                            const endTime = startTime + (wordChars / totalChars) * dur;
                            smilFragments.push({ id: wz.id, startTime, endTime });
                            cumulative += wordChars;
                          });
                          propagatedBasesPerPage.add(baseId);
                        }
                      }
                    }
                  }
                });
                // Align fragment IDs to expanded XHTML zone IDs so player highlighting works
                smilFragments = KitabooFxlService.alignSmilFragmentsToExpandedZones(smilFragments, zonesForXhtmlPre);
                // SMIL order = reading order (no sort by startTime)
                let guardedFragments = enforceMonotonic(smilFragments, 0.001);
                const renderedIdsPerPage = KitabooFxlService.mergeRenderedIdsForSmilFilter(
                  zonesForXhtmlPre,
                  syncLevel,
                  guardedAlignment
                );
                guardedFragments = guardedFragments.filter(f => renderedIdsPerPage.has(String(f.id || '')));
                if (guardedFragments.length === 0 && guardedAlignment.length > 0) {
                  const fb = KitabooFxlService.buildSmilFragmentsFromAlignmentRows(
                    zonesForXhtmlPre,
                    syncLevel,
                    guardedAlignment
                  );
                  guardedFragments = enforceMonotonic(fb, 0.001);
                  if (guardedFragments.length > 0) {
                    pageDuration = guardedFragments.length > 0
                      ? Math.max(...guardedFragments.map(r => r.endTime))
                      : pageDuration;
                    smilDurations[`smil${pageNum}`] = pageDuration;
                    console.warn(`[KitabooFXL] Page ${pageNum}: per-page SMIL had 0 pars after filter; using alignment.json fallback (${guardedFragments.length} segments).`);
                  }
                }
                smilFragments = guardedFragments;
                pushSegmentsForSyncStudio(guardedFragments);
                const smilOptionsPerPage = {
                  minDurationSec: 0.05,
                  audioDurationSec: audioDurationSec > 0 ? audioDurationSec : undefined
                };
                const smilContent = EpubGenerator.generateFxlSmil({
                  xhtmlFileName,
                  audioFileName: `audio/${audioFileName}`,
                  jobId,
                  pageNum
                }, guardedFragments, smilOptionsPerPage);
                await fs.writeFile(path.join(epubDir, smilFileName), smilContent);
                if (guardedFragments.length > 0) {
                  console.log(`[KitabooFXL] Page ${pageNum}: SMIL (per-page) written with ${guardedFragments.length} fragments → ${xhtmlFileName}#${guardedFragments[0]?.id}…`);
                }
                manifest.push({ id: `smil${pageNum}`, href: smilFileName, mediaType: 'application/smil+xml' });
                manifest.push({ id: `audio${pageNum}`, href: `audio/${audioFileName}`, mediaType: 'audio/mpeg' });
                totalDuration += pageDuration;
              } catch (alignErr) {
                console.warn(`[KitabooFXL] Page ${pageNum} human alignment failed, falling back to TTS:`, alignErr.message);
              }
            }
          }
        }
      }

      if (pageText.trim() && !useHumanNarration && !hasAnySyncStudioAlignment) {
        // TTS only when no page has Sync Studio alignment; if any page has human sync, unsynced pages get no read-aloud
        // TTS drift fix: build allZoneGroups FIRST, then pageText from it so TTS receives
        // text in the exact order we consume timings (prevents word-index drift)
        const lineFragmentGroups = {};
        const regularZones = [];
        textZones.forEach(zone => {
          if (zone.isLineFragment && zone.baseZoneId) {
            if (!lineFragmentGroups[zone.baseZoneId]) lineFragmentGroups[zone.baseZoneId] = [];
            lineFragmentGroups[zone.baseZoneId].push(zone);
          } else {
            regularZones.push(zone);
          }
        });
        const sortedFragmentGroups = Object.entries(lineFragmentGroups)
          .map(([baseId, fragments]) => ({
            baseId,
            fragments: fragments.sort((a, b) => (a.lineIndex || 0) - (b.lineIndex || 0)),
            readingOrder: fragments[0].readingOrder || 999
          }))
          .sort((a, b) => a.readingOrder - b.readingOrder);
        const allZoneGroups = [...regularZones.map(z => ({ type: 'regular', zone: z, readingOrder: z.readingOrder || 999 })),
        ...sortedFragmentGroups.map(g => ({ type: 'fragment', ...g, readingOrder: g.readingOrder }))]
          .sort((a, b) => a.readingOrder - b.readingOrder);

        const pageTextFromGroups = allZoneGroups
          .map((g) => g.type === 'fragment' ? g.fragments.map((f) => (f.content || '').trim()).join(' ') : (g.zone.content || '').trim())
          .filter((s) => s.length > 0)
          .join(' ');

        const ttsDurationFactor = parseFloat(process.env.TTS_DURATION_SCALE_FACTOR || process.env.SMIL_AUDIO_DURATION_FACTOR || '0.92', 10);
        const ttsResult = await TtsService.synthesizePageAudio({
          text: pageTextFromGroups || pageText,
          audioOutPath: path.join(audioDir, audioFileName),
          voice: voice || {},
          durationScaleFactor: Number.isFinite(ttsDurationFactor) ? ttsDurationFactor : 0.92
        });

        if (ttsResult.audioFilePath) {
          const actualAudioDuration = TtsService.getMp3DurationSec(ttsResult.audioFilePath);
          pageDuration = actualAudioDuration != null && actualAudioDuration > 0
            ? actualAudioDuration
            : (ttsResult.timings.length > 0 ? ttsResult.timings[ttsResult.timings.length - 1].endTimeSec : 0);
          smilDurations[`smil${pageNum}`] = pageDuration;

          const totalZoneWords = allZoneGroups.reduce((sum, g) => {
            if (g.type === 'fragment') {
              return sum + g.fragments.reduce((s, f) => s + (f.content || '').split(/\s+/).filter((w) => w.length > 0).length, 0);
            }
            return sum + (g.zone.content || '').split(/\s+/).filter((w) => w.length > 0).length;
          }, 0);
          if (totalZoneWords !== ttsResult.timings.length) {
            console.warn(`[KitabooFXL] Page ${pageNum}: word count mismatch (zones: ${totalZoneWords}, TTS: ${ttsResult.timings.length}) — may cause slight sync drift`);
          }

          let timingIndex = 0;
          let lastUsedEndSec = 0;
          const remainingWordsFrom = (currentGroup) => {
            let count = 0;
            const idx = allZoneGroups.indexOf(currentGroup);
            for (let j = idx >= 0 ? idx : 0; j < allZoneGroups.length; j++) {
              const g = allZoneGroups[j];
              if (g.type === 'fragment') {
                count += g.fragments.reduce((s, f) => s + (f.content || '').split(/\s+/).filter((w) => w.length > 0).length, 0);
              } else {
                count += (g.zone.content || '').split(/\s+/).filter((w) => w.length > 0).length;
              }
            }
            return count;
          };

          allZoneGroups.forEach((group) => {
            if (group.type === 'fragment') {
              const fragments = group.fragments;
              const totalWords = fragments.reduce((sum, frag) => {
                const words = (frag.content || '').split(/\s+/).filter((w) => w.length > 0);
                return sum + words.length;
              }, 0);

              if (totalWords === 0) return;

              const firstTiming = ttsResult.timings[timingIndex];
              const lastIdx = Math.min(timingIndex + totalWords - 1, ttsResult.timings.length - 1);
              const lastTiming = ttsResult.timings[lastIdx];

              let startSec = firstTiming?.startTimeSec;
              let endSec = lastTiming?.endTimeSec;

              if (startSec == null || endSec == null) {
                const remWords = remainingWordsFrom(group);
                const remDur = Math.max(0, pageDuration - lastUsedEndSec);
                const step = remWords > 0 ? remDur / remWords : 0;
                startSec = lastUsedEndSec;
                endSec = lastUsedEndSec + totalWords * step;
              }

              if (startSec != null && endSec != null && endSec > startSec) {
                fragments.forEach((frag) => {
                  smilFragments.push({ id: frag.id, startTime: startSec, endTime: endSec });
                });
              }
              lastUsedEndSec = endSec != null ? endSec : lastUsedEndSec;
              timingIndex += totalWords;
            } else {
              const zone = group.zone;
              const zoneWords = (zone.content || '').split(/\s+/).filter((w) => w.length > 0);
              const isAlreadyWordLevel = zoneWords.length <= 1;
              const FALLBACK_WORD_DURATION_SEC = 0.2; // so merged/edited zones always get a par when Play is used

              if (syncLevel === 'word' && ttsResult.timings.length > 0) {
                const zoneIdAlreadyWord = /_w\d+$/.test(String(zone.id || ''));
                if (isAlreadyWordLevel && zoneWords.length === 1) {
                  const timing = ttsResult.timings[Math.min(timingIndex, ttsResult.timings.length - 1)];
                  const startSec = timing?.startTimeSec ?? lastUsedEndSec;
                  const endSec = timing?.endTimeSec ?? (lastUsedEndSec + FALLBACK_WORD_DURATION_SEC);
                  smilFragments.push({
                    id: zoneIdAlreadyWord ? zone.id : `${zone.id}_w0`,
                    startTime: startSec,
                    endTime: endSec
                  });
                  lastUsedEndSec = Math.max(lastUsedEndSec, endSec);
                  timingIndex++;
                } else {
                  zoneWords.forEach((word, wordIdx) => {
                    const timing = ttsResult.timings[Math.min(timingIndex, ttsResult.timings.length - 1)];
                    const startSec = timing?.startTimeSec ?? lastUsedEndSec;
                    const endSec = timing?.endTimeSec ?? (lastUsedEndSec + FALLBACK_WORD_DURATION_SEC);
                    smilFragments.push({
                      id: zoneIdAlreadyWord ? zone.id : `${zone.id}_w${wordIdx}`,
                      startTime: startSec,
                      endTime: endSec
                    });
                    lastUsedEndSec = Math.max(lastUsedEndSec, endSec);
                    timingIndex++;
                  });
                }
              } else {
                const firstTiming = ttsResult.timings[Math.min(timingIndex, ttsResult.timings.length - 1)];
                timingIndex += zoneWords.length;
                const lastTiming = ttsResult.timings[Math.min(timingIndex - 1, ttsResult.timings.length - 1)];

                let startSec = firstTiming?.startTimeSec;
                let endSec = lastTiming?.endTimeSec;
                if (startSec == null || endSec == null) {
                  const remWords = remainingWordsFrom(group);
                  const remDur = Math.max(0, pageDuration - lastUsedEndSec);
                  const step = remWords > 0 ? remDur / remWords : 0;
                  startSec = lastUsedEndSec;
                  endSec = lastUsedEndSec + zoneWords.length * step;
                }

                if (startSec != null && endSec != null && endSec > startSec) {
                  smilFragments.push({ id: zone.id, startTime: startSec, endTime: endSec });
                }
                lastUsedEndSec = endSec != null ? endSec : lastUsedEndSec;
              }
            }
          });
          // Align fragment IDs to expanded XHTML zone IDs so player highlighting works
          smilFragments = KitabooFxlService.alignSmilFragmentsToExpandedZones(smilFragments, zonesForXhtmlPre);
          // Ensure every expanded zone (e.g. merged+edited zones) has a SMIL par so Play reads them
          const fragmentIds = new Set(smilFragments.map((f) => f.id));
          let backfillEnd = smilFragments.length > 0 ? Math.max(...smilFragments.map((f) => f.endTime)) : 0;
          const renderedIdsTts = KitabooFxlService.buildRenderedIdsForSmil(zonesForXhtmlPre, syncLevel);
          for (const id of renderedIdsTts) {
            if (id && !fragmentIds.has(id)) {
              smilFragments.push({ id, startTime: backfillEnd, endTime: backfillEnd + 0.2 });
              backfillEnd += 0.2;
              fragmentIds.add(id);
            }
          }
          // SMIL order = reading order (no sort by startTime)
          let guardedFragments = enforceMonotonic(smilFragments, 0.001);
          guardedFragments = guardedFragments.filter(f => renderedIdsTts.has(String(f.id || '')));
          pushSegmentsForSyncStudio(guardedFragments);
          // SMIL_AUDIO_DURATION_FACTOR: 0.90 = highlights 10% faster. 1 = no change. Lower = faster.
          const durationFactor = parseFloat(process.env.SMIL_AUDIO_DURATION_FACTOR || '0.90', 10);
          const effectiveDuration = actualAudioDuration != null && !Number.isNaN(durationFactor) && durationFactor > 0 && durationFactor <= 1.5
            ? actualAudioDuration * Math.min(durationFactor, 1)
            : actualAudioDuration;
          const smilOptionsTts = {
            minDurationSec: 0.001,
            audioDurationSec: effectiveDuration
          };
          const smilContent = EpubGenerator.generateFxlSmil({
            xhtmlFileName,
            audioFileName: `audio/${audioFileName}`,
            jobId,
            pageNum
          }, guardedFragments, smilOptionsTts);

          await fs.writeFile(path.join(epubDir, smilFileName), smilContent);

          manifest.push({
            id: `smil${pageNum}`,
            href: smilFileName,
            mediaType: 'application/smil+xml'
          });
          manifest.push({
            id: `audio${pageNum}`,
            href: `audio/${audioFileName}`,
            mediaType: 'audio/mpeg'
          });

          totalDuration += pageDuration;

          try {
            const humanAudioDirForSync = path.join(intermediateDir, 'human_audio');
            await fs.mkdir(humanAudioDirForSync, { recursive: true });
            const srcMp3 = path.join(audioDir, audioFileName);
            await fs.copyFile(srcMp3, path.join(humanAudioDirForSync, audioFileName));
          } catch (copyErr) {
            console.warn(`[KitabooFXL] Page ${pageNum}: could not mirror TTS MP3 to human_audio (Sync Studio audio URL):`, copyErr.message);
          }
        }
      }

      // Use image pixel dimensions for viewport so zone coordinates (from Hi-Fi in same space) match 1:1 in Thorium/readers.
      // Avoids "coordinate far away" from points vs pixels or wrong scale.
      const viewportWidth = page.dimensions.width || 1200;
      const viewportHeight = page.dimensions.height || 1600;
      const scaleX = 1;
      const scaleY = 1;

      // EXACT condition: glyph layout (one .t per glyph + word wrappers) ONLY when extraction===glyph AND zoneLevel===word.
      // Else: build from scaledZones (sentence-level or non–Hi-Fi jobs).
      const pageCoords = glyphCoordsByPage && glyphCoordsByPage[pageNum];
      const useGlyphLayout = options.renderMode === 'absolute-html' && extractionLevelFromJob === 'glyph' && zoneLevelFromJob === 'word' && pageCoords && Array.isArray(pageCoords.items) && pageCoords.items.length > 0;
      const zonesForXhtml = KitabooFxlService.expandZonesToSyncLevelInMemory(pageZones, syncLevel, useGlyphLayout ? { extractionLevel: 'glyph' } : {});
      const scaledZones = zonesForXhtml.map(z => {
        const scaled = {
          ...z,
          x: z.x * scaleX,
          y: z.y * scaleY,
          w: z.w * scaleX,
          h: z.h * scaleY,
          fontSize: z.fontSize * scaleY,
          origin: z.origin ? [z.origin[0] * scaleX, z.origin[1] * scaleY] : null,
        };
        if (Array.isArray(z.styleRuns) && z.styleRuns.length > 0) scaled.styleRuns = z.styleRuns;
        if (Array.isArray(z.points) && z.points.length >= 3) {
          scaled.points = z.points.map(p => Array.isArray(p)
            ? [p[0] * scaleX, p[1] * scaleY]
            : [p.x * scaleX, p.y * scaleY]);
        } else if (scaled.x != null && scaled.y != null && scaled.w != null && scaled.h != null) {
          scaled.points = KitabooFxlService.bboxToPoints(scaled.x, scaled.y, scaled.w, scaled.h);
        }
        if (Array.isArray(z.lines) && z.lines.length > 0) {
          scaled.lines = z.lines.map(ln => ({
            ...ln,
            origin: ln.origin ? [ln.origin[0] * scaleX, ln.origin[1] * scaleY] : ln.origin,
            bbox: ln.bbox && ln.bbox.length >= 4
              ? [ln.bbox[0] * scaleX, ln.bbox[1] * scaleY, ln.bbox[2] * scaleX, ln.bbox[3] * scaleY]
              : ln.bbox,
          }));
        }
        return scaled;
      });

      // Absolute-html + glyph: use raw glyph coords for layout so one .t per glyph; SMIL targets word/sentence wrappers.
      const coordScaleX = pageCoords ? (viewportWidth / (pageCoords.width || page.dimensions.width)) : scaleX;
      const coordScaleY = pageCoords ? (viewportHeight / (pageCoords.height || page.dimensions.height)) : scaleY;
      const xhtmlPayload = useGlyphLayout
        ? pageCoords.items.map(it => {
          const ox = (it.origin && it.origin[0] != null) ? it.origin[0] : (it.bbox && it.bbox[0] != null ? it.bbox[0] : 0);
          const oy = (it.origin && it.origin[1] != null) ? it.origin[1] : (it.bbox && it.bbox[1] != null ? it.bbox[1] : 0);
          return {
            text: it.text,
            origin: [ox * coordScaleX, oy * coordScaleY],
            bbox: it.bbox && it.bbox.length >= 4
              ? [it.bbox[0] * coordScaleX, it.bbox[1] * coordScaleY, it.bbox[2] * coordScaleX, it.bbox[3] * coordScaleY]
              : null,
            word_id: it.word_id ?? it.wordId,
            sentence_id: it.sentence_id ?? it.sentenceId,
            size: (it.size || 12) * coordScaleY,
            font: it.font,
            color: it.color
          };
        })
        : scaledZones;

      console.log(`[KitabooFXL] Page ${pageNum}: isClean=${isClean}, image=${imageFileName}, transparentText=${!isClean} (to preserve artistic style: ${!isClean})`);
      const pageCssFileName = `page${pageNum}.css`;
      const pageCssHref = `css/${pageCssFileName}`;
      const xhtmlResult = EpubGenerator.generateFxlPage({
        width: viewportWidth,
        height: viewportHeight,
        imageName: imageFileName,
        pageNum: pageNum
      }, xhtmlPayload, {
        syncLevel,
        // Sentences should always be visible, even when read-aloud is not active.
        // Do not make text transparent on any page.
        transparentText: false,
        fontMap: activeFontMap,
        renderMode: options.renderMode,
        extractedFonts,
        extractionLevel: useGlyphLayout ? 'glyph' : undefined,
        pageCssHref,
        fxlBodyFontFamily
      });

      const xhtmlContent = typeof xhtmlResult === 'object' && xhtmlResult != null && xhtmlResult.xhtml != null
        ? xhtmlResult.xhtml
        : xhtmlResult;
      await fs.writeFile(path.join(epubDir, xhtmlFileName), xhtmlContent);

      if (typeof xhtmlResult === 'object' && xhtmlResult != null && xhtmlResult.pageCss != null) {
        await fs.writeFile(path.join(epubDir, 'css', pageCssFileName), xhtmlResult.pageCss, 'utf8');
        manifest.push({ id: `page${pageNum}_css`, href: pageCssHref, mediaType: 'text/css' });
      }

      manifest.push({
        id: `page${pageNum}`,
        href: xhtmlFileName,
        mediaType: 'application/xhtml+xml',
        properties: smilFragments.length > 0 ? 'media-overlay' : null,
        mediaOverlay: smilFragments.length > 0 ? `smil${pageNum}` : null
      });

      const imgProps = i === 0 ? 'cover-image' : null;
      manifest.push({ id: `img${pageNum}`, href: `images/${imageFileName}`, mediaType: mediaType, properties: imgProps });

      spine.push({
        idref: `page${pageNum}`,
        mediaOverlay: smilFragments.length > 0 ? `smil${pageNum}` : undefined
      });
    }

    if (mergedSyncStudioSegments.length > 0 && !globalAlignmentJsonWritten) {
      const alignmentPathOut = path.join(intermediateDir, 'alignment.json');
      try {
        await fs.writeFile(
          alignmentPathOut,
          JSON.stringify({ segments: mergedSyncStudioSegments }, null, 2),
          'utf8'
        );
        console.log(`[KitabooFXL] Wrote alignment.json for Sync Studio reader (${mergedSyncStudioSegments.length} segments from TTS / per-page SMIL).`);
      } catch (e) {
        console.warn('[KitabooFXL] Failed to write alignment.json:', e.message);
      }
    }

    const opfContent = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
        <dc:identifier id="pub-id">urn:uuid:${bookUuid}</dc:identifier>
        <dc:title>Professional FXL Export</dc:title>
        <dc:creator>FXL Engine</dc:creator>
        <dc:date>${new Date().toISOString().split('T')[0]}</dc:date>
        <dc:language>en</dc:language>
        <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
        <meta property="rendition:layout">pre-paginated</meta>
        <meta property="rendition:orientation">auto</meta>
        <meta property="rendition:spread">auto</meta>
        <meta property="media:duration">${totalDuration.toFixed(3)}s</meta>
        ${Object.entries(smilDurations).map(([id, dur]) => `<meta property="media:duration" refines="#${id}">${dur.toFixed(3)}s</meta>`).join('\n        ')}
        ${Object.keys(smilDurations).length > 0 ? '<meta property="media:active-class">-epub-media-overlay-active</meta>\n        <meta property="media:playback-active-class">-epub-media-overlay-playing</meta>' : ''}
        ${manifest.find(i => i.properties === 'cover-image') ? `<meta name="cover" content="${manifest.find(i => i.properties === 'cover-image').id}"/>` : ''}
    </metadata>
    <manifest>
        ${useReferenceStructure ? '' : '<item id="css" href="css/style.css" media-type="text/css"/>\n        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'}
        ${manifest.map(item => `<item id="${item.id}" href="${item.href}" media-type="${item.mediaType}"${item.properties ? ` properties="${item.properties}"` : ''}${item.mediaOverlay ? ` media-overlay="${item.mediaOverlay}"` : ''}/>`).join('\n        ')}
    </manifest>
    <spine>
        ${spine.map(entry => {
      const idref = typeof entry === 'string' ? entry : entry.idref;
      const mediaOverlay = typeof entry === 'object' && entry.mediaOverlay ? entry.mediaOverlay : null;
      return `<itemref idref="${idref}"${mediaOverlay ? ` media-overlay="${mediaOverlay}"` : ''}/>`;
    }).join('\n        ')}
    </spine>
</package>`;

    await fs.writeFile(path.join(epubDir, 'content.opf'), opfContent);

    const navContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
    <nav epub:type="toc">
        <h1>Table of Contents</h1>
        <ol>
            ${spine.map((entry, idx) => {
      const idref = typeof entry === 'string' ? entry : entry.idref;
      return `<li><a href="${useReferenceStructure ? idref + '.xhtml' : 'page' + (idx + 1) + '.xhtml'}">Page ${idx + 1}</a></li>`;
    }).join('\n            ')}
        </ol>
    </nav>
</body>
</html>`;
    await fs.writeFile(path.join(epubDir, 'nav.xhtml'), navContent);

    const metaInfDir = path.join(tempDir, 'META-INF');
    await fs.mkdir(metaInfDir, { recursive: true });
    const rootFilePath = contentPrefix + '/content.opf';
    await fs.writeFile(path.join(metaInfDir, 'container.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="${rootFilePath}" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`);
    if (embeddedFontHrefs.length > 0 && process.env.FXL_OBFUSCATE_FONTS !== '0') {
      const encEntries = embeddedFontHrefs.map(href => `    <enc:EncryptedData>
      <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
      <enc:CipherData><enc:CipherReference href="../${contentPrefix}/${href}"/></enc:CipherData>
    </enc:EncryptedData>`).join('\n');
      await fs.writeFile(path.join(metaInfDir, 'encryption.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
${encEntries}
</encryption>`);
      console.log('[KitabooFXL] META-INF/encryption.xml written for font obfuscation');
    }
    await fs.writeFile(path.join(tempDir, 'mimetype'), 'application/epub+zip');

    const epubFileName = `fxl_${jobId}.epub`;
    const finalPath = path.join(outputDir, epubFileName);
    await new Promise((resolve, reject) => {
      const output = createWriteStream(finalPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(path.join(tempDir, 'mimetype'), { name: 'mimetype', store: true });
      archive.directory(metaInfDir, 'META-INF');
      archive.directory(epubDir, useReferenceStructure ? 'OPS' : 'EPUB');
      archive.finalize();
    });

    // Post-assembly check: verify generated EPUB structure
    const checkResult = await KitabooFxlService.checkGeneratedEpub(finalPath);
    if (checkResult.ok) {
      console.log(`[KitabooFXL] FXL EPUB assembled at ${finalPath} (${checkResult.pages} pages, ${checkResult.smilCount} SMIL, ${checkResult.audioCount} audio)`);
    } else {
      console.warn(`[KitabooFXL] FXL EPUB written at ${finalPath} but validation reported: ${checkResult.error}`);
    }
    return finalPath;
  }

  /**
   * Check generated FXL EPUB: required entries and basic structure.
   * @param {string} epubPath - Path to fxl_<jobId>.epub
   * @returns {Promise<{ok: boolean, pages?: number, smilCount?: number, audioCount?: number, error?: string}>}
   */
  static async checkGeneratedEpub(epubPath) {
    try {
      const JSZip = (await import('jszip')).default;
      const buf = await fs.readFile(epubPath);
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files);

      const has = (p) => names.some(n => n === p || n.startsWith(p + '/'));

      if (!names.includes('mimetype')) return { ok: false, error: 'missing mimetype' };
      const mimetypeEntry = zip.files['mimetype'];
      // JSZip internal compression method 0 is STORE (uncompressed)
      const isUncompressed = mimetypeEntry._data?.compression?.method === 0 ||
        mimetypeEntry.options?.compression === 'STORE' ||
        mimetypeEntry.compression === 'STORE';

      if (!isUncompressed && mimetypeEntry._data?.compression?.method !== undefined) {
        return { ok: false, error: 'mimetype must be uncompressed' };
      }

      if (!has('META-INF/container.xml')) return { ok: false, error: 'missing META-INF/container.xml' };
      const hasOps = has('OPS/content.opf');
      const hasEpub = has('EPUB/content.opf');
      const hasOebps = has('OEBPS/content.opf');
      let contentPrefix = null;
      let isGeneratedLayout = false;
      if (hasOps) {
        contentPrefix = 'OPS/';
        isGeneratedLayout = true;
      } else if (hasEpub) {
        contentPrefix = 'EPUB/';
        isGeneratedLayout = true;
      } else if (hasOebps) {
        contentPrefix = 'OEBPS/';
      } else {
        const opf = names.find(n => /(^|\/)content\.opf$/i.test(n) && !n.includes('META-INF'));
        if (!opf) return { ok: false, error: 'missing content.opf' };
        contentPrefix = opf.includes('/') ? opf.replace(/[^/]+$/, '') : '';
      }

      if (isGeneratedLayout) {
        if (!has(contentPrefix + 'nav.xhtml')) return { ok: false, error: 'missing nav.xhtml' };
        if (hasOps && !has('OPS/default.css')) return { ok: false, error: 'missing OPS/default.css' };
        if (hasEpub && !has('EPUB/css/style.css')) return { ok: false, error: 'missing EPUB/css/style.css' };
      }

      const norm = (n) => n.replace(/\\/g, '/');
      const pageXhtml = isGeneratedLayout
        ? names.filter(n => norm(n).startsWith(contentPrefix + 'page') && n.endsWith('.xhtml')).length
        : names.filter(n => {
            const nn = norm(n);
            return nn.startsWith(contentPrefix) && n.endsWith('.xhtml') && !/nav\.xhtml$/i.test(nn);
          }).length;

      const smilCount = names.filter(n => (norm(n).includes('/smil/') || n.includes('\\smil\\')) && n.endsWith('.smil')).length;
      const audioCount = names.filter(n => (norm(n).includes('/audio/') || n.includes('\\audio\\')) && /\.(mp3|m4a|wav)$/i.test(n)).length;

      if (pageXhtml < 1) return { ok: false, error: 'no XHTML documents in package' };

      return { ok: true, pages: pageXhtml, smilCount, audioCount };
    } catch (e) {
      return { ok: false, error: e.message || 'failed to read EPUB' };
    }
  }

}
