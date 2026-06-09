import type { HtmlTextElement } from '../types.js';
export declare class HtmlParserService {
    /**
     * Parse all HTML files produced by pdf2htmlEX and extract positioned text elements.
     */
    static parseHtmlFiles(htmlFiles: string[], cssFiles: string[]): Promise<{
        elements: HtmlTextElement[];
        pages: Array<{
            number: number;
            width: number;
            height: number;
        }>;
    }>;
    private static inferPageNumber;
    private static parseSingleHtml;
    private static resolveFontFamily;
    private static extractClass;
    private static resolvePosition;
    private static parseStylePx;
    private static parseCssFiles;
    private static parseCssContent;
    private static parseCssValue;
}
//# sourceMappingURL=HtmlParserService.d.ts.map