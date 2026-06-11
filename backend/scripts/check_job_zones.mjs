/**
 * Per-page zone reading-order audit for a Kitaboo FXL job.
 * Usage: node backend/scripts/check_job_zones.mjs <jobId>
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KitabooFxlService as S } from '../src/services/KitabooFxlService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobId = process.argv[2] || '1781177872796';
const jobDir = path.resolve(__dirname, '../html_intermediate', `kitaboo_${jobId}`, 'high_fidelity_render');

function clusterRows(zones, slop = 12) {
  const sorted = [...zones].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const rows = [];
  for (const z of sorted) {
    const y = z.y ?? 0;
    let row = rows.find((r) => Math.abs((r[0].y ?? 0) - y) < slop);
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(z);
  }
  return rows.map((r) => r.sort((a, b) => (a.x ?? 0) - (b.x ?? 0)));
}

/** Detect zig-zag: row reads L-R-L-R across page midline. */
function detectZigZag(zones, pageWidth) {
  const mid = pageWidth * 0.5;
  const issues = [];
  for (const row of clusterRows(zones)) {
    if (row.length < 3) continue;
    const sides = row.map((z) => ((z.x ?? 0) + (z.w ?? 0) / 2) < mid ? 'L' : 'R');
    let flips = 0;
    for (let i = 1; i < sides.length; i++) {
      if (sides[i] !== sides[i - 1]) flips++;
    }
    if (flips >= 2 && row.length >= 4) {
      const words = row.map((z) => `${z.readingOrder}:${z.content}`).join(' | ');
      issues.push({ type: 'zigzag', words, flips });
    }
  }
  return issues;
}

/** Top-of-page zones should have lower reading order than bottom zones (rough check). */
function detectInvertedVertical(zones) {
  const sorted = [...zones].sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
  if (sorted.length < 4) return null;
  const topBand = sorted.filter((z) => (z.y ?? 0) < Math.min(...zones.map((x) => x.y ?? 0)) + 80);
  const bottomBand = sorted.filter((z) => {
    const maxY = Math.max(...zones.map((x) => (x.y ?? 0) + (x.h ?? 0)));
    return (z.y ?? 0) > maxY - 120;
  });
  if (!topBand.length || !bottomBand.length) return null;
  const topMaxRo = Math.max(...topBand.map((z) => z.readingOrder ?? 0));
  const bottomMinRo = Math.min(...bottomBand.map((z) => z.readingOrder ?? 0));
  if (bottomMinRo < topMaxRo) {
    const topLate = topBand.filter((z) => (z.readingOrder ?? 0) > bottomMinRo).map((z) => z.content);
    const bottomEarly = bottomBand.filter((z) => (z.readingOrder ?? 0) < topMaxRo).map((z) => z.content);
    return { topLate: topLate.slice(0, 5), bottomEarly: bottomEarly.slice(0, 5), topMaxRo, bottomMinRo };
  }
  return null;
}

function pageKind(zones, pageWidth, pageCoords) {
  if (pageCoords && S.isTocListingPage(pageCoords)) return 'TOC';
  if (pageCoords && S.isCreditsOrBackMatterPage(pageCoords)) return 'credits';
  if (S.isWordLevelDirectoryPage(zones, pageWidth)) return 'directory';
  if (S.isLabelGridPage(zones)) return 'label-grid';
  return 'content';
}

async function main() {
  const coordsPages = JSON.parse(await fs.readFile(path.join(jobDir, 'coords.json'), 'utf8'));
  const meta = JSON.parse(await fs.readFile(path.join(jobDir, 'job_metadata.json'), 'utf8'));
  const reorderOpts = S.wordZoneReorderOptsFromJobMetadata(meta, coordsPages);

  const results = [];
  const problemPages = [];

  for (let pageNum = 1; pageNum <= coordsPages.length; pageNum++) {
    const pageCoords = coordsPages[pageNum - 1];
    const pageMeta = meta.pagesMetadata?.find((p) => p.pageNumber === pageNum);
    const pageWidthPx = pageMeta?.dimensions?.width || pageCoords?.width || 0;
    const pageHeightPx = pageMeta?.dimensions?.height || pageCoords?.height || 0;
    const ptsW = pageMeta?.pointsDimensions?.width || pageCoords?.width || pageWidthPx;
    const ptsH = pageMeta?.pointsDimensions?.height || pageCoords?.height || pageHeightPx;
    const scaleX = pageWidthPx / ptsW;
    const scaleY = pageHeightPx / ptsH;

    let zones = [];
    if (pageCoords?.items?.length && pageWidthPx > 0) {
      zones = S.buildWordZonesFromGlyphItems(pageCoords.items, pageNum, scaleX, scaleY, ptsW);
      zones = S.applyWordZoneReorderForPage(zones, pageNum, reorderOpts);
    }

    const kind = pageKind(zones, pageWidthPx, pageCoords);
    const byRo = [...zones].sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
    const first8 = byRo.slice(0, 8).map((z) => `${z.readingOrder}:${z.content}`);
    const last5 = byRo.slice(-5).map((z) => `${z.readingOrder}:${z.content}`);
    const zigzag = detectZigZag(zones, pageWidthPx);
    const inverted = detectInvertedVertical(zones);

    const issues = [];
    if (zigzag.length) issues.push(`zigzag×${zigzag.length}`);
    if (inverted) issues.push('inverted-vertical');

    // Directory page: check Mario follows COLLECTIONS in first column
    if (kind === 'directory') {
      const ro = byRo.map((z) => String(z.content || '').trim());
      const u = ro.indexOf('UNIQUE');
      const c = ro.indexOf('COLLECTIONS');
      const m = ro.findIndex((t) => /^Mario$/i.test(t));
      if (u >= 0 && c >= 0 && m >= 0 && !(u < c && c < m)) {
        issues.push('directory-header-order');
      }
    }

    // Content pages with UNIQUE footer: Mario should follow COLLECTIONS soon after
    const hasUniqueFooter = zones.some((z) => String(z.content).trim() === 'UNIQUE')
      && zones.some((z) => String(z.content).trim() === 'COLLECTIONS');
    if (kind === 'content' && hasUniqueFooter) {
      const sorted = [...zones].sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
      const uIdx = sorted.findIndex((z) => z.content === 'UNIQUE');
      const cIdx = sorted.findIndex((z) => z.content === 'COLLECTIONS');
      const mIdx = sorted.findIndex((z) => /^Mario$/i.test(String(z.content)));
      if (uIdx >= 0 && cIdx >= 0 && mIdx >= 0) {
        const gap = mIdx - cIdx;
        if (gap > 5) issues.push(`Mario-gap=${gap}`);
      } else if (uIdx >= 0 && cIdx >= 0 && mIdx < 0) {
        issues.push('no-Mario');
      }
    }

    const entry = {
      page: pageNum,
      kind,
      zones: zones.length,
      first8,
      last5,
      issues,
      zigzagSample: zigzag[0]?.words?.slice(0, 120),
      inverted,
    };
    results.push(entry);
    if (issues.length) problemPages.push(entry);
  }

  console.log(`\n=== Job ${jobId} — ${results.length} pages ===\n`);
  for (const r of results) {
    const flag = r.issues.length ? ` ⚠ ${r.issues.join(', ')}` : ' ✓';
    console.log(`p${String(r.page).padStart(2)} [${r.kind.padEnd(9)}] ${String(r.zones).padStart(4)} zones${flag}`);
    console.log(`     start: ${r.first8.join(' → ')}`);
    if (r.issues.length) {
      if (r.zigzagSample) console.log(`     zigzag: ${r.zigzagSample}…`);
      if (r.inverted) {
        console.log(`     inverted: bottom reads before top — early@${r.inverted.bottomEarly.join(',')} late@${r.inverted.topLate.join(',')}`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`OK: ${results.filter((r) => !r.issues.length).length}/${results.length}`);
  console.log(`Issues: ${problemPages.map((p) => `p${p.page}(${p.issues.join(';')})`).join(', ') || 'none'}`);

  const byKind = {};
  for (const r of results) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log('Page kinds:', byKind);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
