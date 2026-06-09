import type { ConversionOptions, CoordsJson } from '../types.js';
export declare class PdfConversionService {
    /**
     * Full pipeline: PDF → pdf2htmlEX → reading order → words → sentences → coords.json → EPUB + SMIL
     */
    static convert(jobId: string, options?: ConversionOptions): Promise<{
        coords: CoordsJson;
        epubPath: string;
    }>;
    static initializeJob(jobId: string, sourcePdfPath: string): Promise<string>;
}
//# sourceMappingURL=PdfConversionService.d.ts.map