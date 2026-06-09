import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import type { CoordsJson, ConversionOptions, HtmlTextElement } from '../types.js';
import { PDF2HTML_NATIVE_SCALE, XhtmlGenerationService } from './XhtmlGenerationService.js';
import { SmilGenerationService } from './SmilGenerationService.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('EpubGeneration');

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class EpubGenerationService {
  /**
   * Assemble EPUB 3 Fixed Layout package with OPF, NAV, pages, CSS, fonts, images, SMIL.
   */
  static async generate(
    layout: {
      epub: string;
      smil: string;
      css: string;
      images: string;
      fonts: string;
      outputEpub: string;
    },
    coords: CoordsJson,
    options: ConversionOptions = {},
    elements: HtmlTextElement[] = [],
    htmlPageFiles: string[] = []
  ): Promise<string> {
    const epubDir = layout.epub;
    await fs.mkdir(epubDir, { recursive: true });
    await fs.mkdir(path.join(epubDir, 'META-INF'), { recursive: true });
    await fs.mkdir(path.join(epubDir, 'css'), { recursive: true });
    await fs.mkdir(path.join(epubDir, 'images'), { recursive: true });
    await fs.mkdir(path.join(epubDir, 'fonts'), { recursive: true });
    await fs.mkdir(path.join(epubDir, 'audio'), { recursive: true });
    await fs.mkdir(path.join(epubDir, 'smil'), { recursive: true });

    // Copy assets
    const imageFiles = await EpubGenerationService.copyDir(layout.images, path.join(epubDir, 'images'));
    const fontFiles = await EpubGenerationService.copyDir(layout.fonts, path.join(epubDir, 'fonts'));
    const pdf2htmlCssFiles = await EpubGenerationService.copyPdf2htmlCss(
      layout.css,
      path.join(epubDir, 'css')
    );
    await EpubGenerationService.writeDefaultCss(
      path.join(epubDir, 'css', 'fxl.css'),
      fontFiles
    );

    // Generate XHTML pages
    const xhtmlFiles = await XhtmlGenerationService.generatePages(
      epubDir,
      coords,
      imageFiles,
      elements,
      htmlPageFiles
    );

    // Generate SMIL overlays
    const smilFiles = await SmilGenerationService.generate(
      path.join(epubDir, 'smil'),
      coords
    );

    // Also copy SMIL to job smil dir
    for (const smilFile of smilFiles) {
      await fs.copyFile(
        path.join(epubDir, 'smil', smilFile),
        path.join(layout.smil, smilFile)
      ).catch(() => {});
    }

    const title = options.title || 'Fixed Layout Book';
    const author = options.author || 'Unknown';
    const language = options.language || 'en';

    await EpubGenerationService.writeContainer(epubDir);
    await EpubGenerationService.writeOpf(epubDir, {
      title,
      author,
      language,
      xhtmlFiles,
      smilFiles,
      imageFiles,
      fontFiles,
      pageWidth: EpubGenerationService.nativePageWidth(coords.pages[0]?.width || 612),
      pageHeight: EpubGenerationService.nativePageHeight(coords.pages[0]?.height || 792),
      pdf2htmlCssFiles,
    });
    await EpubGenerationService.writeNav(epubDir, coords.pages, title);

    await EpubGenerationService.zipEpub(epubDir, layout.outputEpub);
    log.info('EPUB generated', { path: layout.outputEpub });
    return layout.outputEpub;
  }

  private static nativePageWidth(scaledWidth: number): number {
    return Math.round((scaledWidth / PDF2HTML_NATIVE_SCALE) * 100) / 100;
  }

  private static nativePageHeight(scaledHeight: number): number {
    return Math.round((scaledHeight / PDF2HTML_NATIVE_SCALE) * 100) / 100;
  }

  private static async copyPdf2htmlCss(srcDir: string, destDir: string): Promise<string[]> {
    const copied: string[] = [];
    const wanted = ['base.min.css', 'fancy.min.css', 'input.css'];

    for (const name of wanted) {
      const src = path.join(srcDir, name);
      const dest = path.join(destDir, name);
      try {
        let css = await fs.readFile(src, 'utf8');
        if (name === 'input.css') {
          css = css.replace(/url\((f[0-9a-f]+\.woff2?)\)/gi, 'url(../fonts/$1)');
        }
        await fs.writeFile(dest, css, 'utf8');
        copied.push(dest);
      } catch {
        // optional css file
      }
    }

    return copied;
  }

  private static async copyDir(srcDir: string, destDir: string): Promise<string[]> {
    const copied: string[] = [];
    try {
      const entries = await fs.readdir(srcDir);
      for (const name of entries) {
        const src = path.join(srcDir, name);
        const dest = path.join(destDir, name);
        const stat = await fs.stat(src);
        if (stat.isFile()) {
          await fs.copyFile(src, dest);
          copied.push(dest);
        }
      }
    } catch {
      // source dir may not exist
    }
    return copied;
  }

  private static async writeDefaultCss(cssPath: string, fontFiles: string[]): Promise<void> {
    const fontFaceRules = EpubGenerationService.buildFontFaceRules(fontFiles);
    const defaultFontFamily = EpubGenerationService.defaultFontFamily(fontFiles);

    const css = `/* Fixed Layout EPUB styles */
${fontFaceRules}
.fxl-page { margin: 0; padding: 0; overflow: hidden; }
.page-container { position: relative; overflow: hidden; }
.pdf2html-visual { position: relative; width: 100%; height: 100%; }
.pdf2html-visual .pf { margin: 0; }
.t.-epub-media-overlay-active,
.t.smilActive,
.t.readium-smil-active {
  color: #2196F3 !important;
}
`;
    await fs.writeFile(cssPath, css, 'utf8');
  }

  private static buildFontFaceRules(fontFiles: string[]): string {
    return fontFiles
      .map((filePath) => EpubGenerationService.buildFontFaceRule(filePath))
      .filter(Boolean)
      .join('\n');
  }

  private static buildFontFaceRule(filePath: string): string | null {
    const basename = path.basename(filePath);
    const family = EpubGenerationService.fontFamilyFromFile(basename);
    if (!family) return null;

    const format = EpubGenerationService.fontFormatFromFile(basename);
    if (!format) return null;

    return `@font-face{font-family:${family};src:url(../fonts/${basename}) format("${format}");font-style:normal;font-weight:normal;}`;
  }

  private static fontFamilyFromFile(basename: string): string | null {
    const match = /^f([0-9a-f]+)\./i.exec(basename);
    return match ? `ff${match[1].toLowerCase()}` : null;
  }

  private static fontFormatFromFile(basename: string): string | null {
    const ext = path.extname(basename).toLowerCase();
    if (ext === '.woff') return 'woff';
    if (ext === '.woff2') return 'woff2';
    if (ext === '.ttf') return 'truetype';
    if (ext === '.otf') return 'opentype';
    return null;
  }

  private static defaultFontFamily(fontFiles: string[]): string {
    const first = fontFiles
      .map((filePath) => EpubGenerationService.fontFamilyFromFile(path.basename(filePath)))
      .find(Boolean);
    return first ? `${first}, sans-serif` : 'sans-serif';
  }

  private static imageMediaType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    return 'image/png';
  }

  private static fontMediaType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.woff2') return 'font/woff2';
    if (ext === '.ttf') return 'font/ttf';
    if (ext === '.otf') return 'font/otf';
    return 'application/font-woff';
  }

  private static async writeContainer(epubDir: string): Promise<void> {
    const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    await fs.writeFile(path.join(epubDir, 'mimetype'), 'application/epub+zip');
    await fs.writeFile(path.join(epubDir, 'META-INF', 'container.xml'), container, 'utf8');
  }

  private static async writeOpf(
    epubDir: string,
    meta: {
      title: string;
      author: string;
      language: string;
      xhtmlFiles: string[];
      smilFiles: string[];
      imageFiles: string[];
      fontFiles: string[];
      pageWidth: number;
      pageHeight: number;
      pdf2htmlCssFiles: string[];
    }
  ): Promise<void> {
    const uuid = `urn:uuid:${cryptoRandom()}`;
    const hasSmil = meta.smilFiles.length > 0;

    const manifestItems = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="css" href="css/fxl.css" media-type="text/css"/>',
    ];

    for (let i = 0; i < meta.pdf2htmlCssFiles.length; i++) {
      const href = `css/${path.basename(meta.pdf2htmlCssFiles[i])}`;
      const id = `pdf2css_${i + 1}`;
      manifestItems.push(`<item id="${id}" href="${escapeXml(href)}" media-type="text/css"/>`);
    }

    const spineItems: string[] = [];
    const smilMeta: string[] = [];

    for (let i = 0; i < meta.xhtmlFiles.length; i++) {
      const xhtml = meta.xhtmlFiles[i];
      const id = `page_${i + 1}`;
      manifestItems.push(
        `<item id="${id}" href="${escapeXml(xhtml)}" media-type="application/xhtml+xml"/>`
      );

      if (meta.smilFiles[i]) {
        const smilId = `smil_${i + 1}`;
        manifestItems.push(
          `<item id="${smilId}" href="smil/${escapeXml(meta.smilFiles[i])}" media-type="application/smil+xml"/>`
        );
        spineItems.push(`<itemref idref="${id}" media-overlay="${smilId}"/>`);
        smilMeta.push(`<meta property="media:duration">${(i + 1) * 30}s</meta>`);
      } else {
        spineItems.push(`<itemref idref="${id}"/>`);
      }
    }

    for (let i = 0; i < meta.imageFiles.length; i++) {
      const href = `images/${path.basename(meta.imageFiles[i])}`;
      const mediaType = EpubGenerationService.imageMediaType(meta.imageFiles[i]);
      manifestItems.push(
        `<item id="img_${i + 1}" href="${escapeXml(href)}" media-type="${mediaType}"/>`
      );
    }

    for (let i = 0; i < meta.fontFiles.length; i++) {
      const href = `fonts/${path.basename(meta.fontFiles[i])}`;
      const mediaType = EpubGenerationService.fontMediaType(meta.fontFiles[i]);
      manifestItems.push(
        `<item id="font_${i + 1}" href="${escapeXml(href)}" media-type="${mediaType}"/>`
      );
    }

    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${uuid}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:creator>${escapeXml(meta.author)}</dc:creator>
    <dc:language>${escapeXml(meta.language)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
    <meta property="rendition:viewport">width=${Math.round(meta.pageWidth)},height=${Math.round(meta.pageHeight)}</meta>
    ${hasSmil ? '<meta property="media:active-class">-epub-media-overlay-active</meta>\n    <meta property="media:playback-active-class">-epub-media-overlay-playing</meta>' : ''}
    ${smilMeta.join('\n    ')}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;

    await fs.writeFile(path.join(epubDir, 'content.opf'), opf, 'utf8');
  }

  private static async writeNav(
    epubDir: string,
    pages: Array<{ number: number }>,
    title: string
  ): Promise<void> {
    const navItems = pages
      .map(
        (p) =>
          `        <li><a href="pages/page_${p.number}.xhtml">Page ${p.number}</a></li>`
      )
      .join('\n');

    const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;

    await fs.writeFile(path.join(epubDir, 'nav.xhtml'), nav, 'utf8');
  }

  private static async zipEpub(epubDir: string, outputPath: string): Promise<void> {
    const entries = await collectFiles(epubDir, epubDir);
    const mimetypeBuf = await fs.readFile(path.join(epubDir, 'mimetype'));

    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);

      archive.append(mimetypeBuf, { name: 'mimetype', store: true } as archiver.EntryData);

      for (const rel of entries) {
        if (rel === 'mimetype') continue;
        archive.file(path.join(epubDir, rel), { name: rel.replace(/\\/g, '/') });
      }

      archive.finalize();
    });
  }
}

async function collectFiles(dir: string, base: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full, base)));
    } else {
      results.push(rel);
    }
  }
  return results;
}

function cryptoRandom(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
