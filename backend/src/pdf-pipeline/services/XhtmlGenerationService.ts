import fs from 'fs/promises';
import path from 'path';

import type { CoordsJson, HtmlTextElement, PageModel, SentenceModel } from '../types.js';

import { createLogger } from '../utils/logger.js';

const log = createLogger('XhtmlGeneration');

/** pdf2htmlEX internal scale factor (m1 matrix); native page coords are 1/scale of viewport. */
export const PDF2HTML_NATIVE_SCALE = 0.25;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function roundPx(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function inferPageNumber(htmlPath: string, fallback: number): number {
  const baseMatch = /page[_-]?(\d+)/i.exec(path.basename(htmlPath));
  if (baseMatch) return parseInt(baseMatch[1], 10);

  const pageFileMatch = /input(\d+)\.page$/i.exec(path.basename(htmlPath));
  if (pageFileMatch) return parseInt(pageFileMatch[1], 10);

  return fallback;
}

function nativePageDimensions(page: PageModel): { width: number; height: number } {
  return {
    width: Math.round((page.width / PDF2HTML_NATIVE_SCALE) * 100) / 100,
    height: Math.round((page.height / PDF2HTML_NATIVE_SCALE) * 100) / 100,
  };
}

function rewritePdf2htmlAssetPaths(html: string): string {
  return html
    .replace(/src="([^"/][^"]*\.(?:png|jpe?g|gif|webp|svg))"/gi, (_match, file: string) => {
      const name = path.basename(file);
      return `src="../images/${name}"`;
    })
    .replace(/src='([^'/][^']*\.(?:png|jpe?g|gif|webp|svg))'/gi, (_match, file: string) => {
      const name = path.basename(file);
      return `src='../images/${name}'`;
    });
}

function visibleTextFromHtml(inner: string): string {
  return inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Inject sentence ids onto visible pdf2htmlEX .t divs (one id per non-empty line).
 * domIndex matches HtmlParserService: only non-empty .t lines are counted.
 */
function injectSentenceIds(html: string, sentences: SentenceModel[]): string {
  const idByDomIndex = new Map<number, string>();
  for (const sentence of sentences) {
    if (sentence.domIndex != null) {
      idByDomIndex.set(sentence.domIndex, sentence.id);
    }
  }

  if (idByDomIndex.size === 0) return html;

  let tDomIndex = 0;
  return html.replace(
    /<div\b([^>]*?)class="t\b[^>]*>([\s\S]*?)<\/div>/g,
    (match, _attrs: string, inner: string) => {
      const text = visibleTextFromHtml(inner);
      if (!text) return match;

      const sentenceId = idByDomIndex.get(tDomIndex);
      tDomIndex += 1;
      if (!sentenceId) return match;

      if (/\bid\s*=/.test(match)) {
        return match.replace(/\bid\s*=\s*("[^"]*"|'[^']*')/, `id="${escapeXml(sentenceId)}"`);
      }
      return match.replace(/^<div\b/, `<div id="${escapeXml(sentenceId)}" epub:type="text"`);
    }
  );
}

export class XhtmlGenerationService {
  /**
   * Generate FXL XHTML pages: native pdf2htmlEX HTML with sentence ids on each .t line.
   */
  static async generatePages(
    epubDir: string,
    coords: CoordsJson,
    _imageFiles: string[] = [],
    _elements: HtmlTextElement[] = [],
    htmlPageFiles: string[] = []
  ): Promise<string[]> {
    const pagesDir = path.join(epubDir, 'pages');
    await fs.mkdir(pagesDir, { recursive: true });

    const htmlByPage = new Map<number, string>();
    for (let i = 0; i < htmlPageFiles.length; i++) {
      const htmlPath = htmlPageFiles[i];
      const pageNumber = inferPageNumber(htmlPath, i + 1);
      const raw = await fs.readFile(htmlPath, 'utf8');
      htmlByPage.set(pageNumber, rewritePdf2htmlAssetPaths(raw.trim()));
    }

    const xhtmlFiles: string[] = [];

    for (const page of coords.pages) {
      const pageSentences = coords.sentences.filter((s) => s.page === page.number);
      const nativeHtml = htmlByPage.get(page.number);

      const fileName = `page_${page.number}.xhtml`;
      const xhtml = XhtmlGenerationService.buildPageXhtml(page, pageSentences, nativeHtml);

      const filePath = path.join(pagesDir, fileName);
      await fs.writeFile(filePath, xhtml, 'utf8');
      xhtmlFiles.push(`pages/${fileName}`);
    }

    log.info('XHTML pages generated', {
      count: xhtmlFiles.length,
      nativePdf2html: htmlByPage.size,
    });

    return xhtmlFiles;
  }

  private static buildPageXhtml(
    page: PageModel,
    sentences: SentenceModel[],
    nativePdf2htmlHtml?: string
  ): string {
    const native = nativePageDimensions(page);
    const pageWidth = roundPx(native.width);
    const pageHeight = roundPx(native.height);

    const visualHtml = nativePdf2htmlHtml
      ? injectSentenceIds(nativePdf2htmlHtml, sentences)
      : '';

    const visualLayer = visualHtml ? `<div class="pdf2html-visual">${visualHtml}</div>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Page ${page.number}</title>
  <link rel="stylesheet" type="text/css" href="../css/base.min.css"/>
  <link rel="stylesheet" type="text/css" href="../css/input.css"/>
  <link rel="stylesheet" type="text/css" href="../css/fxl.css"/>
  <meta name="viewport" content="width=${pageWidth}, height=${pageHeight}"/>
</head>
<body class="fxl-page" style="width:${pageWidth}px;height:${pageHeight}px;margin:0;padding:0;">
  <div class="page-container" epub:type="pagebreak" id="page_${page.number}" style="position:relative;width:${pageWidth}px;height:${pageHeight}px;overflow:hidden;">
    ${visualLayer}
  </div>
</body>
</html>`;
  }
}
