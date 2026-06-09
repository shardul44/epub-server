import type { WordModel } from '../types.js';
/** Normalize text for stable comparison across conversions. */
export declare function normalizeText(text: string): string;
/**
 * Deterministic key for a word based on page + position + text.
 * Same PDF content at same position yields the same key across regenerations.
 */
export declare function buildStableWordKey(page: number, x: number, y: number, text: string): string;
/** Format sequential ID with zero padding: word_000001 */
export declare function formatSequentialId(prefix: 'word' | 'sentence', index: number): string;
/**
 * Assign stable sequential word IDs based on deterministic reading-order sort.
 * Words with existing stable keys keep consistent ordering.
 */
export declare function assignStableWordIds(words: Omit<WordModel, 'id'>[]): WordModel[];
export declare function assignStableSentenceIds(sentences: Array<{
    text: string;
    words: string[];
    page: number;
    domIndex?: number;
}>): Array<{
    id: string;
    text: string;
    words: string[];
    page: number;
    domIndex?: number;
}>;
//# sourceMappingURL=stableId.d.ts.map