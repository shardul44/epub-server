/**
 * Parse HTML/XHTML markup for editor preview: body inner HTML + aggregated <style> text.
 * Uses application/xml when text/html yields an empty body (XHTML namespaces).
 */
export function extractBodyAndStylesFromMarkup(markup) {
  if (markup == null) return { bodyContent: '', styles: '' };
  const str = String(markup);
  if (!str.trim()) return { bodyContent: '', styles: '' };

  const parser = new DOMParser();
  const collectStyles = (doc) => {
    if (!doc) return '';
    try {
      if (doc.head) {
        return Array.from(doc.head.querySelectorAll('style')).map((s) => s.innerHTML).join('\n');
      }
      const root = doc.documentElement;
      if (root) {
        return Array.from(root.querySelectorAll('style')).map((s) => s.innerHTML).join('\n');
      }
    } catch (_) { /* ignore */ }
    const st = doc.querySelector?.('style');
    return st ? st.innerHTML : '';
  };

  let doc = parser.parseFromString(str, 'text/html');
  let parserError = doc.querySelector('parsererror');
  let bodyContent = doc.body ? (doc.body.innerHTML || '') : '';

  if (parserError || !bodyContent.replace(/\s/g, '').length) {
    doc = parser.parseFromString(str, 'application/xml');
    parserError = doc.querySelector('parsererror');
    if (!parserError) {
      const bodyEl =
        doc.querySelector('body') ||
        doc.getElementsByTagNameNS?.('http://www.w3.org/1999/xhtml', 'body')?.[0];
      if (bodyEl) bodyContent = bodyEl.innerHTML || '';
      else if (doc.documentElement) bodyContent = doc.documentElement.innerHTML || '';
    }
  }

  return {
    bodyContent: (bodyContent || '').trim(),
    styles: collectStyles(doc),
  };
}
