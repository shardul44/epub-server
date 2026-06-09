import { assignStableWordIds, buildStableWordKey } from '../utils/stableId.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('WordSegmentation');
export class WordSegmentationService {
    /**
     * Segment positioned text elements into individual words with stable IDs.
     * Multi-word elements are split with proportional bounding boxes.
     */
    static segment(elements) {
        const rawWords = [];
        for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
            const el = elements[elementIndex];
            const tokens = WordSegmentationService.tokenize(el.text);
            if (tokens.length === 0)
                continue;
            if (tokens.length === 1) {
                rawWords.push({
                    text: tokens[0],
                    page: el.page,
                    x: el.x,
                    y: el.y,
                    width: el.width,
                    height: el.height,
                    fontSize: el.fontSize,
                    fontFamily: el.fontFamily,
                    elementIndex,
                    stableKey: buildStableWordKey(el.page, el.x, el.y, tokens[0]),
                });
                continue;
            }
            // Proportional width split for multi-word text blocks
            const totalChars = tokens.reduce((sum, t) => sum + t.length, 0);
            let cursorX = el.x;
            for (const token of tokens) {
                const ratio = token.length / totalChars;
                const wordWidth = Math.max(el.width * ratio, token.length * 6);
                rawWords.push({
                    text: token,
                    page: el.page,
                    x: cursorX,
                    y: el.y,
                    width: wordWidth,
                    height: el.height,
                    fontSize: el.fontSize,
                    fontFamily: el.fontFamily,
                    elementIndex,
                    stableKey: buildStableWordKey(el.page, cursorX, el.y, token),
                });
                cursorX += wordWidth;
            }
        }
        const words = assignStableWordIds(rawWords);
        log.info('Word segmentation complete', { words: words.length });
        return words;
    }
    static tokenize(text) {
        return text
            .replace(/\u00a0/g, ' ')
            .split(/(\s+|[^\s\w'-]+)/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && !/^\s+$/.test(t));
    }
}
//# sourceMappingURL=WordSegmentationService.js.map