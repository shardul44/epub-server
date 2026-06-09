import type { CoordsJson, ConversionOptions, HtmlTextElement } from '../types.js';
export declare class EpubGenerationService {
    /**
     * Assemble EPUB 3 Fixed Layout package with OPF, NAV, pages, CSS, fonts, images, SMIL.
     */
    static generate(layout: {
        epub: string;
        smil: string;
        css: string;
        images: string;
        fonts: string;
        outputEpub: string;
    }, coords: CoordsJson, options?: ConversionOptions, elements?: HtmlTextElement[], htmlPageFiles?: string[]): Promise<string>;
    private static nativePageWidth;
    private static nativePageHeight;
    private static copyPdf2htmlCss;
    private static copyDir;
    private static writeDefaultCss;
    private static buildFontFaceRules;
    private static buildFontFaceRule;
    private static fontFamilyFromFile;
    private static fontFormatFromFile;
    private static defaultFontFamily;
    private static imageMediaType;
    private static fontMediaType;
    private static writeContainer;
    private static writeOpf;
    private static writeNav;
    private static zipEpub;
}
//# sourceMappingURL=EpubGenerationService.d.ts.map