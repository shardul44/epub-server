import type { HtmlTextElement } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ReadingOrder');

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
export class ReadingOrderService {
  static reconstruct(
    elements: HtmlTextElement[],
    options: ReadingOrderOptions = {}
  ): HtmlTextElement[] {
    const lineTolerance = options.lineTolerance ?? 8;
    // Catalog pages (e.g. Sotheby's) have text columns ~36px apart at pdf2htmlEX scale;
    // threshold 40 merges UNIQUE COLLECTIONS + SPECIALISTS + ENQUIRIES into one column.
    const columnGapThreshold = options.columnGapThreshold ?? 28;

    const byPage = new Map<number, HtmlTextElement[]>();
    for (const el of elements) {
      if (!byPage.has(el.page)) byPage.set(el.page, []);
      byPage.get(el.page)!.push(el);
    }

    const ordered: HtmlTextElement[] = [];
    const pageNumbers = [...byPage.keys()].sort((a, b) => a - b);

    for (const page of pageNumbers) {
      const pageElements = byPage.get(page)!;
      const columns = ReadingOrderService.detectColumns(pageElements, columnGapThreshold);

      for (const column of columns) {
        const sorted = ReadingOrderService.sortWithinColumn(column, lineTolerance);
        ordered.push(...sorted);
      }
    }

    log.info('Reading order reconstructed', {
      input: elements.length,
      output: ordered.length,
      pages: pageNumbers.length,
    });

    return ordered;
  }

  /**
   * Detect columns by clustering elements on left-edge X.
   * Uses fixed-boundary bands (not running mean) so tightly-spaced columns like
   * Sotheby's catalog pages (3 columns ~36px apart) don't merge due to mean drift.
   */
  private static detectColumns(
    elements: HtmlTextElement[],
    gapThreshold: number
  ): HtmlTextElement[][] {
    if (elements.length <= 1) return [elements];

    // Sort by X so we scan left-to-right
    const sorted = [...elements].sort((a, b) => a.x - b.x || a.y - b.y);

    // Build bands using min/max boundaries, not running mean.
    // A band extends from its leftmost element's X to (leftmost + gapThreshold).
    // New element joins the band whose range it falls within; otherwise starts a new band.
    const bands: { min: number; max: number; elements: HtmlTextElement[] }[] = [];

    for (const el of sorted) {
      const existing = bands.find((b) => el.x >= b.min - gapThreshold && el.x <= b.max + gapThreshold);
      if (existing) {
        existing.elements.push(el);
        existing.min = Math.min(existing.min, el.x);
        existing.max = Math.max(existing.max, el.x);
      } else {
        bands.push({ min: el.x, max: el.x, elements: [el] });
      }
    }

    // Sort bands left-to-right by their minimum X
    bands.sort((a, b) => a.min - b.min);

    return bands.filter((b) => b.elements.length > 0).map((b) => b.elements);
  }

  /**
   * Sort elements within a column: group into lines by Y proximity, then sort lines top-to-bottom.
   */
  private static sortWithinColumn(
    elements: HtmlTextElement[],
    lineTolerance: number
  ): HtmlTextElement[] {
    const sorted = [...elements].sort((a, b) => {
      if (Math.abs(a.y - b.y) > lineTolerance) return a.y - b.y;
      return a.x - b.x;
    });

    // Line grouping for magazine layouts with overlapping Y bands
    const lines: HtmlTextElement[][] = [];
    for (const el of sorted) {
      const line = lines.find(
        (ln) => ln.length > 0 && Math.abs(ln[0].y - el.y) <= lineTolerance
      );
      if (line) {
        line.push(el);
      } else {
        lines.push([el]);
      }
    }

    lines.sort((a, b) => a[0].y - b[0].y);

    const result: HtmlTextElement[] = [];
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      result.push(...line);
    }

    return result;
  }
}
