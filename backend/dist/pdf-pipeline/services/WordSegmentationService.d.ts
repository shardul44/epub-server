import type { HtmlTextElement, WordModel } from '../types.js';
export declare class WordSegmentationService {
    /**
     * Segment positioned text elements into individual words with stable IDs.
     * Multi-word elements are split with proportional bounding boxes.
     */
    static segment(elements: HtmlTextElement[]): WordModel[];
    private static tokenize;
}
//# sourceMappingURL=WordSegmentationService.d.ts.map