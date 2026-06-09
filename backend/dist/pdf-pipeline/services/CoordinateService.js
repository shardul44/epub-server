import fs from 'fs/promises';
import { createLogger } from '../utils/logger.js';
const log = createLogger('Coordinate');
export class CoordinateService {
    /**
     * Build and persist coords.json with pages, words, and sentences.
     */
    static async produce(outputPath, pages, words, sentences, sourcePdf) {
        const coords = {
            pages: pages.map((p) => ({
                number: p.number,
                width: p.width,
                height: p.height,
                fileName: p.fileName,
            })),
            words: words.map((w) => ({
                id: w.id,
                text: w.text,
                page: w.page,
                x: Math.round(w.x * 100) / 100,
                y: Math.round(w.y * 100) / 100,
                width: Math.round(w.width * 100) / 100,
                height: Math.round(w.height * 100) / 100,
                ...(w.fontSize != null
                    ? { fontSize: Math.round(w.fontSize * 100) / 100 }
                    : {}),
                ...(w.fontFamily ? { fontFamily: w.fontFamily } : {}),
            })),
            sentences: sentences.map((s, index) => ({
                id: s.id,
                text: s.text,
                words: [...s.words],
                page: s.page,
                readingOrder: index + 1,
                ...(s.domIndex != null ? { domIndex: s.domIndex } : {}),
            })),
            metadata: {
                generatedAt: new Date().toISOString(),
                sourcePdf,
                totalPages: pages.length,
                idScheme: 'sequential-stable-v1',
            },
        };
        CoordinateService.validate(coords);
        await fs.writeFile(outputPath, JSON.stringify(coords, null, 2), 'utf8');
        log.info('coords.json written', {
            path: outputPath,
            pages: coords.pages.length,
            words: coords.words.length,
            sentences: coords.sentences.length,
        });
        return coords;
    }
    static validate(coords) {
        if (!Array.isArray(coords.pages))
            throw new Error('coords.pages must be an array');
        if (!Array.isArray(coords.words))
            throw new Error('coords.words must be an array');
        if (!Array.isArray(coords.sentences))
            throw new Error('coords.sentences must be an array');
        const wordIds = new Set();
        for (const word of coords.words) {
            if (!word.id?.startsWith('word_')) {
                throw new Error(`Invalid word id: ${word.id}`);
            }
            if (wordIds.has(word.id)) {
                throw new Error(`Duplicate word id: ${word.id}`);
            }
            wordIds.add(word.id);
        }
        const sentenceIds = new Set();
        for (const sentence of coords.sentences) {
            if (!sentence.id?.startsWith('sentence_')) {
                throw new Error(`Invalid sentence id: ${sentence.id}`);
            }
            if (sentenceIds.has(sentence.id)) {
                throw new Error(`Duplicate sentence id: ${sentence.id}`);
            }
            sentenceIds.add(sentence.id);
            for (const wordId of sentence.words) {
                if (!wordIds.has(wordId)) {
                    throw new Error(`Sentence ${sentence.id} references unknown word ${wordId}`);
                }
            }
        }
    }
    static async load(coordsPath) {
        const raw = await fs.readFile(coordsPath, 'utf8');
        const coords = JSON.parse(raw);
        CoordinateService.validate(coords);
        return coords;
    }
}
//# sourceMappingURL=CoordinateService.js.map