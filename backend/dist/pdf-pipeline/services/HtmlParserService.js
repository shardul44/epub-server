import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger.js';
const log = createLogger('HtmlParser');
const PT_TO_PX = 96 / 72;
/**
 * Parse a CSS matrix() value into [a, b, c, d] components.
 * matrix(a, b, c, d, e, f) where:
 *   a = horizontal scale, b = horizontal skew (rotation)
 *   c = vertical skew (rotation), d = vertical scale
 * Normal upright text: matrix(sx, 0, 0, sy, ...) — scaleX=sx, scaleY=sy
 * 90° rotated text:    matrix(0, sy, -sx, 0, ...) — axes are swapped
 */
function parseMatrix(css) {
    const m = /matrix\s*\(\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)\s*,\s*([\d.e+-]+)/.exec(css);
    if (!m)
        return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
}
/**
 * Returns true if the matrix represents a rotation (non-standard orientation).
 * pdf2htmlEX uses matrix(0, sy, -sx, 0) for 90° CCW rotated text.
 */
function isRotatedMatrix(mat) {
    // Rotated if the diagonal elements (a, d) are both near zero
    return Math.abs(mat[0]) < 0.01 && Math.abs(mat[3]) < 0.01;
}
export class HtmlParserService {
    /**
     * Parse all HTML files produced by pdf2htmlEX and extract positioned text elements.
     */
    static async parseHtmlFiles(htmlFiles, cssFiles) {
        const cssMap = await HtmlParserService.parseCssFiles(cssFiles);
        const allElements = [];
        const pages = [];
        for (let i = 0; i < htmlFiles.length; i++) {
            const htmlPath = htmlFiles[i];
            const html = await fs.readFile(htmlPath, 'utf8');
            const pageNumber = HtmlParserService.inferPageNumber(htmlPath, html, i + 1);
            const { elements, width, height } = HtmlParserService.parseSingleHtml(html, pageNumber, cssMap);
            allElements.push(...elements);
            pages.push({ number: pageNumber, width, height });
        }
        log.info('Parsed HTML files', { files: htmlFiles.length, elements: allElements.length });
        return { elements: allElements, pages };
    }
    static inferPageNumber(htmlPath, html, fallback) {
        const baseMatch = /page[_-]?(\d+)/i.exec(path.basename(htmlPath));
        if (baseMatch)
            return parseInt(baseMatch[1], 10);
        // pdf2htmlEX split-page files: inputN.page — extract N directly
        const pageFileMatch = /input(\d+)\.page$/i.exec(path.basename(htmlPath));
        if (pageFileMatch)
            return parseInt(pageFileMatch[1], 10);
        // pdf2htmlEX uses hex for data-page-no (1 = "1", 10 = "a", 16 = "10")
        const dataMatch = /data-page-no=["']([0-9a-f]+)["']/i.exec(html);
        if (dataMatch)
            return parseInt(dataMatch[1], 16);
        const idMatch = /id=["']pf([0-9a-f]+)["']/i.exec(html);
        if (idMatch)
            return parseInt(idMatch[1], 16);
        return fallback;
    }
    static parseSingleHtml(html, pageNumber, cssMap) {
        const $ = cheerio.load(html);
        const elements = [];
        let pageWidth = 612;
        let pageHeight = 792;
        // Determine page scale from the page frame's matrix class, or default to 0.25
        // pdf2htmlEX encodes all positions at (1/scaleY) × actual size.
        // The page frame itself uses m1 implicitly; we read scale from the CSS map.
        // Default scale is 0.25 (used by all known pdf2htmlEX builds).
        const defaultScale = 0.25;
        const pageFrame = $('.pf, [data-page-no], #page-container').first();
        if (pageFrame.length) {
            const wClass = HtmlParserService.extractClass(pageFrame, 'w');
            const hClass = HtmlParserService.extractClass(pageFrame, 'h');
            if (wClass && cssMap.w.has(wClass))
                pageWidth = cssMap.w.get(wClass) * defaultScale;
            if (hClass && cssMap.h.has(hClass))
                pageHeight = cssMap.h.get(hClass) * defaultScale;
        }
        // pdf2htmlEX line boxes: one div.t per text line (domIndex matches .page HTML order)
        let tDomIndex = 0;
        $('.t').each((_, el) => {
            const node = $(el);
            const text = node.text().replace(/\s+/g, ' ').trim();
            if (!text)
                return;
            const classes = (node.attr('class') || '').split(/\s+/).filter(Boolean);
            // Find the matrix class for this element (m0, m1, m2, ...)
            const matClass = classes.find(c => /^m\d+$/.test(c));
            const mat = matClass ? cssMap.m.get(matClass) : null;
            // Skip rotated/transformed text (m0 = 90° rotation) — these are decorative
            // vertical labels that can't be placed correctly in a flat text layer.
            if (mat && isRotatedMatrix(mat))
                return;
            // Determine the vertical scale for this element.
            // mat[3] = d component of matrix(a,b,c,d,...) = vertical scale factor.
            // All known values are ~0.25 (m1=0.25, m2=0.245, m3=0.2425).
            const scaleY = mat ? Math.abs(mat[3]) : defaultScale;
            const scaleX = mat ? Math.abs(mat[0]) : defaultScale;
            const pos = HtmlParserService.resolvePosition(classes, cssMap);
            if (!pos)
                return;
            // pdf2htmlEX encodes y as 'bottom' (distance from bottom of page) at CSS scale.
            // Multiply by scaleY to get actual pt coordinates, then flip to top-down.
            const scaledX = pos.x * scaleX;
            const scaledBottom = pos.y * scaleY;
            const scaledWidth = pos.width * scaleX;
            const scaledHeight = pos.height * scaleY;
            const scaledFontSize = pos.fontSize !== undefined ? pos.fontSize * scaleY : undefined;
            const top = pageHeight - scaledBottom - scaledHeight;
            const fontFamily = HtmlParserService.resolveFontFamily(classes);
            elements.push({
                text,
                page: pageNumber,
                x: scaledX,
                y: top,
                width: scaledWidth,
                height: scaledHeight,
                fontSize: scaledFontSize,
                fontFamily,
                elementId: node.attr('id') || undefined,
                rawClasses: classes.join(' '),
                domIndex: tDomIndex++,
            });
        });
        // Fallback: any element with inline style positioning
        if (elements.length === 0) {
            $('[style*="left"], [style*="top"], [style*="bottom"]').each((_, el) => {
                const node = $(el);
                const text = node.text().replace(/\s+/g, ' ').trim();
                if (!text || text.length > 500)
                    return;
                const style = node.attr('style') || '';
                const left = HtmlParserService.parseStylePx(style, 'left');
                const top = HtmlParserService.parseStylePx(style, 'top');
                const bottom = HtmlParserService.parseStylePx(style, 'bottom');
                const width = HtmlParserService.parseStylePx(style, 'width') || text.length * 8;
                const height = HtmlParserService.parseStylePx(style, 'height') || 16;
                // output.html inline styles are at display scale — multiply by defaultScale
                // to match the coordinate space of the .page files
                const scaledLeft = (left ?? 0) * defaultScale;
                const scaledWidth = width * defaultScale;
                const scaledHeight = height * defaultScale;
                const scaledBottom = bottom !== null ? bottom * defaultScale : null;
                const scaledTop = top !== null ? top * defaultScale : null;
                const y = scaledTop ?? (scaledBottom !== null ? pageHeight - scaledBottom - scaledHeight : 0);
                elements.push({
                    text,
                    page: pageNumber,
                    x: scaledLeft,
                    y,
                    width: scaledWidth,
                    height: scaledHeight,
                    elementId: node.attr('id') || undefined,
                });
            });
        }
        return { elements, width: pageWidth, height: pageHeight };
    }
    static resolveFontFamily(classes) {
        const ffClass = classes.find((cls) => /^ff[0-9a-f]+$/i.test(cls));
        return ffClass ? ffClass.toLowerCase() : undefined;
    }
    static extractClass(node, prefix) {
        const classes = (node.attr('class') || '').split(/\s+/);
        const match = classes.find((c) => c.startsWith(prefix) && /^[a-z]?\d+$/i.test(c));
        return match || null;
    }
    static resolvePosition(classes, cssMap) {
        let x = 0;
        let y = 0;
        let width = 0;
        let height = 14;
        let fontSize;
        let hasPosition = false;
        for (const cls of classes) {
            if (cssMap.x.has(cls)) {
                x = cssMap.x.get(cls);
                hasPosition = true;
            }
            if (cssMap.y.has(cls)) {
                y = cssMap.y.get(cls);
                hasPosition = true;
            }
            if (cssMap.w.has(cls))
                width = cssMap.w.get(cls);
            if (cssMap.h.has(cls))
                height = cssMap.h.get(cls);
            if (cssMap.fs.has(cls))
                fontSize = cssMap.fs.get(cls);
        }
        if (!hasPosition)
            return null;
        if (width <= 0)
            width = Math.max(20, (fontSize || 12) * 3);
        return { x, y, width, height, fontSize };
    }
    static parseStylePx(style, prop) {
        const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+)(px|pt)?`, 'i');
        const m = re.exec(style);
        if (!m)
            return null;
        const val = parseFloat(m[1]);
        return m[2]?.toLowerCase() === 'pt' ? val * PT_TO_PX : val;
    }
    static async parseCssFiles(cssFiles) {
        const map = {
            x: new Map(),
            y: new Map(),
            w: new Map(),
            h: new Map(),
            fs: new Map(),
            m: new Map(),
        };
        for (const cssPath of cssFiles) {
            const css = await fs.readFile(cssPath, 'utf8');
            HtmlParserService.parseCssContent(css, map);
        }
        return map;
    }
    static parseCssContent(css, map) {
        const ruleRe = /\.([a-zA-Z_][\w-]*)\s*\{([^}]+)\}/g;
        let match;
        while ((match = ruleRe.exec(css)) !== null) {
            const className = match[1];
            const body = match[2];
            const left = HtmlParserService.parseCssValue(body, 'left');
            const bottom = HtmlParserService.parseCssValue(body, 'bottom');
            const top = HtmlParserService.parseCssValue(body, 'top');
            const width = HtmlParserService.parseCssValue(body, 'width');
            const height = HtmlParserService.parseCssValue(body, 'height');
            const fontSize = HtmlParserService.parseCssValue(body, 'font-size');
            if (left !== null && className.startsWith('x'))
                map.x.set(className, left);
            if (bottom !== null && className.startsWith('y'))
                map.y.set(className, bottom);
            if (top !== null && className.startsWith('y'))
                map.y.set(className, top);
            if (width !== null && className.startsWith('w'))
                map.w.set(className, width);
            if (height !== null && className.startsWith('h'))
                map.h.set(className, height);
            if (fontSize !== null && className.startsWith('fs'))
                map.fs.set(className, fontSize);
            // Capture matrix transform classes (m0, m1, m2, ...)
            if (className.startsWith('m') && /^m\d+$/.test(className)) {
                const mat = parseMatrix(body);
                if (mat)
                    map.m.set(className, mat);
            }
        }
    }
    static parseCssValue(body, prop) {
        const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+)(px|pt)?`, 'i');
        const m = re.exec(body);
        if (!m)
            return null;
        const val = parseFloat(m[1]);
        const unit = m[2]?.toLowerCase();
        if (unit === 'pt')
            return val * PT_TO_PX;
        return val;
    }
}
//# sourceMappingURL=HtmlParserService.js.map