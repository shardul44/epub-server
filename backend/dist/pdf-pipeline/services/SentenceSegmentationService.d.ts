import type { HtmlTextElement, SentenceModel, WordModel } from '../types.js';
export declare class SentenceSegmentationService {
    /**
     * One sentence per pdf2htmlEX line (.t element), in reading order.
     * SMIL targets the visible line div via domIndex → id injection.
     */
    static segmentByElements(elements: HtmlTextElement[], words: WordModel[]): SentenceModel[];
    /**
     * Group words into sentences based on punctuation boundaries.
     * Sentence IDs are assigned deterministically from reading order.
     */
    static segment(words: WordModel[]): SentenceModel[];
}
//# sourceMappingURL=SentenceSegmentationService.d.ts.map