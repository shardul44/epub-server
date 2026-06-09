import type { HtmlTextElement } from '../types.js';
export interface ReadingOrderOptions {
    lineTolerance?: number;
    columnGapThreshold?: number;
}
/**
 * Reconstruct reading order from positioned text elements.
 * Supports single-column, two-column, and magazine (multi-column) layouts.
 *
 * Sort strategy:
 * 1. Group by page
 * 2. Detect columns via X-position clustering
 * 3. Within each column, sort by Y (top), then X (left)
 * 4. Read columns left-to-right
 */
export declare class ReadingOrderService {
    static reconstruct(elements: HtmlTextElement[], options?: ReadingOrderOptions): HtmlTextElement[];
    /**
     * Detect columns by clustering elements on left-edge X.
     * Uses fixed-boundary bands (not running mean) so tightly-spaced columns like
     * Sotheby's catalog pages (3 columns ~36px apart) don't merge due to mean drift.
     */
    private static detectColumns;
    /**
     * Sort elements within a column: group into lines by Y proximity, then sort lines top-to-bottom.
     */
    private static sortWithinColumn;
}
//# sourceMappingURL=ReadingOrderService.d.ts.map