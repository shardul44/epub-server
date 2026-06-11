/**
 * Detailed checks for specific patterns on job pages.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KitabooFxlService as S } from '../src/services/KitabooFxlService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobId = process.argv[2] || '1781177872796';
const jobDir = path.resolve(__dirname, '../html_intermediate', `kitaboo_${jobId}`, 'high_fidelity_render');

async function loadPage(pageNum, coordsPages, meta, reorderOpts) {
  const pageCoords = coordsPages[pageNum - 1];
  const pageMeta = meta.pagesMetadata?.find((p) => p.pageNumber === pageNum);
  const pageWidthPx = pageMeta?.dimensions?.width || pageCoords?.width || 0;
  const pageHeightPx = pageMeta?.dimensions?.height || pageCoords?.height || 0;
  const ptsW = pageMeta?.pointsDimensions?.width || pageCoords?.width || pageWidthPx;
  const ptsH = pageMeta?.pointsDimensions?.height || pageCoords?.height || pageHeightPx;
  const scaleX = pageWidthPx / ptsW;
  const scaleY = pageHeightPx / ptsH;
  let zones = S.buildWordZonesFromGlyphItems(pageCoords.items, pageNum, scaleX, scaleY, ptsW);
  zones = S.applyWordZoneReorderForPage(zones, pageNum, reorderOpts);
  return { zones: [...zones].sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0)), pageWidthPx };
}

function findSequence(byRo, words) {
  const idxs = words.map((w) => {
    const i = byRo.findIndex((z) => {
      const c = String(z.content || '').trim();
      return typeof w === 'string' ? c === w : w.test(c);
    });
    return i >= 0 ? byRo[i].readingOrder : null;
  });
  return idxs;
}

function footerBlock(byRo) {
  const u = byRo.find((z) => z.content === 'UNIQUE');
  if (!u) return null;
  const start = u.readingOrder;
  const slice = byRo.filter((z) => z.readingOrder >= start && z.readingOrder < start + 20);
  return slice.map((z) => `${z.readingOrder}:${z.content}`).join(' → ');
}

async function main() {
  const coordsPages = JSON.parse(await fs.readFile(path.join(jobDir, 'coords.json'), 'utf8'));
  const meta = JSON.parse(await fs.readFile(path.join(jobDir, 'job_metadata.json'), 'utf8'));
  const reorderOpts = S.wordZoneReorderOptsFromJobMetadata(meta, coordsPages);

  // Page 8 directory columns
  {
    const { zones, pageWidthPx } = await loadPage(8, coordsPages, meta, reorderOpts);
    console.log('\n=== Page 8 (directory) ===');
    console.log('First 10:', zones.slice(0, 10).map((z) => `${z.readingOrder}:${z.content}`).join(' → '));
    const specialists = zones.find((z) => z.content === 'SPECIALISTS');
    const enquiries = zones.find((z) => z.content === 'ENQUIRIES');
    const mario = zones.find((z) => z.content === 'Mario');
    const tavella = zones.find((z) => z.content === 'Tavella');
    console.log(`SPECIALISTS@${specialists?.readingOrder}, ENQUIRIES@${enquiries?.readingOrder}, Mario@${mario?.readingOrder}, Tavella@${tavella?.readingOrder}`);
    console.log('isDirectory:', S.isWordLevelDirectoryPage(zones, pageWidthPx));
  }

  for (const p of [13, 15, 17, 18, 19]) {
    const { zones } = await loadPage(p, coordsPages, meta, reorderOpts);
    console.log(`\n=== Page ${p} ===`);
    console.log('First 8:', zones.slice(0, 8).map((z) => `${z.readingOrder}:${z.content}`).join(' → '));
    const fb = footerBlock(zones);
    if (fb) console.log('Footer (from UNIQUE):', fb);
    const seq = findSequence(zones, ['UNIQUE', 'COLLECTIONS', /^Mario$/i, /^Tavella$/i]);
    console.log('UNIQUE/COLLECTIONS/Mario/Tavella RO:', seq.join(', '));
    // Title zones at top
    const minY = Math.min(...zones.map((z) => z.y ?? 0));
    const topZones = zones.filter((z) => (z.y ?? 0) < minY + 100).slice(0, 6);
    console.log('Top visual (by y):', topZones.map((z) => `${z.readingOrder}@${Math.round(z.y)}:${z.content}`).join(' | '));
  }

  // Page 18 zigzag check on footer row
  {
    const { zones, pageWidthPx } = await loadPage(18, coordsPages, meta, reorderOpts);
    const u = zones.find((z) => z.content === 'UNIQUE');
    if (u) {
      const row = zones.filter((z) => Math.abs((z.y ?? 0) - (u.y ?? 0)) < 15)
        .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
      console.log('\n=== Page 18 UNIQUE row (by reading order) ===');
      console.log(row.map((z) => `${z.readingOrder}:${z.content}@x${Math.round(z.x)}`).join(' | '));
    }
  }

  // Page 10 TOC - check for fragmented words
  {
    const { zones } = await loadPage(10, coordsPages, meta, reorderOpts);
    const narrow = zones.filter((z) => (z.w ?? 0) < 30 && String(z.content).length > 4);
    console.log('\n=== Page 10 TOC ===');
    console.log('First 12:', zones.slice(0, 12).map((z) => `${z.readingOrder}:${z.content}`).join(' → '));
    console.log('Narrow zones (>4 chars, w<30):', narrow.length, narrow.slice(0, 5).map((z) => z.content));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
