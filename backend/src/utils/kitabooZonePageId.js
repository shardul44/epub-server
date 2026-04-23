/**
 * Resolve which spine page a zone / alignment segment id belongs to.
 * Supports legacy p{n}_z{m}… ids and arbitrary client ids via an explicit id→page map.
 */

function stripOneZoneSuffix(str) {
  let m = String(str).match(/^(.*)_w\d+$/);
  if (m) return m[1];
  m = String(str).match(/^(.*)_s\d+_frag\d+$/);
  if (m) return m[1];
  m = String(str).match(/^(.*)_s\d+$/);
  if (m) return m[1];
  return null;
}

/**
 * @param {string} zoneId
 * @param {Map<string, number>|null|undefined} zoneIdToPageMap - zone id → page number (from DB / studio pages)
 * @returns {number} page number (>=1); falls back to legacy p{n}_ prefix or 1
 */
export function getPageNumFromZoneId(zoneId, zoneIdToPageMap) {
  const s = String(zoneId || '').trim();
  if (!s) return 1;
  if (zoneIdToPageMap instanceof Map && zoneIdToPageMap.size > 0) {
    if (zoneIdToPageMap.has(s)) return zoneIdToPageMap.get(s);
    let cur = s;
    for (let g = 0; g < 24; g++) {
      const next = stripOneZoneSuffix(cur);
      if (!next || next === cur) break;
      cur = next;
      if (zoneIdToPageMap.has(cur)) return zoneIdToPageMap.get(cur);
    }
  }
  const legacy = s.match(/^p(\d+)_/);
  return legacy ? parseInt(legacy[1], 10) : 1;
}

/**
 * @param {Array<{ pageNumber?: number, pageNum?: number, zones?: object[], textZones?: object[] }>} pagesLike
 * @returns {Map<string, number>}
 */
export function buildZoneIdToPageMap(pagesLike) {
  const map = new Map();
  for (const item of pagesLike || []) {
    const pn = Number(item.pageNumber ?? item.pageNum);
    if (!Number.isFinite(pn) || pn < 1) continue;
    const zones = item.textZones || item.zones || [];
    for (const z of zones) {
      const id = z?.id != null ? String(z.id).trim() : '';
      if (id) map.set(id, pn);
    }
  }
  return map;
}
