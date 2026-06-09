import type { CoordsJson, PageModel, SentenceModel, WordModel } from '../types.js';
export declare class CoordinateService {
    /**
     * Build and persist coords.json with pages, words, and sentences.
     */
    static produce(outputPath: string, pages: PageModel[], words: WordModel[], sentences: SentenceModel[], sourcePdf: string): Promise<CoordsJson>;
    static validate(coords: CoordsJson): void;
    static load(coordsPath: string): Promise<CoordsJson>;
}
//# sourceMappingURL=CoordinateService.d.ts.map