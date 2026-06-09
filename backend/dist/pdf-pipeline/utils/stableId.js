import crypto from 'crypto';
/** Normalize text for stable comparison across conversions. */
export function normalizeText(text) {
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
/**
 * Deterministic key for a word based on page + position + text.
 * Same PDF content at same position yields the same key across regenerations.
 */
export function buildStableWordKey(page, x, y, text) {
    const payload = [
        page,
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        normalizeText(text),
    ].join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
/** Format sequential ID with zero padding: word_000001 */
export function formatSequentialId(prefix, index) {
    return `${prefix}_${String(index).padStart(6, '0')}`;
}
/**
 * Assign stable sequential word IDs based on deterministic reading-order sort.
 * Words with existing stable keys keep consistent ordering.
 */
export function assignStableWordIds(words) {
    const sorted = [...words].sort((a, b) => {
        if (a.page !== b.page)
            return a.page - b.page;
        if (Math.abs(a.y - b.y) > 2)
            return a.y - b.y;
        if (Math.abs(a.x - b.x) > 2)
            return a.x - b.x;
        const keyA = a.stableKey ?? buildStableWordKey(a.page, a.x, a.y, a.text);
        const keyB = b.stableKey ?? buildStableWordKey(b.page, b.x, b.y, b.text);
        return keyA.localeCompare(keyB);
    });
    return sorted.map((word, index) => ({
        ...word,
        id: formatSequentialId('word', index + 1),
        stableKey: word.stableKey ?? buildStableWordKey(word.page, word.x, word.y, word.text),
    }));
}
export function assignStableSentenceIds(sentences) {
    return sentences.map((sentence, index) => ({
        ...sentence,
        id: formatSequentialId('sentence', index + 1),
    }));
}
//# sourceMappingURL=stableId.js.map