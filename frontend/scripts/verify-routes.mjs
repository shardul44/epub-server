/**
 * Static route/guard checks for CI — validates sidebar links and legacy redirects
 * without a running browser.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routerSrc = readFileSync(join(root, 'src/routes/AppRouter.jsx'), 'utf8');

const routePaths = new Set();
const pathAttr = /path=["']([^"']+)["']/g;
let m;
while ((m = pathAttr.exec(routerSrc)) !== null) {
  if (!m[1].includes(':') && m[1] !== '*') routePaths.add(`/${m[1].replace(/^\//, '')}`);
}

const adminSidebarLinks = [
  '/',
  '/admin/analytics',
  '/admin/organizations',
  '/admin/plans',
  '/admin/users',
  '/admin/conversions',
  '/admin/activity',
  '/admin/billing',
  '/admin/system-logs',
  '/admin/settings',
];

const legacyRedirects = [
  { from: 'tts-management', to: '/' },
  { from: 'ai-config', to: '/' },
  { from: 'org/media-library', to: '/media-library' },
  { from: 'org/usage', to: '/usage' },
  { from: 'admin/tts-management', to: '/admin/settings?tab=tts' },
  { from: 'admin/security', to: '/admin/settings' },
];

const requiredSnippets = [
  'path="*" element={<NotFound />}',
  'LegacyFxlSyncRedirect',
  'LegacyReflowSyncRedirect',
  'RequirePlatformAdmin',
  'RequireOrgAdmin',
  'RequireFeature',
];

let failed = 0;

for (const link of adminSidebarLinks) {
  const key = link === '/' ? '/' : link.replace(/^\//, '');
  const ok =
    link === '/' ||
    routePaths.has(link) ||
    routerSrc.includes(`path="${key}"`) ||
    routerSrc.includes(`path='${key}'`);
  if (!ok) {
    console.error(`FAIL: Admin sidebar link missing route: ${link}`);
    failed += 1;
  }
}

for (const { from, to } of legacyRedirects) {
  const snippet = `path="${from}"`;
  if (!routerSrc.includes(snippet)) {
    console.error(`FAIL: Missing legacy route: ${snippet}`);
    failed += 1;
    continue;
  }
  if (!routerSrc.includes(`to="${to}"`)) {
    console.error(`FAIL: Legacy redirect ${from} should target ${to}`);
    failed += 1;
  }
}

for (const snippet of requiredSnippets) {
  if (!routerSrc.includes(snippet)) {
    console.error(`FAIL: AppRouter missing: ${snippet}`);
    failed += 1;
  }
}

if (!readFileSync(join(root, 'src/hooks/useLogout.js'), 'utf8').includes('queryClient.clear()')) {
  console.error('FAIL: useLogout must call queryClient.clear()');
  failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} verification check(s) failed.`);
  process.exit(1);
}

console.log('Route verification passed.');
