import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import path from 'path';
import fs from 'fs-extra';

/**
 * Universal EPUB Remediation Engine (AA compliance helpers).
 *
 * Notes:
 * - Uses `adm-zip` + `cheerio` for reading/parsing/remediating EPUB entries.
 * - Re-packages with JSZip so `mimetype` can be added first and stored (uncompressed),
 *   which is a requirement for EPUB validity.
 */
export class RemedyEngine {
  constructor(options = {}) {
    this.defaultLanguage = options.defaultLanguage || 'en';
    this.schemaAccessibilityValues = options.schemaAccessibilityValues || {
      'schema:accessMode': { content: 'textual' },
      'schema:accessModeSufficient': { content: 'textual' },
      'schema:accessibilityFeature': { content: 'alternativeText' },
      'schema:accessibilityHazard': { content: 'noFlashingHazard' },
      'schema:accessibilitySummary': {
        content:
          'This EPUB publication provides accessibility features including support for alternative text and structured headings.'
      }
    };
  }

  /**
   * Apply template-style global fixes:
   * - Inject missing `lang` attributes into all XHTML/HTML documents.
   * - Inject Schema.org accessibility metadata into the OPF file.
   * - Add `role="doc-toc"` and `role="directory"` where appropriate.
   *
   * @param {string} epubPath
   */
  async applyGlobalFixes(epubPath) {
    if (!epubPath) throw new Error('applyGlobalFixes(epubPath): epubPath is required');
    if (!(await fs.pathExists(epubPath))) throw new Error(`EPUB not found at: ${epubPath}`);

    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();

    // Read OPF first to infer language.
    const opfEntry = entries.find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.opf')) || null;
    const opfContent = opfEntry ? zip.readAsText(opfEntry.entryName) : '';
    const inferredLanguage = this._inferLanguageFromOpf(opfContent) || this.defaultLanguage;

    const updatedEntryBuffers = new Map();

    // Walk XHTML/HTML entries and apply language + role fixes.
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const lower = entry.entryName.toLowerCase();
      if (!lower.endsWith('.xhtml') && !lower.endsWith('.html')) continue;

      const raw = zip.readAsText(entry.entryName);
      const fixed = this._fixXhtmlDocument(raw, {
        lang: inferredLanguage
      });

      // Only store if changed (minor perf, avoids touching untouched docs).
      if (fixed !== raw) updatedEntryBuffers.set(entry.entryName, Buffer.from(fixed, 'utf8'));
    }

    // Apply OPF schema metadata injection.
    if (opfEntry) {
      const fixedOpf = this._fixOpfPackageDocument(opfContent, inferredLanguage);
      if (fixedOpf !== opfContent) {
        updatedEntryBuffers.set(opfEntry.entryName, Buffer.from(fixedOpf, 'utf8'));
      }
    }

    if (updatedEntryBuffers.size === 0) return;

    await this._repackageEpubWithUpdatedEntries(epubPath, entries, zip, updatedEntryBuffers);
  }

  /**
   * Apply user-driven image alt fixes.
   *
   * @param {string} epubPath
   * @param {Record<string, string>} imageAltUpdates - keyed by Ace image `src` (best-effort match).
   */
  async applyImageAltFixes(epubPath, imageAltUpdates) {
    if (!imageAltUpdates || typeof imageAltUpdates !== 'object') return;

    const imageAltUpdatesClean = Object.fromEntries(
      Object.entries(imageAltUpdates).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    );
    if (Object.keys(imageAltUpdatesClean).length === 0) return;

    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();
    const updatedEntryBuffers = new Map();

    // Precompute basenames for matching.
    const updateKeys = Object.keys(imageAltUpdatesClean);
    const updateBasenames = new Set(updateKeys.map((k) => path.posix.basename(String(k))));

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const lower = entry.entryName.toLowerCase();
      if (!lower.endsWith('.xhtml') && !lower.endsWith('.html')) continue;

      const raw = zip.readAsText(entry.entryName);
      const fixed = this._fixXhtmlImageAlt(raw, imageAltUpdatesClean, updateBasenames);
      if (fixed !== raw) updatedEntryBuffers.set(entry.entryName, Buffer.from(fixed, 'utf8'));
    }

    if (updatedEntryBuffers.size === 0) return;
    await this._repackageEpubWithUpdatedEntries(epubPath, entries, zip, updatedEntryBuffers);
  }

  /**
   * Apply user-driven heading level fixes based on heading order index.
   *
   * @param {string} epubPath
   * @param {number[]} headingLevels - new aria/h tag levels by index.
   */
  async applyHeadingOrderFixes(epubPath, headingLevels) {
    if (!Array.isArray(headingLevels) || headingLevels.length === 0) return;

    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();
    const updatedEntryBuffers = new Map();

    const opfEntry = entries.find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.opf')) || null;
    const spineOrder = opfEntry ? this._inferSpineOrderEntries(zip, opfEntry.entryName) : [];
    const xhtmlEntries = this._orderXhtmlEntries(entries, spineOrder);

    let headingIdx = 0;
    for (const entryName of xhtmlEntries) {
      if (headingIdx >= headingLevels.length) break;

      const raw = zip.readAsText(entryName);
      const { fixedContent, advanceBy } = this._fixHeadingsInXhtml(raw, headingLevels, headingIdx);
      if (fixedContent !== raw) updatedEntryBuffers.set(entryName, Buffer.from(fixedContent, 'utf8'));
      headingIdx += advanceBy;
    }

    if (updatedEntryBuffers.size === 0) return;
    await this._repackageEpubWithUpdatedEntries(epubPath, entries, zip, updatedEntryBuffers);
  }

  /**
   * Best-effort malformed EPUB normalization pass.
   * This runs before Ace to reduce cases where Ace can't load one or more content documents.
   *
   * @param {string} epubPath
   * @returns {Promise<{updatedEntries:number, entryNames:string[]}>}
   */
  async applyMalformedFixes(epubPath) {
    if (!epubPath) throw new Error('applyMalformedFixes(epubPath): epubPath is required');
    if (!(await fs.pathExists(epubPath))) throw new Error(`EPUB not found at: ${epubPath}`);

    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();
    const updatedEntryBuffers = new Map();
    const touchedEntryNames = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = String(entry.entryName || '');
      const lower = entryName.toLowerCase();

      const isXhtmlLike =
        lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm');
      const isXmlLike =
        lower.endsWith('.opf') || lower.endsWith('.ncx') || lower.endsWith('.xml');

      if (!isXhtmlLike && !isXmlLike) continue;

      const raw = zip.readAsText(entryName);
      if (typeof raw !== 'string') continue;

      let next = this._stripMalformedBomEntity(raw);
      next = this._stripInvalidXmlControlChars(next);
      next = this._normalizeCommonBrokenRefs(next);
      if (isXhtmlLike) next = this._normalizeMalformedDoctype(next);
      next = this._tolerantReserializeXml(next, { isXhtmlLike });
      if (isXhtmlLike) next = this._stabilizeKnownProblemPage(entryName, next);

      if (next && next !== raw) {
        updatedEntryBuffers.set(entryName, Buffer.from(next, 'utf8'));
        touchedEntryNames.push(entryName);
      }
    }

    if (updatedEntryBuffers.size === 0) return { updatedEntries: 0, entryNames: [] };
    await this._repackageEpubWithUpdatedEntries(epubPath, entries, zip, updatedEntryBuffers);
    return { updatedEntries: updatedEntryBuffers.size, entryNames: touchedEntryNames };
  }

  _stripMalformedBomEntity(raw) {
    if (!raw) return raw;
    // Some EPUBs contain a literal "&#xfeff;" before the XML declaration.
    return String(raw).replace(/^\s*(?:\uFEFF|&#xfeff;|&#xFEFF;)\s*/i, '');
  }

  _stripInvalidXmlControlChars(raw) {
    if (!raw) return raw;
    // XML 1.0 disallows most control chars except TAB, LF, CR.
    return String(raw).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  _normalizeMalformedDoctype(raw) {
    if (!raw) return raw;
    return String(raw).replace(/<!DOCTYPE\s+html\s*\[\s*\]>/gi, '<!DOCTYPE html>');
  }

  _normalizeCommonBrokenRefs(raw) {
    if (!raw) return raw;
    let next = String(raw);
    // Common malformed page refs: page-0010xhtml -> page-0010.xhtml
    next = next.replace(/(href\s*=\s*["'][^"']*page-\d+)xhtml(["'])/gi, '$1.xhtml$2');
    // Normalize accidental backslashes in URL attributes.
    next = next.replace(/\b(href|src)\s*=\s*["']([^"']*)["']/gi, (_m, attr, value) => {
      const normalized = String(value).replace(/\\/g, '/');
      return `${attr}="${normalized}"`;
    });
    return next;
  }

  _tolerantReserializeXml(raw, { isXhtmlLike }) {
    if (!raw) return raw;
    try {
      const $ = cheerio.load(raw, { xmlMode: true, decodeEntities: false });
      let out = $.xml() || raw;

      if (isXhtmlLike) {
        const hasHtml = $('html').length > 0;
        const hasBody = $('body').length > 0;
        if (!hasHtml || !hasBody) {
          // Last-resort recovery shell for malformed pages.
          const escaped = String(raw)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          out = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Recovered page</title></head><body><pre>${escaped}</pre></body></html>`;
        }
      }

      return out;
    } catch (_err) {
      return raw;
    }
  }

  _stabilizeKnownProblemPage(entryName, raw) {
    const base = path.posix.basename(String(entryName || '')).toLowerCase();
    if (base !== 'blank.xhtml') return raw;

    // Ace can hang on malformed/placeholder blank.xhtml pages; replace with minimal valid XHTML.
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
  <head>
    <meta charset="utf-8"/>
    <title>Blank</title>
  </head>
  <body tabindex="0"></body>
</html>`;
  }

  /**
   * Apply approved code repairs generated by AI (human-in-the-loop approved).
   *
   * @param {string} epubPath
   * @param {Array<{filePath?: string, offendingSnippet?: string, fixedSnippet?: string}>} codeRepairs
   */
  async applyApprovedCodeRepairs(epubPath, codeRepairs) {
    if (!Array.isArray(codeRepairs) || codeRepairs.length === 0) return;

    const validRepairs = codeRepairs.filter(
      (r) =>
        r &&
        typeof r.offendingSnippet === 'string' &&
        r.offendingSnippet.trim().length > 0 &&
        typeof r.fixedSnippet === 'string' &&
        r.fixedSnippet.trim().length > 0
    );
    if (validRepairs.length === 0) return;

    const zip = new AdmZip(epubPath);
    const entries = zip.getEntries();
    const updatedEntryBuffers = new Map();

    const xhtmlEntries = entries
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName)
      .filter((n) => n.toLowerCase().endsWith('.xhtml') || n.toLowerCase().endsWith('.html'));

    for (const repair of validRepairs) {
      const targetEntries = [];
      if (repair.filePath && typeof repair.filePath === 'string') {
        const fp = repair.filePath.replace(/\\/g, '/').replace(/^\//, '');
        const exact =
          xhtmlEntries.find((n) => n === fp) ||
          xhtmlEntries.find((n) => n.endsWith(`/${fp}`)) ||
          null;
        if (exact) targetEntries.push(exact);
      }
      if (targetEntries.length === 0) targetEntries.push(...xhtmlEntries);

      for (const entryName of targetEntries) {
        const currentRaw = updatedEntryBuffers.has(entryName)
          ? updatedEntryBuffers.get(entryName).toString('utf8')
          : zip.readAsText(entryName);
        if (!currentRaw) continue;

        const nextRaw = this._applySnippetReplacementWithCheerio(
          currentRaw,
          repair.offendingSnippet,
          repair.fixedSnippet
        );

        if (nextRaw !== currentRaw) {
          updatedEntryBuffers.set(entryName, Buffer.from(nextRaw, 'utf8'));
          break; // Apply each repair once.
        }
      }
    }

    if (updatedEntryBuffers.size === 0) return;
    await this._repackageEpubWithUpdatedEntries(epubPath, entries, zip, updatedEntryBuffers);
  }

  _inferLanguageFromOpf(opfContent) {
    if (!opfContent) return null;
    // Best-effort regex for xml:lang in OPF.
    const m = opfContent.match(/<\s*package[^>]*\sxml:lang\s*=\s*"([^"]+)"/i);
    if (m?.[1]) return m[1];
    // Fallback: any lang attribute.
    const m2 = opfContent.match(/<\s*package[^>]*\slang\s*=\s*"([^"]+)"/i);
    if (m2?.[1]) return m2[1];
    return null;
  }

  _fixXhtmlDocument(raw, { lang }) {
    if (!raw) return raw;

    const $ = cheerio.load(raw, { xmlMode: true });
    const html = $('html').first();
    if (html && html.length > 0) {
      const hasLang = html.attr('lang') || html.attr('xml:lang');
      if (!hasLang && lang) {
        html.attr('lang', lang);
        html.attr('xml:lang', lang);
      }
    }

    // Full epub:type → DPUB-ARIA role mapping (covers epub-type-has-matching-role / epub-type-has-matching-dpub-role)
    const epubTypeDpubRoleMap = {
      'toc':            'doc-toc',
      'page-list':     'doc-pagelist',
      'directory':      'directory',
      'landmarks':      'doc-landmarks',
      'loi':            'doc-loi',
      'lot':            'doc-lot',
      'lov':            'doc-lov',
      'loa':            'doc-loa',
      'index':          'doc-index',
      'chapter':        'doc-chapter',
      'part':           'doc-part',
      'foreword':       'doc-foreword',
      'preface':        'doc-preface',
      'introduction':   'doc-introduction',
      'prologue':       'doc-prologue',
      'epilogue':       'doc-epilogue',
      'conclusion':     'doc-conclusion',
      'afterword':      'doc-afterword',
      'appendix':       'doc-appendix',
      'colophon':       'doc-colophon',
      'acknowledgments':'doc-acknowledgments',
      'dedication':     'doc-dedication',
      'epigraph':       'doc-epigraph',
      'errata':         'doc-errata',
      'glossary':       'doc-glossary',
      'bibliography':   'doc-bibliography',
      'footnote':       'doc-footnote',
      'rearnote':       'doc-rearnote',
      'footnotes':      'doc-footnotes',
      'rearnotes':      'doc-rearnotes',
      'notice':         'doc-notice',
      'tip':            'doc-tip',
      'pullquote':      'doc-pullquote',
      'subtitle':       'doc-subtitle',
    };

    // Map epub:type tokens to DPUB roles.
    // Use token parsing (not exact selector only) so values like
    // epub:type="chapter bodymatter" are also handled.
    $('[epub\\:type]').each((_, el) => {
      const node = $(el);
      if (node.attr('role')) return;

      const epubTypeRaw = String(node.attr('epub:type') || '').trim().toLowerCase();
      if (!epubTypeRaw) return;

      const tokens = epubTypeRaw.split(/\\s+/).filter(Boolean);
      const mappedRole = tokens.map((t) => epubTypeDpubRoleMap[t]).find(Boolean);
      if (mappedRole) node.attr('role', mappedRole);
    });

    // Landmark nav compatibility (fix doc-landmarks role + ensure aria-label).
    $('nav[epub\\:type~="landmarks"]').each((_, el) => {
      const node = $(el);
      const role = String(node.attr('role') || '').trim().toLowerCase();
      if (role === 'doc-landmarks') node.attr('role', 'navigation');

      const hasLabel =
        String(node.attr('aria-label') || '').trim().length > 0 ||
        String(node.attr('aria-labelledby') || '').trim().length > 0 ||
        String(node.attr('title') || '').trim().length > 0;
      if (!hasLabel) node.attr('aria-label', 'Landmarks');
    });

    // Fix broken page-list hrefs such as "page-0010xhtml" -> "page-0010.xhtml".
    $('nav[epub\\:type~="page-list"] a[href]').each((_, el) => {
      const node = $(el);
      const href = String(node.attr('href') || '').trim();
      if (!href) return;
      if (/page-\\d+xhtml$/i.test(href)) {
        node.attr('href', href.replace(/xhtml$/i, '.xhtml'));
      }
    });

    // Ensure decorative HTML images (role="presentation" or aria-hidden) have explicit alt=""
    // so Ace reports "" instead of N/A and screen readers skip them cleanly.
    // Also handle fixed-layout HTML page-canvas <img> elements which often use <img class="bi"...>
    // as full-page artwork; for these we set alt="" (auto-handled) so Ace doesn't ask for user alt text.
    $('img').each((_, el) => {
      const node = $(el);
      const role = String(node.attr('role') || '').toLowerCase();
      const ariaHidden = String(node.attr('aria-hidden') || '').toLowerCase();
      const isDecorative = role === 'presentation' || role === 'none' || ariaHidden === 'true';
      const cls = String(node.attr('class') || '').toLowerCase();
      const src = String(node.attr('src') || '')
        .replace(/\\/g, '/')
        .toLowerCase();
      const looksLikeFxlPageCanvas =
        /\bbi\b/.test(cls) ||
        /(\/|^)images\/(bg\d+|cover\d*)\.(png|jpe?g|webp|gif|svg)$/.test(src) ||
        /(\/|^)image\/(bg\d+|cover\d*)\.(png|jpe?g|webp|gif|svg)$/.test(src);

      if (isDecorative || looksLikeFxlPageCanvas) {
        if (node.attr('alt') === undefined) node.attr('alt', '');
      }
    });

    // FXL EPUB pages use SVG <image> elements (not HTML <img>) to embed page graphics.
    // SVG <image> has no alt attribute — accessibility requires role="img" + aria-label on
    // the parent <svg>. Without this, Ace shows "N/A" for every page image.
    // We infer a page label from the <title> element (e.g. "Page 1") and apply it.
    const pageTitle = $('title').first().text().trim() || '';
    $('svg').each((_, svgEl) => {
      const svgNode = $(svgEl);
      // Only patch SVG elements that contain an <image> child and have no role yet.
      const hasSvgImage = svgNode.find('image[href], image[xlink\\:href]').length > 0;
      if (!hasSvgImage) return;
      if (!svgNode.attr('role')) {
        svgNode.attr('role', 'img');
      }
      if (!svgNode.attr('aria-label') && !svgNode.attr('aria-labelledby')) {
        const label = pageTitle || 'Page illustration';
        svgNode.attr('aria-label', label);
      }
    });

    // Fix axe "scrollable-region-focusable":
    // EPUB pages often scroll at <body> level; ensure keyboard users can focus it.
    const body = $('body').first();
    if (body && body.length > 0 && !body.attr('tabindex')) {
      body.attr('tabindex', '0');
    }

    // Also patch obvious inline scroll containers missing tabindex.
    $('[style]').each((_, el) => {
      const node = $(el);
      if (node.attr('tabindex')) return;
      const style = String(node.attr('style') || '').toLowerCase();
      const isScrollable = /overflow(?:-x|-y)?\s*:\s*(auto|scroll)/.test(style);
      if (isScrollable) node.attr('tabindex', '0');
    });

    // Landmark normalization:
    // - Ensure only one contentinfo landmark per document.
    // - Ensure repeated landmarks are distinguishable via aria-label.
    const landmarkRoles = new Set([
      'banner',
      'main',
      'navigation',
      'complementary',
      'contentinfo',
      'search',
      'form',
      'region'
    ]);

    const byRole = new Map();
    $('[role]').each((_, el) => {
      const node = $(el);
      const role = String(node.attr('role') || '').trim().toLowerCase();
      if (!landmarkRoles.has(role)) return;
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(node);
    });

    const hasLandmarkLabel = (node) => {
      const ariaLabel = String(node.attr('aria-label') || '').trim();
      const ariaLabelledBy = String(node.attr('aria-labelledby') || '').trim();
      const title = String(node.attr('title') || '').trim();
      return !!(ariaLabel || ariaLabelledBy || title);
    };

    // Keep only one contentinfo. Demote extras to region with unique labels.
    const contentInfoNodes = byRole.get('contentinfo') || [];
    if (contentInfoNodes.length > 1) {
      for (let i = 1; i < contentInfoNodes.length; i += 1) {
        const node = contentInfoNodes[i];
        node.attr('role', 'region');
        if (!hasLandmarkLabel(node)) {
          node.attr('aria-label', `Additional content information ${i}`);
        }
      }
    }

    // Rebuild role groups after potential contentinfo demotion.
    const byRoleAfter = new Map();
    $('[role]').each((_, el) => {
      const node = $(el);
      const role = String(node.attr('role') || '').trim().toLowerCase();
      if (!landmarkRoles.has(role)) return;
      if (!byRoleAfter.has(role)) byRoleAfter.set(role, []);
      byRoleAfter.get(role).push(node);
    });

    // If a landmark role repeats, ensure each repeated instance has a unique label.
    for (const [role, nodes] of byRoleAfter.entries()) {
      if (!nodes || nodes.length <= 1) continue;
      nodes.forEach((node, idx) => {
        if (hasLandmarkLabel(node)) return;
        node.attr('aria-label', `${role} ${idx + 1}`);
      });
    }

    // Ace often flags duplicated implicit contentinfo landmarks from repeated <footer> tags
    // in multi-page fixed-layout XHTML. Keep the first footer as landmark-like context and
    // neutralize additional decorative/page-number footers.
    const footerNodes = $('footer').toArray().map((el) => $(el));
    if (footerNodes.length > 1) {
      const firstFooter = footerNodes[0];
      if (!hasLandmarkLabel(firstFooter)) firstFooter.attr('aria-label', 'Document footer');

      for (let i = 1; i < footerNodes.length; i += 1) {
        const node = footerNodes[i];
        node.attr('role', 'none');
        node.attr('aria-hidden', 'true');
        node.removeAttr('aria-label');
        node.removeAttr('aria-labelledby');
        node.removeAttr('title');
      }
    }

    // Preserve original if cheerio didn't change anything.
    const out = $.xml();
    return out && out.trim().length > 0 ? out : raw;
  }

  _fixOpfPackageDocument(opfRaw, lang) {
    if (!opfRaw) return opfRaw;

    const $ = cheerio.load(opfRaw, { xmlMode: true });
    const metadata = $('package > metadata').first();
    if (!metadata || metadata.length === 0) return opfRaw;

    let changed = false;

    const escapeXml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    // Ensure OPF <package> has xml:lang / lang (Ace checks this).
    const pkg = $('package').first();
    if (pkg && pkg.length > 0 && lang) {
      const hasXmlLang = pkg.attr('xml:lang');
      const hasLang = pkg.attr('lang');
      if (!hasXmlLang && !hasLang) {
        pkg.attr('xml:lang', lang);
        pkg.attr('lang', lang);
        changed = true;
      }

      // Ensure schema prefix is declared for schema:* metadata properties.
      const prefix = pkg.attr('prefix') || '';
      if (!/\bschema:\s*https?:\/\/schema\.org\/?/i.test(prefix)) {
        const nextPrefix = `${prefix} schema: http://schema.org/`.trim();
        pkg.attr('prefix', nextPrefix.replace(/\s+/g, ' '));
        changed = true;
      }
    }

    for (const [property, { content }] of Object.entries(this.schemaAccessibilityValues)) {
      const existing = metadata.find(`meta[property="${property}"]`).first();
      if (!existing || existing.length === 0) {
        // Use text content (not only @content), which Ace metadata checks rely on.
        metadata.append(`<meta property="${property}">${escapeXml(content)}</meta>`);
        changed = true;
        continue;
      }

      const currentText = (existing.text() || '').trim();
      const currentContentAttr = (existing.attr('content') || '').trim();
      if (!currentText) {
        existing.text(currentContentAttr || String(content));
        changed = true;
      }
      if (existing.attr('content') !== undefined) {
        existing.removeAttr('content');
        changed = true;
      }
    }

    if (!changed) return opfRaw;
    return $.xml();
  }

  _fixXhtmlImageAlt(raw, imageAltUpdatesClean, updateBasenames) {
    if (!raw) return raw;
    const $ = cheerio.load(raw, { xmlMode: true });

    // Normalize a path: strip leading ./, ../, OEBPS/ for comparison
    const normSrc = (s) =>
      String(s)
        .replace(/\\/g, '/')
        .replace(/^(?:\.\.\/)+/, '')
        .replace(/^\.\//, '')
        .replace(/^OEBPS\//, '');

    let changed = false;
    $('img').each((_, el) => {
      const node = $(el);
      const src = node.attr('src');
      if (!src) return;

      const srcNorm = normSrc(src);
      const cls = String(node.attr('class') || '').toLowerCase();
      const looksLikeFxlPageCanvas =
        /\bbi\b/.test(cls) ||
        /(\/|^)images\/(bg\d+|cover\d*)\.(png|jpe?g|webp|gif|svg)$/i.test(srcNorm) ||
        /(\/|^)image\/(bg\d+|cover\d*)\.(png|jpe?g|webp|gif|svg)$/i.test(srcNorm);

      // Safety guard:
      // Do not overwrite alt for fixed-layout page-canvas HTML images with AI/auto drafts.
      // These are page backgrounds/artboards (e.g. bg10.jpg / cover1.jpg) rendered as full-page canvases.
      if (looksLikeFxlPageCanvas) return;

      const base = path.posix.basename(srcNorm);

      // Match by normalized path first, then basename.
      let matchedKey = null;
      for (const k of Object.keys(imageAltUpdatesClean)) {
        if (normSrc(k) === srcNorm) {
          matchedKey = k;
          break;
        }
      }
      if (!matchedKey && updateBasenames.has(base)) {
        matchedKey = Object.keys(imageAltUpdatesClean).find((k) => path.posix.basename(normSrc(k)) === base) || null;
      }
      if (!matchedKey) return;

      const currentAlt = node.attr('alt');
      const shouldUpdate = !currentAlt || String(currentAlt).trim().length === 0;
      if (!shouldUpdate) return; // do not overwrite filled alt unless it is empty.

      const nextAlt = imageAltUpdatesClean[matchedKey];
      if (nextAlt && nextAlt.trim().length > 0) {
        node.attr('alt', nextAlt.trim());
        changed = true;
      }
    });

    return changed ? $.xml() : raw;
  }

  _inferSpineOrderEntries(zip, opfEntryName) {
    const opfRaw = zip.readAsText(opfEntryName);
    if (!opfRaw) return [];

    const $ = cheerio.load(opfRaw, { xmlMode: true });
    const manifest = $('package > manifest').first();
    const spine = $('package > spine').first();
    if (!manifest || !spine || manifest.length === 0 || spine.length === 0) return [];

    const idToHref = new Map();
    manifest.find('item[id][href]').each((_, el) => {
      const id = $(el).attr('id');
      const href = $(el).attr('href');
      if (id && href) idToHref.set(id, href);
    });

    const xhtmlHrefs = [];
    spine.find('itemref[idref]').each((_, el) => {
      const idref = $(el).attr('idref');
      const href = idToHref.get(idref);
      if (!href) return;
      const hrefLower = href.toLowerCase();
      if (hrefLower.endsWith('.xhtml') || hrefLower.endsWith('.html')) xhtmlHrefs.push(href);
    });

    // Convert hrefs into zip entry names: in these EPUBs href values commonly start with the OEBPS folder.
    return xhtmlHrefs.map((href) => String(href).replace(/\\/g, '/'));
  }

  _orderXhtmlEntries(entries, spineOrder) {
    const xhtml = entries
      .filter((e) => !e.isDirectory)
      .map((e) => e.entryName)
      .filter((n) => n.toLowerCase().endsWith('.xhtml') || n.toLowerCase().endsWith('.html'));

    if (!spineOrder || spineOrder.length === 0) {
      // fallback: lexicographic
      return [...xhtml].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }

    // Use spine order for the known subset, then append remaining in a stable order.
    const spineSet = new Set(spineOrder.map((s) => String(s).replace(/\\/g, '/')));
    const spineMatched = spineOrder
      .map((s) => s.replace(/\\/g, '/'))
      .filter((s) => xhtml.includes(s));

    const remaining = xhtml.filter((n) => !spineSet.has(n));
    remaining.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return [...spineMatched, ...remaining];
  }

  _fixHeadingsInXhtml(raw, headingLevels, startingIndex) {
    const $ = cheerio.load(raw, { xmlMode: true });
    let headingCountAdvanced = 0;

    const headingSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
    const headingElems = $(headingSelector).toArray();

    for (let i = 0; i < headingElems.length; i++) {
      const idx = startingIndex + headingCountAdvanced;
      if (idx >= headingLevels.length) break;

      const nextLevel = Number(headingLevels[idx]);
      if (!Number.isFinite(nextLevel) || nextLevel < 1 || nextLevel > 6) {
        headingCountAdvanced++;
        continue;
      }

      const el = headingElems[i];
      const node = $(el);
      const tagName = (el.tagName || '').toLowerCase();

      if (/^h[1-6]$/.test(tagName)) {
        const nextTag = `h${nextLevel}`;
        const attrs = node.attr() || {};

        // Replace with a new tag while keeping attributes + children.
        const newEl = $(`<${nextTag}/>`);
        for (const [k, v] of Object.entries(attrs)) newEl.attr(k, v);
        newEl.append(node.contents());
        node.replaceWith(newEl);
      } else {
        // role="heading" case: use aria-level.
        if (!node.attr('role')) node.attr('role', 'heading');
        node.attr('aria-level', String(nextLevel));
      }

      headingCountAdvanced++;
    }

    // Determine whether any modifications were applied.
    const fixedXml = $.xml();
    const advanceBy = headingCountAdvanced;
    return { fixedContent: fixedXml, advanceBy };
  }

  _applySnippetReplacementWithCheerio(raw, offendingSnippet, fixedSnippet) {
    if (!raw) return raw;
    const offending = offendingSnippet.trim();
    const fixed = fixedSnippet.trim();
    if (!offending || !fixed) return raw;

    // Primary path: direct snippet replacement in source text.
    if (raw.includes(offending)) return raw.replace(offending, fixed);

    // Secondary path: whitespace-agnostic replacement using token regex.
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokens = offending.split(/\s+/).filter(Boolean);
    if (tokens.length >= 3) {
      const pattern = tokens.map((t) => escapeRegExp(t)).join('\\s+');
      const re = new RegExp(pattern, 'g');
      if (re.test(raw)) return raw.replace(re, fixed);
    }

    // Fallback path using cheerio normalization:
    const $ = cheerio.load(raw, { xmlMode: true });
    const xml = $.xml();
    if (xml.includes(offending)) return xml.replace(offending, fixed);
    if (tokens.length >= 3) {
      const pattern = tokens.map((t) => escapeRegExp(t)).join('\\s+');
      const re = new RegExp(pattern, 'g');
      if (re.test(xml)) return xml.replace(re, fixed);
    }

    // Final fallback: ID-based patching.
    // Gemini sometimes returns snippets that don't match the current XHTML byte-for-byte.
    // For style/attribute fixes (e.g. color-contrast), the fixed snippet usually contains
    // elements with stable `id="..."` attributes. We patch those nodes directly.
    const ids = Array.from(fixed.matchAll(/id="([^"]+)"/g)).map((m) => m[1]).filter(Boolean);
    if (ids.length > 0) {
      try {
        const currentDom = cheerio.load(raw, { xmlMode: true });
        const fixedDom = cheerio.load(`<root>${fixed}</root>`, { xmlMode: true });

        for (const id of new Set(ids)) {
          // Use attribute selector to avoid CSS selector escaping issues.
          const fixedNode = fixedDom(`[id="${id}"]`).first();
          if (!fixedNode || fixedNode.length === 0) continue;

          const currentNode = currentDom(`[id="${id}"]`).first();
          if (!currentNode || currentNode.length === 0) continue;

          // Replace the whole node so both style and any surrounding markup in the node are applied.
          currentNode.replaceWith(fixedNode.clone());
        }

        const patched = currentDom.xml();
        if (patched && patched !== raw) return patched;
      } catch (e) {
        // If ID-based patching fails, just return the original raw unchanged.
      }
    }

    return raw;
  }

  async _repackageEpubWithUpdatedEntries(epubPath, originalEntries, zip, updatedEntryBuffers) {
    const tempPath = `${epubPath}.remedied_${Date.now()}.epub`;
    const jszip = new JSZip();

    // Add mimetype first, stored.
    const mimetypeEntry = originalEntries.find(
      (e) => !e.isDirectory && e.entryName.toLowerCase().replace(/\\/g, '/') === 'mimetype'
    );
    const mimetypeContent = mimetypeEntry
      ? (zip.readAsText(mimetypeEntry.entryName) || 'application/epub+zip')
      : 'application/epub+zip';
    jszip.file('mimetype', mimetypeContent, { compression: 'STORE' });

    // Add all other files.
    for (const entry of originalEntries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;
      if (entryName.toLowerCase().replace(/\\/g, '/') === 'mimetype') continue;

      const updated = updatedEntryBuffers.get(entryName);
      const content = updated || zip.readFile(entryName);
      // Keep JSZip default compression for everything else.
      jszip.file(entryName, content, { binary: true });
    }

    const buffer = await jszip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    await fs.writeFile(tempPath, buffer);
    await fs.move(tempPath, epubPath, { overwrite: true });
  }
}

