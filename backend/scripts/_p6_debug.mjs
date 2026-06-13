import fs from 'fs/promises';
import { KitabooFxlService as S } from '../src/services/KitabooFxlService.js';

const jobDir = './backend/html_intermediate/kitaboo_1781177872796/high_fidelity_render';
const coordsPages = JSON.parse(await fs.readFile(`${jobDir}/coords.json`, 'utf8'));
const meta = JSON.parse(await fs.readFile(`${jobDir}/job_metadata.json`, 'utf8'));
const reorderOpts = S.wordZoneReorderOptsFromJobMetadata(meta, coordsPages);
const p = 6;
const pm = meta.pagesMetadata.find((x) => x.pageNumber === p);
const pc = coordsPages[p - 1];
const w = pm.dimensions.width;

const raw = S.buildWordZonesFromGlyphItems(
  pc.items, p,
  w / pm.pointsDimensions.width,
  pm.dimensions.height / pm.pointsDimensions.height,
  pm.pointsDimensions.width
);

console.log('raw zones:', raw.length);
const after = S.applyYXReadingOrderToWordZones(raw, w, { pageCoords: pc });
const final = S.buildStudioPageZones(p, pc, pm, pm.dimensions, reorderOpts);

const mid = w * 0.52;
const side = (z) => ((z.x ?? 0) + (z.w ?? 0) / 2 < mid ? 'L' : 'R');

for (const [label, z] of [['applyYX', after], ['buildStudio', final]]) {
  z.sort((a, b) => a.readingOrder - b.readingOrder);
  let flips = 0;
  let prev = null;
  for (const x of z) {
    const s = side(x);
    if (prev && s !== prev) flips++;
    prev = s;
  }
  console.log(`\n${label}: flips=${flips}`);
  console.log(z.slice(0, 15).map((x) => `${x.readingOrder}${side(x)}:${x.content}`).join(' '));
}

// Gate checks
const maxWordLen = Math.max(...raw.map((z) => String(z.content || '').trim().length), 0);
const groups = new Map();
for (const z of raw) {
  const bid = z.blockId ?? 0;
  if (!groups.has(bid)) groups.set(bid, []);
  groups.get(bid).push(z);
}
const bodyBlocks = [...groups.values()];
const sideBySide = bodyBlocks.some((arr) => S.blockHasSideBySideColumnRows(arr, w));
console.log('\nGate: zones=', raw.length, 'maxWordLen=', maxWordLen, 'sideBySide=', sideBySide);
console.log('usePageColumnSort=', sideBySide && raw.length <= 100 && maxWordLen <= 40);
