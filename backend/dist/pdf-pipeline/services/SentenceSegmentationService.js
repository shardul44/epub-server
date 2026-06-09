import { assignStableSentenceIds } from '../utils/stableId.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('SentenceSegmentation');
const SENTENCE_END_RE = /[.!?]+(?:\s|$)/;
export class SentenceSegmentationService {
    /**
     * One sentence per pdf2htmlEX line (.t element), in reading order.
     * SMIL targets the visible line div via domIndex → id injection.
     */
    static segmentByElements(elements, words) {
        const wordsByElement = new Map();
        for (const word of words) {
            const idx = word.elementIndex ?? 0;
            if (!wordsByElement.has(idx))
                wordsByElement.set(idx, []);
            wordsByElement.get(idx).push(word);
        }
        const rawSentences = [];
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const elWords = wordsByElement.get(i) ?? [];
            if (elWords.length === 0)
                continue;
            rawSentences.push({
                text: el.text,
                words: elWords.map((w) => w.id),
                page: el.page,
                domIndex: el.domIndex,
            });
        }
        const sentences = assignStableSentenceIds(rawSentences);
        log.info('Line-level sentence segmentation complete', { sentences: sentences.length });
        return sentences;
    }
    /**
     * Group words into sentences based on punctuation boundaries.
     * Sentence IDs are assigned deterministically from reading order.
     */
    static segment(words) {
        if (words.length === 0)
            return [];
        const rawSentences = [];
        let currentWords = [];
        const flush = () => {
            if (currentWords.length === 0)
                return;
            const text = currentWords.map((w) => w.text).join(' ').replace(/\s+([.!?,;:])/g, '$1');
            rawSentences.push({
                text,
                words: currentWords.map((w) => w.id),
                page: currentWords[0].page,
            });
            currentWords = [];
        };
        for (const word of words) {
            const prev = currentWords[currentWords.length - 1];
            if (prev) {
                const pageChanged = prev.page !== word.page;
                const lineBreak = Math.abs(word.y - prev.y) > Math.max(prev.height, word.height, 8) * 1.25;
                if (pageChanged || lineBreak) {
                    flush();
                }
            }
            currentWords.push(word);
            if (SENTENCE_END_RE.test(word.text)) {
                flush();
            }
        }
        flush();
        const sentences = assignStableSentenceIds(rawSentences);
        log.info('Sentence segmentation complete', { sentences: sentences.length });
        return sentences;
    }
}
//# sourceMappingURL=SentenceSegmentationService.js.map