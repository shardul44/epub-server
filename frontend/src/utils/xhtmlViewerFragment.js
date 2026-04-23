/**
 * Full EPUB XHTML files include <head><style>…</style>. Setting that string on a div's
 * innerHTML parses as a fragment: <head> is dropped, so layout rules never run and the
 * preview looks nothing like EPUB Image Editor / epub.js.
 *
 * Returns <style>…</style> (all from head) + body innerHTML so the Sync Studio viewer
 * matches the real document styling.
 */
export function xhtmlFragmentForDivViewer(html) {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (!/<html[\s>]/i.test(trimmed) && !/<body[\s>]/i.test(trimmed)) {
    return html;
  }

  try {
    let doc = new DOMParser().parseFromString(trimmed, 'text/html');
    if (doc.querySelector('parsererror')) {
      doc = new DOMParser().parseFromString(trimmed, 'application/xhtml+xml');
      if (doc.querySelector('parsererror')) {
        return html;
      }
    }
    return extractStylesAndBodyInner(doc);
  } catch {
    return html;
  }
}

function extractStylesAndBodyInner(doc) {
  let styles = '';
  const head = doc.head || doc.querySelector('head');
  if (head) {
    head.querySelectorAll('style').forEach((s) => {
      styles += s.outerHTML;
    });
  }

  let bodyHtml = '';
  if (doc.body) {
    bodyHtml = doc.body.innerHTML;
  } else {
    const body = doc.querySelector('body');
    if (body) {
      bodyHtml = body.innerHTML;
    } else {
      const root = doc.documentElement;
      if (root && root.localName === 'html') {
        const bodyEl = Array.from(root.children || []).find((n) => n.localName === 'body');
        if (bodyEl) {
          bodyHtml = bodyEl.innerHTML;
        }
      }
    }
  }

  return styles + bodyHtml;
}
