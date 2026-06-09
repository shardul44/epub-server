import type { CoordsJson, HtmlTextElement } from '../types.js';
/** pdf2htmlEX internal scale factor (m1 matrix); native page coords are 1/scale of viewport. */
export declare const PDF2HTML_NATIVE_SCALE = 0.25;
export declare class XhtmlGenerationService {
    /**
     * Generate FXL XHTML pages: native pdf2htmlEX HTML with sentence ids on each .t line.
     */
    static generatePages(epubDir: string, coords: CoordsJson, _imageFiles?: string[], _elements?: HtmlTextElement[], htmlPageFiles?: string[]): Promise<string[]>;
    private static buildPageXhtml;
}
//# sourceMappingURL=XhtmlGenerationService.d.ts.map