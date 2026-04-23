import * as cheerio from 'cheerio';

/**
 * Reflowable EPUB readers (e.g. Thorium in spread/column mode) often paginate between lines
 * inside a single <p>. When two sync-sentence spans are separated by <br />, the first sentence
 * can land at the bottom of one column and the second at the top of the next — overlapping images.
 * Split into sibling <p> blocks (unique ids) so pagination breaks between paragraphs.
 *
 * @param {string} xhtml
 * @returns {string}
 */
export function splitParagraphBlocksAtBrBetweenSyncSentences(xhtml) {
  if (!xhtml || typeof xhtml !== 'string') return xhtml;
  try {
    const $ = cheerio.load(xhtml, { xmlMode: false, decodeEntities: false });
    $('p.paragraph-block').each((i, el) => {
      let $p = $(el);
      const baseId = ($p.attr('id') || '').trim();
      let splitPart = 2;

      while (true) {
        const $br = $p.children('br').first();
        if (!$br.length) break;

        let $prev = $br.prev();
        while ($prev.length && $prev[0]?.type === 'text') {
          $prev = $prev.prev();
        }
        let $next = $br.next();
        while ($next.length && $next[0]?.type === 'text') {
          $next = $next.next();
        }

        if (
          !$prev.length ||
          !$prev.is('span.sync-sentence') ||
          !$next.length ||
          !$next.is('span.sync-sentence')
        ) {
          break;
        }

        const baseAttrs = { ...($p[0]?.attribs || {}) };
        const newId = baseId ? `${baseId}_epub${splitPart}` : `paragraph_epub_${splitPart}_${i}`;
        splitPart++;

        $br.remove();

        const $newP = $('<p></p>');
        Object.keys(baseAttrs).forEach((k) => {
          const v = baseAttrs[k];
          if (v === undefined) return;
          if (k === 'id') $newP.attr('id', newId);
          else $newP.attr(k, v);
        });

        let cur = $next[0];
        while (cur) {
          const nextSibling = cur.nextSibling;
          $newP.append(cur);
          cur = nextSibling;
        }

        $newP.insertAfter($p);
        $p = $newP;
      }
    });
    return $.html();
  } catch (e) {
    console.warn('[xhtmlReflowParagraphSplit] cheerio split failed:', e.message);
    return xhtml;
  }
}
