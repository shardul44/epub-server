import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { escapeXml } from '../../utils/epubGenerator.js';
import { getH5pPaths } from './h5pService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../../..');

/**
 * Copy H5P runtime assets into EPUB OEBPS/h5p/ and return manifest entries.
 */
export async function packageH5pForEpub(zipOebps, { h5pContentIds = [] }) {
  const { H5P_BASE, H5P_CORE } = getH5pPaths();
  const h5pFolder = zipOebps.folder('h5p');
  const manifestExtras = [];
  const uniqueIds = [...new Set(h5pContentIds.map(String).filter(Boolean))];

  // Embed minimal player bootstrap (fallback when full core not bundled)
  const jsFolder = h5pFolder.folder('js');
  jsFolder.file(
    'h5p-embed.js',
    `
(function(){
  document.querySelectorAll('.h5p-container[data-content-id]').forEach(function(el){
    var id = el.getAttribute('data-content-id');
    var title = el.getAttribute('data-title') || 'Interactive content';
    var noscript = el.querySelector('noscript');
    if(noscript) return;
    el.innerHTML = '<p class="h5p-fallback">'+title+' (ID: '+id+'). Open in the web reader for full interactivity.</p>';
  });
})();
`.trim()
  );
  manifestExtras.push({ id: 'h5p-embed-js', href: 'h5p/js/h5p-embed.js', mediaType: 'text/javascript' });

  const cssFolder = h5pFolder.folder('css');
  cssFolder.file(
    'h5p.css',
    [
      '.h5p-container { margin: 1em 0; padding: 1em; border: 1px solid #c7d2fe; border-radius: 8px; background: #f8fafc; }',
      '.h5p-fallback { color: #475569; font-size: 0.95rem; }',
      '.h5p-container[data-layout="fixed"] { position: relative; }',
      '.block-h5p-fixed { position: absolute; box-sizing: border-box; }'
    ].join('\n')
  );
  manifestExtras.push({ id: 'h5p-css', href: 'h5p/css/h5p.css', mediaType: 'text/css' });

  // Copy content JSON snapshots
  const contentFolder = h5pFolder.folder('content');
  for (const h5pId of uniqueIds) {
    const srcDir = path.join(H5P_BASE, 'content', h5pId);
    try {
      const jsonPath = path.join(srcDir, 'content.json');
      const raw = await fs.readFile(jsonPath, 'utf8');
      contentFolder.file(`${h5pId}.json`, raw);
      manifestExtras.push({
        id: `h5p-content-${h5pId}`,
        href: `h5p/content/${h5pId}.json`,
        mediaType: 'application/json'
      });
    } catch {
      contentFolder.file(`${h5pId}.json`, JSON.stringify({ _missing: true, id: h5pId }));
    }
  }

  // Optionally bundle core (large) — copy index if exists
  try {
    const coreIndex = path.join(H5P_CORE, 'js', 'h5p.js');
    await fs.access(coreIndex);
    const coreJs = await fs.readFile(coreIndex, 'utf8');
    jsFolder.file('h5p-core.js', coreJs);
    manifestExtras.push({ id: 'h5p-core-js', href: 'h5p/js/h5p-core.js', mediaType: 'text/javascript' });
  } catch {
    // core not installed — fallback only
  }

  return manifestExtras;
}

export function renderH5pBlockXhtml(block, options = {}) {
  const { interactive = false } = options;
  const c = block.content_json || {};
  const layout = block.layout_json || c.layout || {};
  const h5pId = c.h5pContentId || c.h5p_content_id || block.h5p_content_id;
  const title = escapeXml(c.title || c.displayTitle || 'Interactive activity');
  const lib = escapeXml(c.libraryName || c.machineName || 'H5P');
  const mode = layout.mode === 'fixed' ? 'fixed' : 'reflow';

  const styleAttr =
    mode === 'fixed' && layout.x != null
      ? ` style="left:${Number(layout.x)}%;top:${Number(layout.y)}%;width:${Number(layout.width)}%;height:${Number(layout.height)}%;z-index:${Number(layout.zIndex || 1)}"`
      : '';

  const scriptTags = interactive
    ? '<script type="text/javascript" src="../h5p/js/h5p-embed.js"></script>'
  : '';

  const inner = interactive
    ? `<div class="h5p-iframe-wrap" data-h5p-id="${escapeXml(String(h5pId || ''))}"></div>`
    : `<p class="h5p-fallback"><strong>${title}</strong> (${lib}) — interactive version requires JavaScript.</p>`;

  return `<section class="block block-h5p block-h5p--${mode}"${mode === 'fixed' ? ' data-layout="fixed"' : ''}>
  <div class="h5p-container" data-content-id="${escapeXml(String(h5pId || ''))}" data-title="${title}" data-library="${lib}"${styleAttr}>
    <noscript>${inner}</noscript>
    ${interactive ? inner : ''}
  </div>
</section>${scriptTags ? `\n    ${scriptTags}` : ''}`;
}
