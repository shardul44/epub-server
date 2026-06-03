import JSZip from 'jszip';
import { escapeXml } from '../utils/epubGenerator.js';
import { packageH5pForEpub, renderH5pBlockXhtml } from './h5p/h5pEpubPackager.js';

function xhtmlDoc({ title, bodyHtml, includeInteractiveJs = false }) {
  const safeTitle = escapeXml(title || 'Untitled');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" type="text/css" href="../styles.css" />
    ${includeInteractiveJs ? '<script type="text/javascript" src="../interactive.js"></script>' : ''}
    <link rel="stylesheet" type="text/css" href="../h5p/css/h5p.css" />
  </head>
  <body>
${bodyHtml}
  </body>
</html>`;
}

function escapeHtmlAttr(s) {
  return escapeXml(String(s ?? ''));
}

function encodeDataAttrJson(obj) {
  try {
    return escapeHtmlAttr(JSON.stringify(obj ?? {}));
  } catch {
    return '{}';
  }
}

const EPUB_ALLOWED_INLINE_STYLE_PROPS = new Set(['font-family', 'font-size']);

function sanitizeInlineStyleForEpub(styleValue) {
  if (!styleValue || typeof styleValue !== 'string') return '';
  const kept = [];
  for (const decl of styleValue.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    if (!EPUB_ALLOWED_INLINE_STYLE_PROPS.has(prop)) continue;
    let val = trimmed.slice(colon + 1).trim();
    if (!val) continue;
    val = val.replace(/[\r\n"<>]/g, '');
    kept.push(`${prop}: ${val}`);
  }
  return kept.join('; ');
}

function preserveFontStylesInXhtml(xhtml) {
  return xhtml.replace(/\s+style=(?:"([^"]*)"|'([^']*)')/gi, (match, dbl, sgl) => {
    const sanitized = sanitizeInlineStyleForEpub(dbl ?? sgl ?? '');
    return sanitized ? ` style="${sanitized}"` : '';
  });
}

/**
 * Convert HTML to XHTML by ensuring all self-closing tags are properly formatted
 * and all tags are properly closed for EPUB compliance.
 */
function htmlToXhtml(html) {
  if (!html || typeof html !== 'string') return '';
  
  let xhtml = html;
  
  // CRITICAL: Remove all line breaks and normalize whitespace within tags first
  // This prevents "error parsing attribute name" caused by newlines in attributes
  xhtml = xhtml.replace(/<([^>]+)>/g, (match) => {
    return match.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
  });
  
  // Convert HTML entities to numeric entities for XHTML compatibility
  // XHTML only recognizes 5 predefined entities: &lt; &gt; &amp; &quot; &apos;
  // All others must be numeric or defined in DTD
  const entityMap = {
    '&nbsp;': '&#160;',
    '&iexcl;': '&#161;',
    '&cent;': '&#162;',
    '&pound;': '&#163;',
    '&curren;': '&#164;',
    '&yen;': '&#165;',
    '&brvbar;': '&#166;',
    '&sect;': '&#167;',
    '&uml;': '&#168;',
    '&copy;': '&#169;',
    '&ordf;': '&#170;',
    '&laquo;': '&#171;',
    '&not;': '&#172;',
    '&shy;': '&#173;',
    '&reg;': '&#174;',
    '&macr;': '&#175;',
    '&deg;': '&#176;',
    '&plusmn;': '&#177;',
    '&sup2;': '&#178;',
    '&sup3;': '&#179;',
    '&acute;': '&#180;',
    '&micro;': '&#181;',
    '&para;': '&#182;',
    '&middot;': '&#183;',
    '&cedil;': '&#184;',
    '&sup1;': '&#185;',
    '&ordm;': '&#186;',
    '&raquo;': '&#187;',
    '&frac14;': '&#188;',
    '&frac12;': '&#189;',
    '&frac34;': '&#190;',
    '&iquest;': '&#191;',
    '&times;': '&#215;',
    '&divide;': '&#247;',
    '&ldquo;': '&#8220;',
    '&rdquo;': '&#8221;',
    '&lsquo;': '&#8216;',
    '&rsquo;': '&#8217;',
    '&mdash;': '&#8212;',
    '&ndash;': '&#8211;',
    '&hellip;': '&#8230;',
    '&bull;': '&#8226;',
    '&euro;': '&#8364;',
    '&trade;': '&#8482;'
  };
  
  // Replace HTML entities with numeric entities
  Object.keys(entityMap).forEach(entity => {
    const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    xhtml = xhtml.replace(regex, entityMap[entity]);
  });
  
  // Remove problematic CKEditor-specific attributes
  const problematicAttrs = [
    'contenteditable',
    'spellcheck', 
    'draggable',
    'role',
    'tabindex',
    'translate'
  ];
  
  problematicAttrs.forEach(attr => {
    xhtml = xhtml.replace(new RegExp(`\\s+${attr}="[^"]*"`, 'gi'), '');
    xhtml = xhtml.replace(new RegExp(`\\s+${attr}='[^']*'`, 'gi'), '');
    xhtml = xhtml.replace(new RegExp(`\\s+${attr}\\s*=\\s*[^\\s>]*`, 'gi'), '');
  });
  
  // Remove all data-* attributes (can have malformed values)
  xhtml = xhtml.replace(/\s+data-[a-z0-9-]+="[^"]*"/gi, '');
  xhtml = xhtml.replace(/\s+data-[a-z0-9-]+='[^']*'/gi, '');
  
  // Remove all aria-* attributes
  xhtml = xhtml.replace(/\s+aria-[a-z0-9-]+="[^"]*"/gi, '');
  xhtml = xhtml.replace(/\s+aria-[a-z0-9-]+='[^']*'/gi, '');
  
  // Keep font-family / font-size from CKEditor; drop other inline styles (quotes/special chars break XHTML).
  xhtml = preserveFontStylesInXhtml(xhtml);
  
  // Sanitize class attributes - keep only alphanumeric, spaces, hyphens, underscores
  xhtml = xhtml.replace(/\s+class="([^"]*)"/gi, (match, classes) => {
    const sanitized = classes.replace(/[^\w\s-]/g, '').trim();
    return sanitized ? ` class="${sanitized}"` : '';
  });
  
  // Remove any attributes without proper quotes (malformed)
  xhtml = xhtml.replace(/\s+([a-z][a-z0-9-]*)=([^"'\s>][^\s>]*)/gi, '');
  
  // Convert self-closing tags to XHTML format
  // <br> -> <br />
  xhtml = xhtml.replace(/<br(\s+[^>]*)?\s*\/?>/gi, '<br />');
  
  // <hr> -> <hr />
  xhtml = xhtml.replace(/<hr(\s+[^>]*)?\s*\/?>/gi, '<hr />');
  
  // <img> -> <img />
  xhtml = xhtml.replace(/<img(\s+[^>]*?)\s*\/?>/gi, '<img$1 />');
  
  // Other self-closing tags
  const selfClosingTags = ['input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];
  selfClosingTags.forEach(tag => {
    const regex = new RegExp(`<${tag}(\\s+[^>]*?)?\\s*\/?>`, 'gi');
    xhtml = xhtml.replace(regex, `<${tag}$1 />`);
  });
  
  // Clean up spacing
  xhtml = xhtml.replace(/\s{2,}/g, ' ');
  xhtml = xhtml.replace(/\s+\/>/g, ' />');
  xhtml = xhtml.replace(/<([a-z][a-z0-9]*)\s+>/gi, '<$1>');
  
  return xhtml;
}

function renderBlockFallback(block, options = {}) {
  const { interactive = false } = options;
  const type = String(block.type || '').trim();
  const c = block.content_json || {};

  if (type === 'text') {
    // Stored as structured JSON but "text" is allowed to contain sanitized HTML.
    const html = (typeof c.html === 'string' ? c.html : (typeof c.content === 'string' ? c.content : '')).trim();
    if (!html) return '';
    // Convert HTML to XHTML for EPUB compliance
    const xhtml = htmlToXhtml(html);
    return `<section class="block block-text">${xhtml}</section>`;
  }

  if (type === 'audio') {
    const src = c.src ? escapeXml(String(c.src)) : '';
    const start = c.start != null ? Number(c.start) : null;
    const end = c.end != null ? Number(c.end) : null;
    const range = (start != null || end != null)
      ? `<div class="muted">Time: ${escapeXml(String(start ?? ''))} → ${escapeXml(String(end ?? ''))}</div>`
      : '';
    return `<section class="block block-audio">
  <div class="label">Audio</div>
  <div>${src ? `Source: <code>${src}</code>` : '(no source set)'}</div>
  ${range}
</section>`;
  }

  if (type === 'quiz') {
    const q = c.question ? escapeXml(String(c.question)) : '';
    const opts = Array.isArray(c.options) ? c.options : [];
    if (interactive) {
      return `<section class="block block-quiz js-quiz" data-quiz='${encodeDataAttrJson(c)}'>
  <div class="label">Quiz</div>
  <p><strong>${q || 'Question'}</strong></p>
  <div class="quiz-options">
    ${opts.map((o, idx) => `<button type="button" class="quiz-opt" data-index="${idx}">${escapeXml(String(o))}</button>`).join('')}
  </div>
  <div class="quiz-result muted"></div>
</section>`;
    }
    const list = opts.length
      ? `<ol>${opts.map((o) => `<li>${escapeXml(String(o))}</li>`).join('')}</ol>`
      : '<div class="muted">(no options)</div>';
    return `<section class="block block-quiz">
  <div class="label">Quiz</div>
  <p><strong>${q || 'Question'}</strong></p>
  ${list}
</section>`;
  }

  if (type === 'dragdrop') {
    const q = c.question ? escapeXml(String(c.question)) : '';
    const items = Array.isArray(c.items) ? c.items : [];
    const targets = Array.isArray(c.targets) ? c.targets : [];
    if (interactive) {
      return `<section class="block block-dragdrop js-dragdrop" data-dragdrop='${encodeDataAttrJson(c)}'>
  <div class="label">Drag &amp; Drop</div>
  <p><strong>${q || 'Match the items'}</strong></p>
  <div class="two-col">
    <div>
      <div class="muted">Items</div>
      <div class="drag-items">
        ${items.map((i) => `<div class="drag-item" draggable="true" data-item="${escapeHtmlAttr(i)}">${escapeXml(String(i))}</div>`).join('')}
      </div>
    </div>
    <div>
      <div class="muted">Targets</div>
      <div class="drop-targets">
        ${targets.map((t) => `<div class="drop-target" data-target="${escapeHtmlAttr(t)}">${escapeXml(String(t))}</div>`).join('')}
      </div>
    </div>
  </div>
  <button type="button" class="btn-submit-dragdrop">Submit</button>
  <div class="dragdrop-result muted"></div>
</section>`;
    }
    return `<section class="block block-dragdrop">
  <div class="label">Drag &amp; Drop</div>
  <p><strong>${q || 'Match the items'}</strong></p>
  <div class="two-col">
    <div>
      <div class="muted">Items</div>
      <ul>${items.map((i) => `<li>${escapeXml(String(i))}</li>`).join('')}</ul>
    </div>
    <div>
      <div class="muted">Targets</div>
      <ul>${targets.map((t) => `<li>${escapeXml(String(t))}</li>`).join('')}</ul>
    </div>
  </div>
</section>`;
  }

  if (type === 'h5p') {
    return renderH5pBlockXhtml(block, options);
  }

  if (type === 'audio_sync' || type === 'readalong') {
    const words = Array.isArray(c.words) ? c.words : [];
    const audio = c.audio ? escapeXml(String(c.audio)) : '';
    if (interactive) {
      return `<section class="block block-readalong js-readalong" data-readalong='${encodeDataAttrJson(c)}'>
  <div class="label">Read-along</div>
  <audio controls="controls" class="readalong-audio">${audio ? `<source src="${audio}" type="audio/mpeg" />` : ''}</audio>
  <p class="readalong-text">
    ${words.map((w, idx) => `<span class="ra-word" data-idx="${idx}" data-start="${escapeHtmlAttr(w.start)}" data-end="${escapeHtmlAttr(w.end)}">${escapeXml(String(w.text || ''))}</span>`).join(' ')}
  </p>
</section>`;
    }
    return `<section class="block block-readalong">
  <div class="label">Read-along</div>
  <div class="muted">Interactive highlighting available in JS-enabled readers.</div>
</section>`;
  }

  // Unknown block type: dump JSON keys for visibility.
  const keys = Object.keys(c || {});
  return `<section class="block block-unknown">
  <div class="label">Block: ${escapeXml(type || 'unknown')}</div>
  <div class="muted">Keys: ${escapeXml(keys.join(', '))}</div>
</section>`;
}

function interactiveJs() {
  return `
(function () {
  function onReady(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  onReady(function () {
    // Quiz
    document.querySelectorAll('.js-quiz').forEach(function (root) {
      var data = {};
      try { data = JSON.parse(root.getAttribute('data-quiz') || '{}'); } catch(_e) {}
      var answer = Number(data.answer);
      var out = root.querySelector('.quiz-result');
      root.querySelectorAll('.quiz-opt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var idx = Number(btn.getAttribute('data-index'));
          if (out) out.textContent = idx === answer ? 'Correct' : 'Wrong';
        });
      });
    });

    // Dragdrop
    document.querySelectorAll('.js-dragdrop').forEach(function (root) {
      var data = {};
      try { data = JSON.parse(root.getAttribute('data-dragdrop') || '{}'); } catch(_e) {}
      var correct = data.correct || {};
      var map = {};
      root.querySelectorAll('.drag-item').forEach(function (it) {
        it.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', it.getAttribute('data-item') || '');
        });
      });
      root.querySelectorAll('.drop-target').forEach(function (target) {
        target.addEventListener('dragover', function (e) { e.preventDefault(); });
        target.addEventListener('drop', function (e) {
          e.preventDefault();
          var item = e.dataTransfer.getData('text/plain');
          if (!item) return;
          map[item] = target.getAttribute('data-target');
          target.setAttribute('data-filled', item);
          target.textContent = target.getAttribute('data-target') + ' ← ' + item;
        });
      });
      var btn = root.querySelector('.btn-submit-dragdrop');
      var out = root.querySelector('.dragdrop-result');
      if (btn && out) {
        btn.addEventListener('click', function () {
          var score = 0, total = 0;
          Object.keys(correct).forEach(function (k) {
            total++;
            if (String(correct[k]) === String(map[k])) score++;
          });
          out.textContent = 'Score: ' + score + '/' + total;
        });
      }
    });

    // Readalong
    document.querySelectorAll('.js-readalong').forEach(function (root) {
      var audio = root.querySelector('.readalong-audio');
      var words = Array.prototype.slice.call(root.querySelectorAll('.ra-word'));
      if (!audio || words.length === 0) return;
      words.forEach(function (w) {
        w.addEventListener('click', function () {
          var start = Number(w.getAttribute('data-start') || 0);
          audio.currentTime = isFinite(start) ? start : 0;
          audio.play().catch(function(){});
        });
      });
      var rafId = null;
      function tick() {
        var t = audio.currentTime || 0;
        for (var i = 0; i < words.length; i++) {
          var w = words[i];
          var s = Number(w.getAttribute('data-start') || 0);
          var e = Number(w.getAttribute('data-end') || 0);
          if (t >= s && t <= e) w.classList.add('active'); else w.classList.remove('active');
        }
        rafId = requestAnimationFrame(tick);
      }
      audio.addEventListener('play', function(){ if (!rafId) rafId = requestAnimationFrame(tick); });
      audio.addEventListener('pause', function(){ if (rafId) cancelAnimationFrame(rafId); rafId = null; });
      audio.addEventListener('ended', function(){ if (rafId) cancelAnimationFrame(rafId); rafId = null; });
    });
  });
})();
`;
}

function navXhtml({ bookTitle, chapterItems }) {
  const safeTitle = escapeXml(bookTitle || 'Book');
  const list = chapterItems
    .map((c) => `<li><a href="${escapeXml(c.href)}">${escapeXml(c.title)}</a></li>`)
    .join('\n          ');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${safeTitle}</h1>
      <ol>
          ${list}
      </ol>
    </nav>
  </body>
</html>`;
}

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf({ bookId, bookTitle, manifestItems, spineItemIds }) {
  const uid = `interactive-book-${bookId}`;
  const safeTitle = escapeXml(bookTitle || 'Book');
  const manifest = manifestItems.map((it) =>
    `    <item id="${escapeXml(it.id)}" href="${escapeXml(it.href)}" media-type="${escapeXml(it.mediaType)}"${it.properties ? ` properties="${escapeXml(it.properties)}"` : ''}/>`
  ).join('\n');
  const spine = spineItemIds.map((id) => `    <itemref idref="${escapeXml(id)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(uid)}</dc:identifier>
    <dc:title>${safeTitle}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;
}

export class InteractiveEpubExportService {
  /**
   * Build an EPUB buffer for an interactive book.
   * @param {{ book: any, chapters: any[], blocksByChapterId: Map<number, any[]> }} data
   */
  static async buildEpubBuffer(data) {
    const { book, chapters, blocksByChapterId, includeInteractiveJs = false } = data;

    const zip = new JSZip();
    // Per EPUB spec: mimetype must be first and stored (no compression).
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    zip.folder('META-INF')?.file('container.xml', containerXml());
    const oebps = zip.folder('OEBPS');
    const xhtmlFolder = oebps.folder('xhtml');

    const chapterItems = [];
    const manifestItems = [
      { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
      { id: 'css', href: 'styles.css', mediaType: 'text/css' }
    ];
    if (includeInteractiveJs) {
      manifestItems.push({ id: 'interactive-js', href: 'interactive.js', mediaType: 'text/javascript' });
    }
    const spineItemIds = [];

    const allH5pIds = [];
    for (const ch of chapters || []) {
      const blocks = blocksByChapterId.get(Number(ch.id)) || [];
      for (const b of blocks) {
        if (b.type !== 'h5p') continue;
        const c = b.content_json || {};
        const id = c.h5pContentId || c.h5p_content_id || b.h5p_content_id;
        if (id) allH5pIds.push(String(id));
      }
    }
    if (allH5pIds.length > 0) {
      const h5pManifest = await packageH5pForEpub(oebps, { h5pContentIds: allH5pIds });
      manifestItems.push(...h5pManifest);
    }

    // Chapters
    for (let i = 0; i < (chapters || []).length; i++) {
      const ch = chapters[i];
      const chapterId = ch.id;
      const title = ch.title || `Chapter ${i + 1}`;
      const fileName = `chapter_${String(i + 1).padStart(3, '0')}.xhtml`;
      const href = `xhtml/${fileName}`;
      const itemId = `ch_${i + 1}`;

      const blocks = blocksByChapterId.get(Number(chapterId)) || [];
      const rendered = blocks.map((b) => renderBlockFallback(b, { interactive: includeInteractiveJs })).filter(Boolean).join('\n    ');

      const bodyHtml = `    <h1>${escapeXml(title)}</h1>
    ${rendered || '<p class="muted">(empty chapter)</p>'}`;

      xhtmlFolder.file(fileName, xhtmlDoc({ title, bodyHtml, includeInteractiveJs }));
      chapterItems.push({ title, href });
      manifestItems.push({ id: itemId, href, mediaType: 'application/xhtml+xml' });
      spineItemIds.push(itemId);
    }

    // nav + opf + css
    oebps.file('nav.xhtml', navXhtml({ bookTitle: book.title, chapterItems }));
    oebps.file(
      'styles.css',
      [
        'body { font-family: Arial, sans-serif; line-height: 1.5; }',
        'h1 { font-size: 1.6em; margin: 0.2em 0 0.6em; }',
        '.block { margin: 1em 0; padding: 0.75em; border: 1px solid #ddd; border-radius: 6px; }',
        '.label { font-weight: 700; margin-bottom: 0.4em; }',
        '.muted { color: #666; font-size: 0.95em; }',
        '.two-col { display: table; width: 100%; }',
        '.two-col > div { display: table-cell; vertical-align: top; width: 50%; padding-right: 1em; }',
        'code { background: #f5f5f5; padding: 0.1em 0.3em; border-radius: 4px; }',
        '.quiz-opt,.btn-submit-dragdrop { margin: 0.2em; padding: 0.4em 0.6em; }',
        '.drag-item { border:1px solid #ddd; padding:0.4em; margin:0.2em 0; cursor:grab; }',
        '.drop-target { border:1px dashed #aaa; padding:0.5em; margin:0.2em 0; min-height:1.6em; }',
        '.ra-word { cursor:pointer; padding:0.05em 0.2em; border-radius:3px; }',
        '.ra-word.active { background:#ffeb3b; }',
        '.block-h5p--fixed { position: relative; min-height: 120px; }',
        '.h5p-container[data-layout="fixed"] { position: absolute; }'
      ].join('\n')
    );
    if (includeInteractiveJs) {
      oebps.file('interactive.js', interactiveJs());
    }
    oebps.file(
      'content.opf',
      contentOpf({
        bookId: book.id,
        bookTitle: book.title,
        manifestItems,
        spineItemIds: ['nav', ...spineItemIds]
      })
    );

    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}

