import fs from 'fs/promises';
import path from 'path';
import { GeminiService } from './geminiService.js';
import { KitabooZoneModel } from '../models/KitabooZone.js';

/**
 * High-fidelity pipeline tail: Gemini page typing, zone build, AI font/style passes, metadata.
 * Extracted from KitabooFxlService.processPdfHighFidelity for preview-first + HD upgrade flows.
 */
export async function finalizeHighFidelityPipeline(K, ctx) {
  const {
    jobId,
    pdfId,
    pdfPath,
    intermediateDir,
    renderedDir,
    renderResult,
    coordsResult,
    cleanupSuccess,
    zoneLevel,
    extractionLevel,
    options,
    report,
    progressDelegate
  } = ctx;
  const rep = typeof progressDelegate === 'function' ? progressDelegate : report;
  const zoneBuildPageFilter = typeof options?.zoneBuildPageFilter === 'function' ? options.zoneBuildPageFilter : null;
  const geminiPageFilter = typeof options?.geminiPageFilter === 'function' ? options.geminiPageFilter : null;
  let existingMap = null;
  if (ctx.existingPagesByNumber instanceof Map) {
    existingMap = ctx.existingPagesByNumber;
  } else if (ctx.existingPagesByNumber && typeof ctx.existingPagesByNumber === 'object') {
    existingMap = new Map(
      Object.entries(ctx.existingPagesByNumber).map(([k, v]) => [Number(k), v])
    );
  }

    rep(90, 'Phase 3: Structuring Data...');

    if (!coordsResult || coordsResult.length === 0) {
      console.warn('[KitabooFXL] No coordinate data from extraction; zone building will produce no zones.');
    }

    // Use Gemini to classify page types (cover, back, toc, chapter title, regular) so we can
    // apply cover-style word grouping and other special rules without hardcoding page numbers.
    const pageTypeByNumber = {};
    if (ctx.seedPageTypes && typeof ctx.seedPageTypes === 'object') {
      Object.assign(pageTypeByNumber, ctx.seedPageTypes);
    }
    if (process.env.GEMINI_API_KEY) {
      try {
        for (const img of renderResult.images) {
          if (geminiPageFilter && !geminiPageFilter(img.pageNumber)) {
            continue;
          }
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
            ], { modelName: 'gemini-2.5-flash', priority: 'low' });

            const parsed = K.safeParseJsonObject(response);
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

    // Fallback: page 1 as chapter opener when sentence-level (title + body sentence); true cover only for word-level.
    if (Object.keys(pageTypeByNumber).length === 0 && renderResult.images.length > 0) {
      pageTypeByNumber[1] = zoneLevel === 'sentence' ? 'chapterTitle' : 'cover';
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
      if (zoneBuildPageFilter && !zoneBuildPageFilter(img.pageNumber)) {
        const cached = existingMap?.get(img.pageNumber);
        if (cached) {
          pages.push({
            ...cached,
            zones: Array.isArray(cached.zones) ? [...cached.zones] : []
          });
        } else {
          console.warn(`[KitabooFXL] Zone build skip: no cached page ${img.pageNumber} (append/preview merge).`);
        }
        continue;
      }
      const pageCoords = coordsResult.find(p => p.page === img.pageNumber);
      const tocPage = tocEndPage > 0 && img.pageNumber <= tocEndPage;
      const pageType = pageTypeByNumber[img.pageNumber]
        || (img.pageNumber === 1 ? (zoneLevel === 'sentence' ? 'chapterTitle' : 'cover') : 'regular');
      const isCoverStylePage = pageType === 'cover' || pageType === 'back' || pageType === 'chapterTitle';

      // Determine if we use the clean image (if cleanup succeeded and file exists)
      let useCleanImage = false;
      const cleanImgName = `page_${img.pageNumber}_clean.png`;
      const cleanImgPath = path.join(renderedDir, cleanImgName);

      if (cleanupSuccess) {
        try {
          await fs.access(cleanImgPath);
          useCleanImage = K.shouldUseCleanImage(img.pageNumber, pageCoords?.items);
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
      // Sentence-level: only true front/back covers use word grouping (spaced badge titles). Chapter openers
      // and content pages use sentence_id so title + body are one zone per sentence, not one zone per word.
      const isCoverPage = zoneLevel === 'sentence' && (pageType === 'cover' || pageType === 'back');
      const useWordGroupingThisPage = isCoverPage || (zoneLevel === 'word');
      if (isCoverPage) {
        console.log(`[KitabooFXL] Page ${img.pageNumber} (${pageType}) using word-level grouping for cover/back hero titles.`);
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
          out = K.normalizeAbbreviationCorruption(out);
          // RCA: Fix common last-glyph truncations in some credit-role words ("Directo" -> "Director", "Publishe" -> "Publisher").
          out = K.normalizeCommonTruncations(out);
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
            // Slightly tighter Y band on body pages so wrapped sentences become multiple lineGroups → item.lines → correct absolute HTML.
            const lineThresholdY = Math.max(fontSize * (tocPage ? 0.4 : 0.28), 3);
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
            // If everything stayed in one group but glyphs span multiple text rows, split by Y-band (fixes Thorium/epub.js stacked text on absolute-html export).
            if (!tocPage && lineGroups.length === 1 && lineGroups[0].glyphs.length > 2) {
              const g0 = lineGroups[0];
              const minY = Math.min(...g0.bboxes.map((bb) => bb[1]));
              const maxY = Math.max(...g0.bboxes.map((bb) => bb[3]));
              const spread = maxY - minY;
              if (spread > fontSize * 1.15) {
                const lineHeight = Math.max(fontSize * 1.05, spread / Math.max(2, Math.round(spread / (fontSize * 1.05))));
                const buckets = [];
                for (let i = 0; i < g0.glyphs.length; i++) {
                  const b = g0.bboxes[i];
                  const cy = (b[1] + b[3]) / 2;
                  let placed = false;
                  for (const bucket of buckets) {
                    if (Math.abs(cy - bucket.y) <= lineHeight * 0.42) {
                      bucket.glyphs.push(g0.glyphs[i]);
                      bucket.bboxes.push(b);
                      const n = bucket.glyphs.length;
                      bucket.y += (cy - bucket.y) / n;
                      placed = true;
                      break;
                    }
                  }
                  if (!placed) buckets.push({ y: cy, glyphs: [g0.glyphs[i]], bboxes: [b] });
                }
                buckets.sort((a, b) => a.y - b.y);
                if (buckets.length > 1) {
                  lineGroups.length = 0;
                  for (const bucket of buckets) {
                    lineGroups.push({ y: bucket.y, glyphs: bucket.glyphs, bboxes: bucket.bboxes });
                  }
                }
              }
            }
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
        zone.points = K.bboxToPoints(zone.x, zone.y, (zone.w || 0) + pad, (zone.h || 0) + pad);
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
          zone.points = K.linesToOutlinePoints(zone.lines, { defaultW: zone.w / zone.lines.length, defaultH: (zone.fontSize || 12) * 1.2 });
        }
        return zone;
      });

      // Collect unique font names for AI font mapping
      const pageFonts = [...new Set(zones.filter(z => z.fontFamily).map(z => z.fontFamily))];

      // tocPage set at start of page loop (pages before and including TOC get rectangle zones, no sentence-level rules)
      // Multi-column: compute column split before clustering so we don't merge "Consultant" + "Publishing Credits" into one zone
      const pageWidthForColumns = img.width || img.dimensions?.width || (pageCoords && pageCoords.width) || 0;
      const colResult = (tocPage && pageWidthForColumns > 0 && zones.length >= 2)
        ? K.detectColumnSplitX(zones, pageWidthForColumns)
        : null;
      const columnSplitX = (colResult && colResult.splitX != null) ? colResult.splitX : null;

      // Sentence-level (except cover-style pages): split any zone that contains multiple sentences into one zone per sentence.
      let zonesToCluster = zones;
      if (zoneLevel === 'sentence' && !isCoverPage && zones.length > 0) {
        let before = zones.length;
        zonesToCluster = K.splitMultiSentenceZones(zones, img.pageNumber);
        if (zonesToCluster.length !== before) {
          console.log(`[KitabooFXL] Page ${img.pageNumber}: split multi-sentence zones ${before} -> ${zonesToCluster.length}.`);
        }
        before = zonesToCluster.length;
        zonesToCluster = K.splitZonesByVerticalGaps(zonesToCluster, img.pageNumber);
        if (zonesToCluster.length !== before) {
          console.log(`[KitabooFXL] Page ${img.pageNumber}: split vertical-gap zones ${before} -> ${zonesToCluster.length}.`);
        }
      }
      // New: Cluster and Deduplicate Spans to fix character overlap and redundant PDF layers.
      // Word-level zones (and cover when sentence-level uses word grouping): no merge so we keep one zone per word.
      // Sentence-level zones: allow clustering/line merging.
      const effectiveExtractionLevel = useWordGroupingThisPage ? 'word' : zoneLevel;
      let clusteredZones = (effectiveExtractionLevel === 'word')
        ? zonesToCluster
        : K.clusterAndDeduplicateSpans(zonesToCluster, { extractionLevel: effectiveExtractionLevel, tocPage, columnSplitX });
      // Rule: one single-line zone for URLs (merge "http://www." + "tcmpub." + "com" into one zone at extraction/grouping).
      if (effectiveExtractionLevel === 'sentence' && clusteredZones.length > 0) {
        clusteredZones = K.mergeConsecutiveUrlZones(clusteredZones);
        const beforeGap = clusteredZones.length;
        clusteredZones = K.splitZonesByVerticalGaps(clusteredZones, img.pageNumber);
        if (clusteredZones.length !== beforeGap) {
          console.log(`[KitabooFXL] Page ${img.pageNumber}: post-cluster vertical-gap split ${beforeGap} -> ${clusteredZones.length}.`);
        }
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
          const outline = K.linesToOutlinePoints(z.lines, { defaultW: (z.w || 100) / z.lines.length, defaultH: (z.fontSize || 12) * 1.2, paddingLeft: clipPadL, paddingTop: clipPadT });
          if (outline) z.points = outline;
          else z.points = K.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        } else {
          z.points = K.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        }
      });

      // Multi-column layout (TOC/intro): first column all rows, then second column all rows; one block per row
      const pageWidth = img.width || img.dimensions?.width || (pageCoords && pageCoords.width) || 0;
      let finalZones = (tocPage && clusteredZones.length >= 2 && pageWidth > 0)
        ? K.reorderZonesForMultiColumnLayout(clusteredZones, pageWidth)
        : clusteredZones;
      if (tocPage && finalZones !== clusteredZones) {
        console.log(`[KitabooFXL] Page ${img.pageNumber}: multi-column layout applied (${clusteredZones.length} zones, column-first order).`);
      }

      // RCA fix: Image Credits (and similar) have one line with multiple items separated by ";". Split into one zone per item (after reorder so full-width lines stay in order).
      if (tocPage && finalZones.length > 0) {
        finalZones = K.splitSemicolonSeparatedZones(finalZones, `p${img.pageNumber}`);
      }

      // Till TOC we have rectangle boxes: on TOC/pre-TOC pages (pageNumber <= tocEndPage) every zone must be a rectangle (4-point bbox), never polygon outline.
      if (tocPage && finalZones.length > 0) {
        const clipPadL = 6;
        const clipPadT = 6;
        // Slightly larger right padding so the last glyph isn't "cut" by the zone box (common on right column lines).
        const clipPadR = 10;
        const clipPadB = 2;
        finalZones.forEach((z) => {
          z.points = K.bboxToPoints(z.x - clipPadL, z.y - clipPadT, (z.w || 0) + clipPadL + clipPadR, (z.h || 0) + clipPadT + clipPadB);
        });
      }

      // Final pass: one zone per sentence; split heading vs body across image gaps (no diagonal mega-polygons).
      if (zoneLevel === 'sentence' && !isCoverPage && !tocPage && finalZones.length > 0) {
        const beforeNorm = finalZones.length;
        finalZones = K.normalizeSentenceLevelZones(finalZones, img.pageNumber);
        if (finalZones.length !== beforeNorm) {
          console.log(`[KitabooFXL] Page ${img.pageNumber}: normalized sentence zones ${beforeNorm} -> ${finalZones.length}.`);
        }
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
        const mappingJson = await GeminiService.generateContent(prompt, { modelName: 'gemini-2.5-flash' });
        const mapping = K.safeParseJsonObject(mappingJson);
        if (mapping && typeof mapping === 'object') {
          K._fontMappingCache = K._fontMappingCache || {};
          K._fontMappingCache[jobId] = mapping;
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
          const pt = pageTypeByNumber[page.pageNumber]
            || (page.pageNumber === 1 ? (zoneLevel === 'sentence' ? 'chapterTitle' : 'cover') : 'regular');
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
          ], { modelName: 'gemini-2.5-flash' });

          const styleMap = K.safeParseJsonObject(response);
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
        rep(98, 'Phase 4b: Artistic Styles Applied');
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
        woff2Filename: K.isWoff2ConvertibleFont(filename)
          ? K.getWoff2FileName(filename)
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
          woff2Filename: K.isWoff2ConvertibleFont(f)
            ? K.getWoff2FileName(f)
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
      fontMapping: K._fontMappingCache[jobId] || {},
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

    if (ctx.isPreviewPass) {
      report(48, 'Preview ready — rendering remaining pages in the background…');
    } else {
      rep(100, 'Complete');
    }
    return { jobId, pages, extractedFonts, pageTypeByNumber };
}
