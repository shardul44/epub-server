import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import fse from 'fs-extra';
import { getPdfjsLib, buildPdfDocumentOptions } from '../utils/pdfjsHelper.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * pdf-poppler has been removed from this project due to Linux compatibility issues.
 * Keep this helper to preserve the existing fallback flow to pdf-lib.
 */
async function getPdfPoppler() {
  return null;
}

/**
 * Service for extracting text and images from PDF files
 * Replicates epub_app approach: extracts text with coordinates and renders pages as images
 */
export class PdfExtractionService {
  /**
   * Extract text content from PDF with coordinates (like epub_app)
   * @param {string} pdfFilePath - Path to the PDF file
   * @returns {Promise<Object>} Object with pages array containing text blocks with coordinates
   */
  static async extractText(pdfFilePath) {
    try {
      const pdfjsLib = await getPdfjsLib();
      const dataBuffer = await fs.readFile(pdfFilePath);
      // Convert Node.js Buffer to Uint8Array (required by pdfjs-dist)
      const uint8Array = new Uint8Array(dataBuffer);
      const loadingTask = pdfjsLib.getDocument(buildPdfDocumentOptions(uint8Array));

      const pdfDoc = await loadingTask.promise;

      // Ensure document is fully loaded
      const totalPages = pdfDoc.numPages;

      if (!totalPages || totalPages === 0) {
        throw new Error('PDF has no pages or failed to load');
      }

      console.log(`[PDF] Loaded document with ${totalPages} pages`);

      const pages = [];
      let allText = '';

      // Extract text with coordinates from each page
      // pdfjs uses 0-based indexing: page 1 = index 0, page 2 = index 1, etc.
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const pageNum = pageIndex + 1; // 1-based page number for display/storage

        try {
          // Validate page index before accessing
          if (pageIndex < 0 || pageIndex >= totalPages) {
            throw new Error(`Invalid page index: ${pageIndex} (total pages: ${totalPages})`);
          }

          // Get the page - handle page 0 issues (some PDFs have problems with first page)
          let page;
          try {
            page = await pdfDoc.getPage(pageIndex);
          } catch (getPageError) {
            // If page 0 fails, try to get page 1 (index 1) as a fallback
            if (pageIndex === 0 && getPageError.message.includes('Invalid page request')) {
              console.warn(`[Page 1] PDF structure issue - page 0 not accessible, trying page 1 (index 1) as fallback...`);
              try {
                // Try to get page 1 (index 1) instead
                if (totalPages > 1) {
                  page = await pdfDoc.getPage(1);
                  console.log(`[Page 1] Successfully loaded page 1 (index 1) as fallback for page 0`);
                } else {
                  throw getPageError; // If only one page and it fails, throw original error
                }
              } catch (fallbackError) {
                console.warn(`[Page 1] Fallback also failed, skipping invalid page:`, fallbackError.message);
                // Skip invalid pages - don't create blank page
                continue; // Skip to next page
              }
            } else {
              throw getPageError; // Re-throw if it's a different error or not page 0
            }
          }
          const viewport = page.getViewport({ scale: 1.0 });

          // Get text content with positions
          const textContent = await page.getTextContent({ normalizeWhitespace: false });
          const textItems = textContent.items || [];

          // Group text items into blocks based on proximity (like epub_app)
          const textBlocks = this.groupTextItemsIntoBlocks(textItems, viewport, pageNum);

          // Store viewport in blocks for alignment detection
          textBlocks.forEach(block => {
            if (block.boundingBox) {
              block.viewport = viewport;
            }
          });

          // Combine all text for this page
          const pageText = textBlocks.map(block => block.text).join(' ');
          allText += pageText + '\n\n';

          pages.push({
            pageNumber: pageNum,
            text: pageText,
            textBlocks: textBlocks,
            charCount: pageText.length,
            width: viewport.width,
            height: viewport.height
          });
        } catch (pageError) {
          console.error(`[Page ${pageNum}] Error extracting text:`, pageError.message);
          // Continue with next page instead of failing completely
          pages.push({
            pageNumber: pageNum,
            text: '',
            textBlocks: [],
            charCount: 0,
            width: 612, // Default US Letter width
            height: 792 // Default US Letter height
          });
        }
      }

      // Get metadata (fallback to pdf-parse if needed)
      let metadata = {};
      try {
        const pdfData = await pdfParse(dataBuffer);
        metadata = {
          title: pdfData.info?.Title || '',
          author: pdfData.info?.Author || '',
          subject: pdfData.info?.Subject || '',
          creator: pdfData.info?.Creator || '',
          producer: pdfData.info?.Producer || '',
          creationDate: pdfData.info?.CreationDate || null,
          modificationDate: pdfData.info?.ModDate || null
        };
      } catch (metaError) {
        console.warn('Could not extract metadata from PDF:', metaError.message);
      }

      return {
        pages,
        totalPages,
        metadata
      };
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * execute Python script for high-fidelity PDF processing.
   * Parses structured JSON errors from stderr for better diagnostics.
   */
  static async runPythonProcessor(args) {
    const pythonScript = path.resolve(__dirname, '../../scripts/pdf_processor.py');

    // Select interpreter by platform:
    // - Windows virtualenv: venv/Scripts/python.exe
    // - Linux/macOS virtualenv: venv/bin/python
    // - Fallback: python3, then python
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? path.resolve(__dirname, '../../venv/Scripts/python.exe')
      : path.resolve(__dirname, '../../venv/bin/python');

    const hasVenvPython = await fs.stat(venvPython).then(() => true).catch(() => false);
    let pythonCmd = hasVenvPython ? venvPython : (isWindows ? 'python' : 'python3');

    const cmd = `"${pythonCmd}" "${pythonScript}" ${args.join(' ')}`;
    console.log(`[PdfExtractionService] Running High-Fidelity processor: ${cmd}`);

    const _parseStructuredError = (stderr) => {
      // Python script may emit a JSON error object on stderr
      if (!stderr) return null;
      const lines = stderr.trim().split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed && parsed.error) return parsed.error;
        } catch (_) { /* not JSON */ }
      }
      return null;
    };

    const _buildError = (rawError, stderr) => {
      const structured = _parseStructuredError(stderr);
      if (structured) {
        const msg = structured.message || rawError.message;
        const code = structured.code || 'PYTHON_ERROR';
        const err = new Error(`[${code}] ${msg}`);
        err.code = code;
        err.pythonDetails = structured.details || null;
        return err;
      }
      // Check for common missing-module pattern
      const missingModule = (stderr || '').match(/ModuleNotFoundError: No module named '([^']+)'/);
      if (missingModule) {
        const moduleName = missingModule[1];
        const packageMap = { cv2: 'opencv-python-headless', numpy: 'numpy', fitz: 'PyMuPDF', PIL: 'Pillow' };
        const pkg = packageMap[moduleName] || moduleName;
        const err = new Error(
          `[MISSING_DEPENDENCY] Python module '${moduleName}' is not installed. ` +
          `Fix: activate your venv and run: pip install ${pkg}`
        );
        err.code = 'MISSING_DEPENDENCY';
        err.missingModule = moduleName;
        err.installCommand = `pip install ${pkg}`;
        return err;
      }
      return rawError;
    };

    try {
      const { stdout, stderr } = await execAsync(cmd);
      if (stderr) {
        // Warnings from Python (non-fatal) — log but don't throw
        console.warn(`[PdfExtractionService] Python stderr: ${stderr}`);
      }
      return stdout;
    } catch (error) {
      const stderr = error.stderr || '';

      // Linux images sometimes only expose "python" and not "python3"
      if (!isWindows && !hasVenvPython && pythonCmd === 'python3') {
        try {
          pythonCmd = 'python';
          const retryCmd = `"${pythonCmd}" "${pythonScript}" ${args.join(' ')}`;
          console.log(`[PdfExtractionService] Retrying with python: ${retryCmd}`);
          const { stdout, stderr: retryStderr } = await execAsync(retryCmd);
          if (retryStderr) console.warn(`[PdfExtractionService] Python stderr: ${retryStderr}`);
          return stdout;
        } catch (retryError) {
          const enriched = _buildError(retryError, retryError.stderr || '');
          console.error(`[PdfExtractionService] Python execution retry failed: ${enriched.message}`);
          throw enriched;
        }
      }

      const enriched = _buildError(error, stderr);
      console.error(`[PdfExtractionService] Python execution failed: ${enriched.message}`);
      throw enriched;
    }
  }

  /**
   * Phase 1 (New): Render pages using PyMuPDF (faster and better quality than Poppler/Puppeteer)
   * Default DPI reduced to 150 for performance. Use 300 only for pixel-perfect output.
   */
  static async renderPagesHighFidelity(pdfFilePath, outputDir, dpi = 150) {
    try {
      await fs.mkdir(outputDir, { recursive: true });
      await this.runPythonProcessor([
        `--pdf "${pdfFilePath}"`,
        `--output-dir "${outputDir}"`,
        `--mode render`,
        `--dpi ${dpi}`
      ]);

      // Return list of images similar to renderPagesAsImages
      const images = [];
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        if (file.endsWith('.png') && file.startsWith('page_')) {
          const pageNum = parseInt(file.match(/page_(\d+)/)[1]);
          const imgPath = path.join(outputDir, file);
          const metadata = await sharp(imgPath).metadata();
          images.push({
            path: imgPath,
            fileName: file,
            pageNumber: pageNum,
            width: metadata.width,
            height: metadata.height
          });
        }
      }
      return { images: images.sort((a, b) => a.pageNumber - b.pageNumber) };
    } catch (error) {
      console.error('High-Fidelity Render failed:', error);
      throw error;
    }
  }

  /**
   * Phase 2 (New): Extract precise coordinates using PyMuPDF
   * @param {string} pdfFilePath
   * @param {string} outputDir
   * @param {{ extractionLevel?: 'sentence'|'word'|'glyph' }} [options] - sentence (default), word, or glyph
   */
  static async extractCoordinatesHighFidelity(pdfFilePath, outputDir, options = {}) {
    try {
      const levelOpt = options.extractionLevel;
      const extractionLevel = (levelOpt === 'word' || levelOpt === 'glyph') ? levelOpt : 'sentence';
      const jsonPath = path.join(outputDir, 'coords.json');
      await this.runPythonProcessor([
        `--pdf "${pdfFilePath}"`,
        `--output-dir "${outputDir}"`,
        `--mode extract`,
        `--coords-json "${jsonPath}"`,
        `--extraction-level ${extractionLevel}`
      ]);

      if (await fs.stat(jsonPath).catch(() => false)) {
        const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
        // Coords may be array of pages or { pages: [...] }; normalize to array for downstream.
        const pagesArray = Array.isArray(data) ? data : (data?.pages && Array.isArray(data.pages) ? data.pages : []);
        return pagesArray;
      }
      return [];
    } catch (error) {
      console.error('High-Fidelity Extraction failed:', error);
      throw error;
    }
  }

  /**
   * Phase 2b (New): Clean up images (remove text) using OpenCV with contour-based mask.
   * @param {string} pdfFilePath - Path to PDF
   * @param {string} outputDir - Directory with rendered page_*.png and coords
   * @param {string} coordsJsonPath - Path to coords.json
   * @param {Object} [options] - { cleanupThreshold: number (default 10, lower = tighter mask), cleanupDilate: number (default 5, dilation kernel size) }
   */
  static async cleanupImagesHighFidelity(pdfFilePath, outputDir, coordsJsonPath, options = {}) {
    try {
      const args = [
        `--pdf "${pdfFilePath}"`,
        `--output-dir "${outputDir}"`,
        `--mode cleanup`,
        `--coords-json "${coordsJsonPath}"`
      ];
      if (options.cleanupThreshold != null) {
        args.push(`--cleanup-threshold ${Number(options.cleanupThreshold)}`);
      }
      if (options.cleanupDilate != null) {
        args.push(`--cleanup-dilate ${Number(options.cleanupDilate)}`);
      }
      await this.runPythonProcessor(args);
      return true;
    } catch (error) {
      console.error('High-Fidelity Cleanup failed:', error);
      return false;
    }
  }

  /**
   * Extract layout fragments for classic PDF-reconstruction FXL (no AI zoning).
   * Uses PDF text engine coordinates directly: one fragment per span or per word.
   * Coordinates are converted to pixels using scalePixelsPerPoint (default 300/72 for 300 DPI).
   *
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {Object} [options] - { fragmentLevel: 'span'|'word', scalePixelsPerPoint: number }
   * @returns {Promise<{ pages: Array<{ pageNumber: number, width: number, height: number, fragments: Array<{ id: string, text: string, left: number, top: number, width: number, height: number, fontSize: number }> }> }
   */
  static async extractLayoutFragments(pdfFilePath, options = {}) {
    const { fragmentLevel = 'span', scalePixelsPerPoint = 300 / 72 } = options;
    try {
      const pdfjsLib = await getPdfjsLib();
      const dataBuffer = await fs.readFile(pdfFilePath);
      const uint8Array = new Uint8Array(dataBuffer);
      const pdfDoc = await pdfjsLib.getDocument(buildPdfDocumentOptions(uint8Array)).promise;
      const totalPages = pdfDoc.numPages;
      if (!totalPages || totalPages === 0) throw new Error('PDF has no pages');

      const pages = [];
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const pageNum = pageIndex + 1;
        let page;
        try {
          page = await pdfDoc.getPage(pageIndex);
        } catch (e) {
          if (pageIndex === 0 && totalPages > 1) {
            try { page = await pdfDoc.getPage(1); } catch (_) { /* skip */ }
          }
          if (!page) {
            pages.push({ pageNumber: pageNum, width: 612 * scalePixelsPerPoint, height: 792 * scalePixelsPerPoint, fragments: [] });
            continue;
          }
        }
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent({ normalizeWhitespace: false });
        const textItems = (textContent.items || []).filter(item => item.str != null && String(item.str).trim().length > 0);

        // Sort: Y descending (top to bottom), then X ascending (left to right) — reading order
        const sorted = [...textItems].sort((a, b) => {
          const yA = a.transform[5] ?? 0;
          const yB = b.transform[5] ?? 0;
          if (Math.abs(yA - yB) > 1) return yB - yA;
          return (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
        });

        const scale = scalePixelsPerPoint;
        const pageWidthPx = viewport.width * scale;
        const pageHeightPx = viewport.height * scale;

        const fragments = [];
        let tid = 0;
        for (const item of sorted) {
          const x = item.transform[4] ?? 0;
          const y = item.transform[5] ?? 0;
          const w = item.width ?? 0;
          const fontSize = Math.abs(item.transform[0]) || item.height || 12;
          const h = item.height ? Math.max(item.height, fontSize * 1.1) : fontSize * 1.3;
          // PDF: origin bottom-left, y up. CSS: origin top-left, y down.
          const leftPx = x * scale;
          const topPx = (viewport.height - y - h) * scale;

          if (fragmentLevel === 'word') {
            const words = String(item.str).trim().split(/\s+/).filter(Boolean);
            if (words.length === 0) continue;
            const totalChars = words.reduce((s, w) => s + w.length, 0);
            let charOffset = 0;
            for (let wi = 0; wi < words.length; wi++) {
              const word = words[wi];
              const wordChars = word.length;
              const t0 = charOffset / totalChars;
              const t1 = (charOffset + wordChars) / totalChars;
              const segLeft = leftPx + (w * scale) * t0;
              const segWidth = (w * scale) * (t1 - t0);
              tid++;
              fragments.push({
                id: `t${tid}`,
                text: word,
                left: Math.round(segLeft),
                top: Math.round(topPx),
                width: Math.round(segWidth),
                height: Math.round(h * scale),
                fontSize: Math.round(fontSize * scale)
              });
              charOffset += wordChars;
            }
          } else {
            tid++;
            fragments.push({
              id: `t${tid}`,
              text: String(item.str).trim(),
              left: Math.round(leftPx),
              top: Math.round(topPx),
              width: Math.round(w * scale),
              height: Math.round(h * scale),
              fontSize: Math.round(fontSize * scale)
            });
          }
        }

        pages.push({
          pageNumber: pageNum,
          width: Math.round(pageWidthPx),
          height: Math.round(pageHeightPx),
          fragments
        });
      }

      return { pages, totalPages };
    } catch (error) {
      console.error('Error extracting layout fragments from PDF:', error);
      throw new Error(`Failed to extract layout fragments: ${error.message}`);
    }
  }

  /**
   * Group text items into logical blocks based on proximity (replicates epub_app logic)
   */
  static groupTextItemsIntoBlocks(textItems, viewport, pageNumber) {
    if (!textItems || textItems.length === 0) {
      return [];
    }

    // Sort by Y position (top to bottom), then X (left to right)
    // PDF coordinates: Y increases upward from bottom, but we want top-to-bottom reading
    const sortedItems = [...textItems].sort((a, b) => {
      const yDiff = (b.transform[5] || 0) - (a.transform[5] || 0); // Higher Y first
      if (Math.abs(yDiff) > 1) return yDiff;
      return (a.transform[4] || 0) - (b.transform[4] || 0); // Then by X
    });

    const blocks = [];
    let currentBlock = null;

    // Calculate average line height
    const lineHeights = [];
    for (let i = 1; i < sortedItems.length; i++) {
      const y1 = sortedItems[i - 1].transform[5] || 0;
      const y2 = sortedItems[i].transform[5] || 0;
      if (Math.abs(y1 - y2) > 1) {
        lineHeights.push(Math.abs(y1 - y2));
      }
    }
    const avgLineHeight = lineHeights.length > 0
      ? lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length
      : 12.0;

    // Refined thresholds for better block granularity (improves TTS experience)
    // Make thresholds more strict to create more logical blocks
    const verticalThreshold = avgLineHeight * 1.5; // Reduced from 2.0 - tighter vertical grouping
    const horizontalThreshold = Math.max(30, avgLineHeight * 2.5); // Reduced from 3.0 - tighter horizontal grouping
    const maxLineGap = avgLineHeight * 0.6; // Reduced from 0.8 - stricter line detection
    const paragraphBreakThreshold = avgLineHeight * 3.0; // New: larger gap indicates paragraph break

    for (const item of sortedItems) {
      if (!item.str || item.str.trim().length === 0) continue;

      const x = item.transform[4] || 0;
      const y = item.transform[5] || 0;
      const width = item.width || 0;
      // item.height might be font size, but we need actual text height
      // For proper bounding box, use font size * 1.3 to account for ascent (80%) + descent (20%)
      // Large decorative text needs more height coverage
      const fontSize = item.transform[0] || item.height || 12;
      // Use actual item.height if available, otherwise estimate from font size
      // For large text, multiply by 1.3 to ensure full coverage
      const height = item.height ? Math.max(item.height, fontSize * 1.1) : (fontSize * 1.3);

      if (!currentBlock) {
        // Start new block
        currentBlock = {
          id: `block_${pageNumber}_${blocks.length}`,
          text: item.str,
          items: [item],
          minX: x,
          maxX: x + width,
          minY: y,
          maxY: y + height,
          pageNumber: pageNumber
        };
      } else {
        // Check if item belongs to current block
        const lastItem = currentBlock.items[currentBlock.items.length - 1];
        const lastX = lastItem.transform[4] || 0;
        const lastY = lastItem.transform[5] || 0;
        const lastWidth = lastItem.width || 0;

        const verticalDistance = Math.abs(y - lastY);
        const horizontalDistance = x - (lastX + lastWidth);

        // Check for paragraph break (large vertical gap)
        const isParagraphBreak = verticalDistance > paragraphBreakThreshold;

        // Check if on same line
        const sameLine = verticalDistance < maxLineGap && horizontalDistance < horizontalThreshold;

        // Check if same block (same line OR within vertical threshold with similar horizontal alignment)
        // But force break on paragraph gaps
        const sameBlock = !isParagraphBreak && (
          sameLine ||
          (verticalDistance < verticalThreshold &&
            Math.abs(x - currentBlock.minX) < viewport.width * 0.85) // Reduced from 0.9 for stricter alignment
        );

        if (sameBlock) {
          currentBlock.items.push(item);

          // Improved spacing logic: Add space between text items more intelligently
          if (sameLine) {
            // On same line: check if we need a space
            // PDF.js sometimes extracts words separately, so we need to add spaces
            const lastText = currentBlock.text.trim();
            const currentText = item.str.trim();

            // Always add space if there's a horizontal gap (unless it's very small, like kerning)
            // Use a threshold based on font size or a minimum gap
            const fontSize = item.transform[0] || 12;
            const minGapForSpace = Math.max(1, fontSize * 0.15); // ~15% of font size as minimum gap

            if (horizontalDistance > minGapForSpace) {
              // Clear gap - definitely add space
              currentBlock.text += ' ';
            } else if (horizontalDistance > 0) {
              // Small gap - add space unless:
              // 1. Last char is punctuation that shouldn't have space after (.,;:!?)
              // 2. Current char is punctuation that shouldn't have space before (.,;:!?)
              const lastChar = lastText.slice(-1);
              const firstChar = currentText[0];
              const noSpaceAfter = /[.,;:!?]/.test(lastChar);
              const noSpaceBefore = /[.,;:!?)]/.test(firstChar);

              if (!noSpaceAfter && !noSpaceBefore) {
                currentBlock.text += ' ';
              }
            }
            // If horizontalDistance <= 0, items overlap or are adjacent (no space needed)
          } else {
            // Different line: add space for line breaks within same block
            if (verticalDistance > maxLineGap) {
              currentBlock.text += ' ';
            }
          }
          currentBlock.text += item.str;
          currentBlock.minX = Math.min(currentBlock.minX, x);
          currentBlock.maxX = Math.max(currentBlock.maxX, x + width);
          // For Y coordinates in PDF: higher Y = closer to top, lower Y = closer to bottom
          // minY = lowest baseline (bottom-most text), maxY = highest baseline + height (top-most text)
          // Calculate proper height for this item
          const itemFontSize = item.transform[0] || item.height || 12;
          const itemHeight = item.height || (itemFontSize * 1.2); // Full glyph height
          currentBlock.minY = Math.min(currentBlock.minY, y); // Lowest baseline
          // maxY should be the highest point of text (highest baseline + its height)
          // In PDF coords, y is baseline, so top of text is y + height
          currentBlock.maxY = Math.max(currentBlock.maxY, y + itemHeight);
        } else {
          // Finish current block and start new one
          const finishedBlock = this.createTextBlock(currentBlock, viewport);
          finishedBlock.viewport = viewport;

          // 🎯 CRITICAL FIX: Set reading order before pushing
          finishedBlock.readingOrder = blocks.length;

          blocks.push(finishedBlock);
          currentBlock = {
            id: `block_${pageNumber}_${blocks.length}`,
            text: item.str,
            items: [item],
            minX: x,
            maxX: x + width,
            minY: y,
            maxY: y + height,
            pageNumber: pageNumber
          };
        }
      }
    }

    if (currentBlock) {
      const finishedBlock = this.createTextBlock(currentBlock, viewport);
      finishedBlock.viewport = viewport;

      // 🎯 CRITICAL FIX: Set reading order for the final block
      finishedBlock.readingOrder = blocks.length;

      blocks.push(finishedBlock);
    }

    return blocks;
  }

  /**
   * Create a text block object from grouped items
   */
  static createTextBlock(blockData, viewport) {
    // Determine block type (heading, paragraph, etc.)
    const text = blockData.text.trim();
    let type = 'paragraph';
    let level = null;

    // Simple heuristics for heading detection
    if (text.length < 100) {
      if (text.match(/^Chapter \d+/) || text.match(/^\d+\.\s+[A-Z]/)) {
        type = 'heading';
        level = 1;
      } else if (text.match(/^\d+\.\d+\s+/)) {
        type = 'heading';
        level = 2;
      } else if (text === text.toUpperCase() && text.length > 3) {
        type = 'heading';
        level = 2;
      }
    }

    // Get font info from first item
    const firstItem = blockData.items[0];
    const fontSize = firstItem.transform[0] || 12;
    const fontName = firstItem.fontName || 'Unknown';
    const isBold = fontName.toLowerCase().includes('bold');
    const isItalic = fontName.toLowerCase().includes('italic');

    // Extract color information
    let textColor = '#000000'; // Default black
    if (firstItem.color) {
      // PDF.js returns color as [r, g, b] array (0-1 range)
      if (Array.isArray(firstItem.color) && firstItem.color.length >= 3) {
        const r = Math.round(firstItem.color[0] * 255);
        const g = Math.round(firstItem.color[1] * 255);
        const b = Math.round(firstItem.color[2] * 255);
        textColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      } else if (typeof firstItem.color === 'string') {
        textColor = firstItem.color;
      }
    }

    // Extract text alignment (heuristic based on position)
    let textAlign = 'left';
    const blockCenterX = (blockData.minX + blockData.maxX) / 2;
    const viewportWidth = blockData.viewport?.width || 612;
    const leftMargin = viewportWidth * 0.1;
    const rightMargin = viewportWidth * 0.9;

    if (blockData.minX > rightMargin) {
      textAlign = 'right';
    } else if (blockCenterX > viewportWidth * 0.4 && blockCenterX < viewportWidth * 0.6) {
      textAlign = 'center';
    }

    return {
      id: blockData.id,
      text: text,
      type: type,
      level: level,
      boundingBox: {
        x: blockData.minX,
        y: blockData.minY, // Y from bottom of page
        width: blockData.maxX - blockData.minX,
        height: blockData.maxY - blockData.minY,
        pageNumber: blockData.pageNumber
      },
      fontName: fontName,
      fontSize: fontSize,
      isBold: isBold,
      isItalic: isItalic,
      textColor: textColor,
      textAlign: textAlign,
      readingOrder: null // Will be set later
    };
  }

  /**
   * Render PDF pages as images (like epub_app fixed-layout approach)
   * Uses Puppeteer to render PDF pages at 300 DPI (equivalent to Java PDFRenderer)
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save rendered page images
   * @returns {Promise<Array>} Array of image objects with paths and metadata
   */
  static async renderPagesAsImages(pdfFilePath, outputDir) {
    try {
      await fs.mkdir(outputDir, { recursive: true }).catch(() => { });

      // Verify PDF file exists
      await fs.access(pdfFilePath);

      // Get PDF page count using pdf-parse
      const pdfData = await fs.readFile(pdfFilePath);
      const pdfParseResult = await pdfParse(pdfData);
      const totalPages = pdfParseResult.numpages;

      if (totalPages === 0) {
        throw new Error('PDF has no pages');
      }

      console.log(`[PDF] Total pages in PDF: ${totalPages}`);

      // Get page dimensions using pdfjs-dist (just for dimensions, not rendering)
      const pdfjsLib = await getPdfjsLib();
      const uint8Array = new Uint8Array(pdfData);
      let pdfDoc = await pdfjsLib.getDocument(buildPdfDocumentOptions(uint8Array, {
        stopAtErrors: false,
        maxImageSize: 1024 * 1024 * 10,
        isEvalSupported: false,
        disableFontFace: false,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false,
      })).promise;

      let maxWidth = 0;
      let maxHeight = 0;

      // First pass: Get max page dimensions
      // Note: pdfjs uses 0-based indexing for getPage()
      for (let i = 0; i < totalPages; i++) {
        try {
          // pdfjs getPage uses 0-based index
          let pdfPage;
          try {
            pdfPage = await pdfDoc.getPage(i);
          } catch (pageError) {
            // If page 0 fails, try page 1 (index 1) as fallback
            if (i === 0 && pageError.message.includes('Invalid page request') && totalPages > 1) {
              console.warn(`[Page 1] Could not get dimensions: Invalid page request. Trying page 1 (index 1) as fallback...`);
              try {
                pdfPage = await pdfDoc.getPage(1);
              } catch (fallbackError) {
                console.warn(`[Page 1] Fallback also failed:`, fallbackError.message);
                // Use default dimensions if we can't get them
                if (maxWidth === 0) maxWidth = 612; // US Letter width in points
                if (maxHeight === 0) maxHeight = 792; // US Letter height in points
                continue;
              }
            } else {
              console.warn(`[Page ${i + 1}] Could not get dimensions:`, pageError.message);
              // Use default dimensions if we can't get them
              if (maxWidth === 0) maxWidth = 612; // US Letter width in points
              if (maxHeight === 0) maxHeight = 792; // US Letter height in points
              continue;
            }
          }
          const viewport = pdfPage.getViewport({ scale: 1.0 });
          maxWidth = Math.max(maxWidth, viewport.width);
          maxHeight = Math.max(maxHeight, viewport.height);
        } catch (pageError) {
          console.warn(`[Page ${i + 1}] Unexpected error getting dimensions:`, pageError.message);
          // Use default dimensions if we can't get them
          if (maxWidth === 0) maxWidth = 612; // US Letter width in points
          if (maxHeight === 0) maxHeight = 792; // US Letter height in points
        }
      }

      // Don't destroy yet - we'll need it for getting individual page dimensions
      // We'll destroy it after we're done with all rendering

      // Render at 200 DPI to reduce image size for Gemini Vision calls
      const dpi = 200;
      const scale = dpi / 72; // 200 DPI = 200/72 points per pixel
      const maxRenderedWidth = Math.ceil(maxWidth * scale);
      const maxRenderedHeight = Math.ceil(maxHeight * scale);

      // Use Puppeteer with embedded PDF.js to render PDF pages (like Java PDFRenderer)
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const pageImages = [];
      // Convert PDF to base64 for embedding
      const pdfBase64 = Buffer.from(pdfData).toString('base64');

      try {
        // Render each page using PDF.js embedded in HTML
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          try {
            // Get actual page dimensions for this page FIRST (before creating browser page)
            // Handle page 1 (index 0) which might fail
            let pdfPage = null;
            let viewport = null;
            // pdfjs getPage uses 0-based page index
            let actualPageIndex = pageNum - 1;
            let retryCount = 0;
            const maxRetries = 3;

            // Try to get page with retry logic (especially for page 1)
            while (retryCount < maxRetries && !pdfPage) {
              try {
                pdfPage = await pdfDoc.getPage(actualPageIndex);
                viewport = pdfPage.getViewport({ scale: 1.0 });
                break; // Success, exit retry loop
              } catch (pageError) {
                retryCount++;

                // Special handling for page 1 (index 0)
                if (pageNum === 1 && pageError.message.includes('Invalid page request')) {
                  if (retryCount === 1) {
                    // Strategy 1: Wait a bit and retry (sometimes PDF needs time to initialize)
                    console.warn(`[Page 1] Could not get page: Invalid page request. Retrying (attempt ${retryCount}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
                    continue;
                  } else if (retryCount === 2) {
                    // Strategy 2: Try to reload the document and retry
                    console.warn(`[Page 1] Retry failed. Reloading PDF document and retrying...`);
                    try {
                      // Re-read PDF and create new document instance
                      const freshPdfData = await fs.readFile(pdfFilePath);
                      const freshUint8Array = new Uint8Array(freshPdfData);
                      const freshPdfDoc = await pdfjsLib.getDocument(buildPdfDocumentOptions(freshUint8Array, {
                        stopAtErrors: false,
                        maxImageSize: 1024 * 1024 * 10,
                        isEvalSupported: false,
                        disableFontFace: false,
                        disableAutoFetch: false,
                        disableStream: false,
                        disableRange: false,
                      })).promise;
                      pdfPage = await freshPdfDoc.getPage(actualPageIndex);
                      viewport = pdfPage.getViewport({ scale: 1.0 });
                      // Update pdfDoc reference for future use
                      await pdfDoc.destroy().catch(() => { });
                      pdfDoc = freshPdfDoc;
                      console.log(`[Page 1] Successfully loaded after document reload!`);
                      break; // Success
                    } catch (reloadError) {
                      console.warn(`[Page 1] Document reload also failed:`, reloadError.message);
                      // Continue to final fallback
                    }
                  } else {
                    // Strategy 3: Skip this page entirely - don't create blank page
                    console.warn(`[Page ${pageNum}] All retries failed. Skipping invalid page (will not be included in EPUB).`);
                    continue; // Skip to next page - don't render or create blank page
                  }
                } else {
                  // For other pages, just throw the error (will be caught by outer try-catch)
                  throw pageError;
                }
              }
            }

            // If we still don't have a page object after all retries, try rendering anyway via Puppeteer
            // Some PDFs have page 1 that can't be accessed via pdfjs but can still be rendered
            if (!pdfPage || !viewport) {
              console.warn(`[Page ${pageNum}] Could not load page via pdfjs after all retries. Attempting direct Puppeteer render...`);
              // Use default dimensions and try to render anyway
              const fallbackPageWidthPoints = maxWidth || 612;
              const fallbackPageHeightPoints = maxHeight || 792;
              const fallbackPageRenderedWidth = Math.ceil(fallbackPageWidthPoints * scale);
              const fallbackPageRenderedHeight = Math.ceil(fallbackPageHeightPoints * scale);

              // We'll render this page using Puppeteer with page number, even without pdfjs page object
              const browserPage = await browser.newPage();
              try {
                // Create HTML that renders the specific page using PDF.js
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    body { margin: 0; padding: 0; background: white; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="pdf-canvas"></canvas>
  <script>
    (async function() {
      const pdfData = atob('${pdfBase64}');
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const targetPageNum = ${pageNum};
      const page = await pdf.getPage(targetPageNum - 1); // pdfjs uses 0-based index
      const viewport = page.getViewport({ scale: ${scale} });
      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport: viewport }).promise;
    })().catch(err => {
      console.error('PDF render error:', err);
      // If rendering fails, create a blank white canvas
      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');
      canvas.width = ${fallbackPageRenderedWidth};
      canvas.height = ${fallbackPageRenderedHeight};
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
    });
  </script>
</body>
</html>`;

                await browserPage.setContent(htmlContent);
                await browserPage.waitForTimeout(2000); // Wait for PDF.js to render

                const screenshot = await browserPage.screenshot({
                  type: 'png',
                  fullPage: true,
                  clip: {
                    x: 0,
                    y: 0,
                    width: fallbackPageRenderedWidth,
                    height: fallbackPageRenderedHeight
                  }
                });

                await browserPage.close();

                const imageFileName = `page_${pageNum}_render.png`;
                const imagePath = path.join(outputDir, imageFileName);
                await fs.writeFile(imagePath, screenshot);

                pageImages.push({
                  pageNumber: pageNum,
                  path: imagePath,
                  fileName: imageFileName,
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  pageWidthPoints: fallbackPageWidthPoints,
                  pageHeightPoints: fallbackPageHeightPoints,
                  renderFailed: false
                });

                console.log(`[PDF Page ${pageNum} → EPUB Page ${pageImages.length}] Rendered via Puppeteer fallback: ${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px (${fallbackPageWidthPoints}x${fallbackPageHeightPoints}pt)`);
                continue; // Successfully rendered, move to next page
              } catch (puppeteerError) {
                await browserPage.close().catch(() => { });
                console.warn(`[Page ${pageNum}] Puppeteer fallback also failed:`, puppeteerError.message);
                // Last resort: create a blank white image placeholder
                const sharp = (await import('sharp')).default;
                const blankImage = await sharp({
                  create: {
                    width: fallbackPageRenderedWidth,
                    height: fallbackPageRenderedHeight,
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 }
                  }
                }).png().toBuffer();

                const imageFileName = `page_${pageNum}_render.png`;
                const imagePath = path.join(outputDir, imageFileName);
                await fs.writeFile(imagePath, blankImage);

                pageImages.push({
                  pageNumber: pageNum,
                  path: imagePath,
                  fileName: imageFileName,
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  pageWidthPoints: fallbackPageWidthPoints,
                  pageHeightPoints: fallbackPageHeightPoints,
                  renderFailed: true
                });

                console.log(`[PDF Page ${pageNum} → EPUB Page ${pageImages.length}] Created blank placeholder: ${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px`);
                continue; // Created placeholder, move to next page
              }
            }

            const pageWidthPoints = viewport.width;
            const pageHeightPoints = viewport.height;
            const pageRenderedWidth = Math.ceil(pageWidthPoints * scale);
            const pageRenderedHeight = Math.ceil(pageHeightPoints * scale);

            // Only create browser page if we're actually rendering
            const page = await browser.newPage();

            // Create HTML with embedded PDF.js to render the specific page
            const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: white;
      overflow: hidden;
    }
    #pdf-container {
      width: ${pageRenderedWidth}px;
      height: ${pageRenderedHeight}px;
      position: relative;
      background: white;
    }
    canvas {
      display: block;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="pdf-container">
    <canvas id="pdf-canvas"></canvas>
  </div>
  <script>
    (async function() {
        const pdfData = atob('${pdfBase64}');
                const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
                const page = await pdf.getPage(${pageNum - 1});
        
        const viewport = page.getViewport({ scale: ${scale} });
        const canvas = document.getElementById('pdf-canvas');
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
    })();
  </script>
</body>
</html>`;

            // Set viewport
            await page.setViewport({
              width: pageRenderedWidth,
              height: pageRenderedHeight,
              deviceScaleFactor: 1
            });

            // Load the HTML
            await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

            // Wait for PDF to render
            await page.waitForFunction(
              () => {
                const canvas = document.getElementById('pdf-canvas');
                return canvas && canvas.width > 0 && canvas.height > 0;
              },
              { timeout: 30000 }
            );

            // Additional wait to ensure rendering is complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Take screenshot
            // Keep EPUB page number aligned with the PDF page number to prevent off-by-one shifts
            const epubPageNumber = pageNum;
            const imageFileName = `page_${epubPageNumber}.png`;
            const imagePath = path.join(outputDir, imageFileName);

            const screenshot = await page.screenshot({
              type: 'png',
              fullPage: false,
              clip: {
                x: 0,
                y: 0,
                width: pageRenderedWidth,
                height: pageRenderedHeight
              }
            });

            await fs.writeFile(imagePath, screenshot);

            // If page is smaller than max, create a canvas at max size and center it (like Java)
            // Ensure all extend values are non-negative
            let finalImagePath = imagePath;
            if (pageRenderedWidth < maxRenderedWidth || pageRenderedHeight < maxRenderedHeight) {
              const topExtend = Math.max(0, Math.floor((maxRenderedHeight - pageRenderedHeight) / 2));
              const bottomExtend = Math.max(0, Math.ceil((maxRenderedHeight - pageRenderedHeight) / 2));
              const leftExtend = Math.max(0, Math.floor((maxRenderedWidth - pageRenderedWidth) / 2));
              const rightExtend = Math.max(0, Math.ceil((maxRenderedWidth - pageRenderedWidth) / 2));

              // Only extend if we have positive values
              if (topExtend > 0 || bottomExtend > 0 || leftExtend > 0 || rightExtend > 0) {
                const finalImage = await sharp(imagePath)
                  .extend({
                    top: topExtend,
                    bottom: bottomExtend,
                    left: leftExtend,
                    right: rightExtend,
                    background: { r: 255, g: 255, b: 255 }
                  })
                  .toBuffer();

                await fs.writeFile(imagePath, finalImage);
              }
            }

            // Store both PDF page number (original) and EPUB page number (matching PDF page)
            pageImages.push({
              pdfPageNumber: pageNum, // Original PDF page number
              pageNumber: epubPageNumber, // EPUB page number matches PDF page number
              path: imagePath,
              fileName: imageFileName,
              width: maxRenderedWidth,
              height: maxRenderedHeight,
              pageWidth: pageWidthPoints,
              pageHeight: pageHeightPoints,
              renderFailed: false
            });

            console.log(`[PDF Page ${pageNum} → EPUB Page ${epubPageNumber}] Rendered successfully: ${maxRenderedWidth}x${maxRenderedHeight}px (${pageWidthPoints}x${pageHeightPoints}pt)`);

            await page.close();
          } catch (pageError) {
            console.error(`[Page ${pageNum}] Failed to render:`, pageError.message);
            // Create a blank placeholder to preserve page numbering and avoid text/page misalignment
            try {
              const fallbackPageWidthPoints = maxWidth || 612;
              const fallbackPageHeightPoints = maxHeight || 792;
              const fallbackPageRenderedWidth = Math.ceil(fallbackPageWidthPoints * scale);
              const fallbackPageRenderedHeight = Math.ceil(fallbackPageHeightPoints * scale);

              const sharp = (await import('sharp')).default;
              const blankImage = await sharp({
                create: {
                  width: fallbackPageRenderedWidth,
                  height: fallbackPageRenderedHeight,
                  channels: 3,
                  background: { r: 255, g: 255, b: 255 }
                }
              }).png().toBuffer();

              const imageFileName = `page_${pageNum}.png`;
              const imagePath = path.join(outputDir, imageFileName);
              await fs.writeFile(imagePath, blankImage);

              pageImages.push({
                pdfPageNumber: pageNum,
                pageNumber: pageNum,
                path: imagePath,
                fileName: imageFileName,
                width: fallbackPageRenderedWidth,
                height: fallbackPageRenderedHeight,
                pageWidth: fallbackPageWidthPoints,
                pageHeight: fallbackPageHeightPoints,
                renderFailed: true
              });

              console.warn(`[Page ${pageNum}] Render failed. Inserted blank placeholder to preserve ordering (${fallbackPageRenderedWidth}x${fallbackPageRenderedHeight}px).`);
            } catch (placeholderError) {
              console.warn(`[Page ${pageNum}] Failed to create placeholder after render error:`, placeholderError.message);
            }
          }
        }
      } finally {
        await browser.close();
        // Clean up PDF document
        try {
          await pdfDoc.destroy();
        } catch (destroyError) {
          // Ignore destroy errors
        }
      }

      console.log(`[PDF] Rendered ${pageImages.length} page images (expected ${totalPages} pages)`);
      if (pageImages.length !== totalPages) {
        console.warn(`[PDF] WARNING: Page count mismatch! Rendered ${pageImages.length} images but PDF has ${totalPages} pages`);
      }

      return {
        images: pageImages,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        renderedWidth: maxRenderedWidth,
        renderedHeight: maxRenderedHeight
      };
    } catch (error) {
      console.error('Error rendering PDF pages as images:', error);
      throw new Error(`Failed to render PDF pages: ${error.message}`);
    }
  }

  /**
   * Extract images from PDF (embedded images)
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @returns {Promise<Array>} Array of image objects with paths and metadata
   */
  static async extractImages(pdfFilePath, outputDir) {
    try {
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true }).catch(() => { });

      const pdfBytes = await fs.readFile(pdfFilePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();

      const images = [];
      let imageIndex = 0;

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];

        // Extract embedded images from the page
        const embeddedImages = await page.node.context.enumerateIndirectObjects();

        for (const [ref, object] of embeddedImages) {
          try {
            // Check if object is an image (XObject with Subtype 'Image')
            if (object instanceof pdfDoc.context.constructor.dict &&
              object.get('Subtype')?.toString() === '/Image') {

              const width = object.get('Width')?.value || 0;
              const height = object.get('Height')?.value || 0;

              // Try to extract image data
              let imageData;
              let imageFormat = 'png';

              try {
                // Get the raw image stream
                const stream = object.get('stream');
                if (stream) {
                  imageData = stream.contents;

                  // Determine format from ColorSpace
                  const colorSpace = object.get('ColorSpace')?.toString();
                  const filter = object.get('Filter')?.toString();

                  if (filter?.includes('/DCTDecode')) {
                    imageFormat = 'jpg';
                  } else if (filter?.includes('/JPXDecode')) {
                    imageFormat = 'jp2';
                  } else {
                    imageFormat = 'png';
                  }

                  // Save image
                  const imageFileName = `image_${pageIndex + 1}_${imageIndex}.${imageFormat}`;
                  const imagePath = path.join(outputDir, imageFileName);

                  // Process and save image using sharp
                  await sharp(imageData).toFile(imagePath);

                  images.push({
                    pageNumber: pageIndex + 1,
                    index: imageIndex,
                    path: imagePath,
                    fileName: imageFileName,
                    width,
                    height,
                    format: imageFormat
                  });

                  imageIndex++;
                }
              } catch (imgError) {
                console.warn(`Could not extract image ${imageIndex} from page ${pageIndex + 1}:`, imgError.message);
              }
            }
          } catch (err) {
            // Skip objects that aren't images
            continue;
          }
        }
      }

      // Alternative approach: Render pages as images if no embedded images found
      if (images.length === 0) {
        console.log('No embedded images found, rendering pages as images...');
        // This would require pdf2pic or similar library
        // For now, we'll proceed without images
      }

      return images;
    } catch (error) {
      console.error('Error extracting images from PDF:', error);
      // Don't throw - images are optional
      return [];
    }
  }

  /**
   * Check if pdf-poppler is available
   * @returns {Promise<boolean>} True if pdf-poppler is available
   */
  static async checkPdfPopplerAvailable() {
    try {
      const pdfPoppler = await getPdfPoppler();
      return pdfPoppler !== null;
    } catch (error) {
      console.log(`[PDF Poppler] Error checking pdf-poppler: ${error.message}`);
      return false;
    }
  }

  /**
   * Find pdfimages.exe in pdf-poppler's node_modules
   * @returns {Promise<string|null>} Full path to pdfimages.exe or null if not found
   */
  static async findPdfImagesExe() {
    try {
      // Try common locations first - pdf-poppler stores binaries in lib/win or lib/osx
      const isWindows = process.platform === 'win32';
      const platformDir = isWindows ? 'win' : 'osx';
      const possiblePaths = [
        path.join(__dirname, '../../node_modules/pdf-poppler/lib', platformDir, 'pdfimages.exe'),
        path.join(__dirname, '../../node_modules/pdf-poppler/lib', platformDir, 'pdfimages'),
        path.join(__dirname, '../../node_modules/pdf-poppler/bin/pdfimages.exe'),
        path.join(__dirname, '../../node_modules/pdf-poppler/vendor/pdfimages.exe'),
        path.join(process.cwd(), 'node_modules/pdf-poppler/lib', platformDir, 'pdfimages.exe'),
        path.join(process.cwd(), 'node_modules/pdf-poppler/lib', platformDir, 'pdfimages'),
        path.join(process.cwd(), 'node_modules/pdf-poppler/bin/pdfimages.exe'),
        path.join(process.cwd(), 'node_modules/pdf-poppler/vendor/pdfimages.exe')
      ];

      // Try the possible paths first (faster)
      for (const possiblePath of possiblePaths) {
        try {
          if (await fse.pathExists(possiblePath)) {
            console.log(`[PDF Poppler] Found pdfimages.exe at: ${possiblePath}`);
            return possiblePath;
          }
        } catch (e) {
          // Continue to next path
        }
      }

      // If not found in common locations, search recursively
      const pdfPopplerDirs = [
        path.join(__dirname, '../../node_modules/pdf-poppler'),
        path.join(process.cwd(), 'node_modules/pdf-poppler')
      ];

      // Recursive search function
      const searchForPdfImages = async (dir, depth = 0) => {
        if (depth > 10) return null; // Limit recursion depth

        try {
          const entries = await fse.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === 'pdfimages.exe') {
              return fullPath;
            } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              const found = await searchForPdfImages(fullPath, depth + 1);
              if (found) return found;
            }
          }
        } catch (e) {
          // Skip directories we can't read
        }
        return null;
      };

      for (const pdfPopplerDir of pdfPopplerDirs) {
        try {
          if (await fse.pathExists(pdfPopplerDir)) {
            const found = await searchForPdfImages(pdfPopplerDir);
            if (found) {
              console.log(`[PDF Poppler] Found pdfimages.exe at: ${found}`);
              return found;
            }
          }
        } catch (dirError) {
          // Try next location
        }
      }

      console.warn(`[PDF Poppler] Could not find pdfimages.exe in pdf-poppler package`);
      return null;
    } catch (error) {
      console.error(`[PDF Poppler] Error finding pdfimages.exe:`, error.message);
      return null;
    }
  }

  /**
   * Extract images using pdf-poppler npm package
   * Note: pdf-poppler converts PDF pages to images, but we need embedded images.
   * We'll use it to extract embedded images if possible, otherwise fall back to other methods.
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @param {number} pageNumber - Page number (1-based) or null for all pages
   * @returns {Promise<Array>} Array of extracted image file paths with metadata
   */
  static async extractImagesUsingPdfPoppler(pdfFilePath, outputDir, pageNumber = null) {
    try {
      const isAvailable = await this.checkPdfPopplerAvailable();
      if (!isAvailable) {
        console.log('[PDF Poppler] pdf-poppler package not available.');
        return [];
      }

      const pdfPoppler = await getPdfPoppler();
      if (!pdfPoppler) {
        return [];
      }

      console.log(`[PDF Poppler] Attempting to extract embedded images from PDF...`);

      // Note: pdf-poppler's convert() converts pages to images, not embedded images
      // For embedded images, we need to use pdfimages command-line tool
      // But let's try using pdf-poppler's info() first to get PDF structure
      try {
        const pdfInfo = await pdfPoppler.info(pdfFilePath);
        console.log(`[PDF Poppler] PDF info:`, pdfInfo);
      } catch (infoError) {
        console.warn(`[PDF Poppler] Could not get PDF info:`, infoError.message);
      }

      // Find pdfimages.exe in pdf-poppler's node_modules
      // pdf-poppler includes Poppler binaries including pdfimages.exe
      const pdfImagesExePath = await this.findPdfImagesExe();
      if (!pdfImagesExePath) {
        console.warn(`[PDF Poppler] Could not find pdfimages.exe in pdf-poppler package`);
        return [];
      }

      const tempPrefix = path.join(outputDir, `img_${Date.now()}_`);

      // Build pdfimages command - extract embedded images
      // -all: extract all images from all pages
      // -png: output as PNG
      let command = `"${pdfImagesExePath}" -all -png "${pdfFilePath}" "${tempPrefix}"`;

      // If specific page requested, use -f and -l flags
      if (pageNumber !== null) {
        command = `"${pdfImagesExePath}" -f ${pageNumber} -l ${pageNumber} -png "${pdfFilePath}" "${tempPrefix}"`;
      }

      console.log(`[PDF Poppler] Running pdfimages command: ${command}`);

      try {
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 60000 // 60 second timeout
        });

        if (stderr && !stderr.includes('Writing') && !stderr.includes('pdfimages')) {
          console.warn(`[PDF Poppler] pdfimages stderr: ${stderr}`);
        }

        // Find all extracted image files
        const files = await fse.readdir(outputDir);
        const imageFiles = files
          .filter(f => {
            const basename = path.basename(tempPrefix);
            return f.startsWith(basename) && (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'));
          })
          .sort()
          .map(f => path.join(outputDir, f));

        console.log(`[PDF Poppler] Extracted ${imageFiles.length} embedded image(s) using pdfimages`);
        return imageFiles;
      } catch (cmdError) {
        console.warn(`[PDF Poppler] pdfimages command failed:`, cmdError.message);
        // Fall back to trying pdf-poppler's convert (though this converts pages, not extracts embedded images)
        console.log(`[PDF Poppler] Note: pdf-poppler.convert() converts pages to images, not embedded images`);
        return [];
      }
    } catch (error) {
      console.error(`[PDF Poppler] Error extracting images:`, error.message);
      console.error(`[PDF Poppler] Error stack:`, error.stack);
      return [];
    }
  }

  /**
   * Extract embedded images from PDF, organized by page
   * Uses multiple methods: pdfimages (Poppler) > pdf-lib > enumerateIndirectObjects
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @param {Object} options - Extraction options
   * @param {number} options.scale - Scale factor for image extraction (default: 1.0)
   * @param {boolean} options.saveToDisk - Whether to save images to disk (default: true)
   * @param {string} options.format - Output format: 'png', 'jpg', or 'original' (default: 'original')
   * @param {boolean} options.usePdfImages - Force use of pdfimages tool (default: true, tries automatically)
   * @returns {Promise<Object>} Object with pages array, each containing images found on that page
   */
  static async extractImagesPerPage(pdfFilePath, outputDir, options = {}) {
    const { scale = 1.0, saveToDisk = true, format = 'original', usePdfImages = true } = options;

    try {
      // Ensure output directory exists
      if (saveToDisk) {
        await fs.mkdir(outputDir, { recursive: true }).catch(() => { });
      }

      // Method (PyMuPDF): Extract embedded images as real page images (no rendered-page fallback).
      // This is more reliable than pdf-lib for some PDFs where /Image XObjects are not easy to locate.
      const usePyMuPDFImages = options.usePyMuPDFImages !== false;
      if (usePyMuPDFImages) {
        console.log(`[PDF Image Extraction] Using PyMuPDF method (embedded images)...`);
        try {
          // Clear previous embedded extraction artifacts for a clean run.
          const existing = await fs.readdir(outputDir).catch(() => []);
          await Promise.all(existing.map(async (name) => {
            if (!/^page_\d+_image_\d+\./.test(name)) return;
            if (!/\.(png|jpg|jpeg|gif|webp|tif|tiff)$/i.test(name)) return;
            try { await fs.unlink(path.join(outputDir, name)); } catch (_) { }
          }));

          await this.runPythonProcessor([
            `--pdf "${pdfFilePath}"`,
            `--output-dir "${outputDir}"`,
            `--mode extract-images`
          ]);

          const embeddedJsonPath = path.join(outputDir, 'embedded_images.json');
          let embeddedData = null;
          try {
            const raw = await fs.readFile(embeddedJsonPath, 'utf8');
            embeddedData = JSON.parse(raw);
          } catch (_) { }

          // If python didn't write json, we can still infer from filenames.
          const files = await fs.readdir(outputDir).catch(() => []);
          const imageFiles = files.filter(f => /^page_\d+_image_\d+\./.test(f) && /\.(png|jpg|jpeg|gif|webp)$/i.test(f));

          if (embeddedData && typeof embeddedData.totalPages === 'number' && imageFiles.length > 0) {
            const totalPages = embeddedData.totalPages;
            const pagesData = [];
            let totalImages = 0;

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
              const pageList = embeddedData.pages?.[pageNum] || [];
              const images = [];
              for (const item of pageList) {
                const fileName = item.fileName;
                const imgPath = path.join(outputDir, fileName);
                const stats = await fs.stat(imgPath).catch(() => null);
                if (!stats) continue;
                images.push({
                  pageNumber: pageNum,
                  index: item.index,
                  ref: `pymupdf_${pageNum}_${item.index}`,
                  width: item.width || 0,
                  height: item.height || 0,
                  format: path.extname(fileName).replace('.', '').toLowerCase() || 'png',
                  mimeType: 'image/png',
                  path: imgPath,
                  fileName,
                  buffer: null,
                  size: stats.size
                });
              }

              pagesData.push({
                pageNumber: pageNum,
                pageIndex: pageNum - 1,
                pageSize: { width: 0, height: 0 },
                images,
                imageCount: images.length
              });
              totalImages += pagesData[pageNum - 1].imageCount;
            }

            console.log(`[PDF Image Extraction] Complete: ${totalImages} image(s) extracted from ${totalPages} page(s) using PyMuPDF`);

            if (totalImages > 0) {
              return {
                totalPages,
                totalImages,
                pages: pagesData,
                method: 'pymupdf',
                summary: pagesData.map(p => ({ pageNumber: p.pageNumber, imageCount: p.imageCount }))
              };
            }
          } else if (imageFiles.length > 0) {
            // Infer totals from filenames if json is missing.
            const pageNums = imageFiles.map(f => parseInt(f.match(/^page_(\d+)_image_/)[1], 10)).filter(Boolean);
            const totalPages = pageNums.length ? Math.max(...pageNums) : 0;
            const pagesData = [];
            let totalImages = 0;
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
              const images = imageFiles
                .filter(f => f.startsWith(`page_${pageNum}_image_`))
                .map(async (fileName) => {
                  const m = fileName.match(/^page_(\d+)_image_(\d+)\./);
                  const idx = m ? parseInt(m[2], 10) : 1;
                  const imgPath = path.join(outputDir, fileName);
                  const stats = await fs.stat(imgPath).catch(() => null);
                  if (!stats) return null;
                  return {
                    pageNumber: pageNum,
                    index: idx,
                    ref: `pymupdf_${pageNum}_${idx}`,
                    width: 0,
                    height: 0,
                    format: path.extname(fileName).replace('.', '').toLowerCase() || 'png',
                    mimeType: 'image/png',
                    path: imgPath,
                    fileName,
                    buffer: null,
                    size: stats.size
                  };
                });
              // eslint-disable-next-line no-await-in-loop
              const resolvedImages = (await Promise.all(images)).filter(Boolean);
              pagesData.push({
                pageNumber: pageNum,
                pageIndex: pageNum - 1,
                pageSize: { width: 0, height: 0 },
                images: resolvedImages,
                imageCount: resolvedImages.length
              });
              totalImages += resolvedImages.length;
            }
            console.log(`[PDF Image Extraction] Complete: ${totalImages} image(s) extracted using PyMuPDF (filename inference)`);
            if (totalImages > 0) {
              return {
                totalPages,
                totalImages,
                pages: pagesData,
                method: 'pymupdf',
                summary: pagesData.map(p => ({ pageNumber: p.pageNumber, imageCount: p.imageCount }))
              };
            }
          }
        } catch (pymupdfErr) {
          console.warn(`[PDF Image Extraction] PyMuPDF embedded extraction failed, trying pdf-lib:`, pymupdfErr.message);
        }
      }

      // Method 1: Try pdf-poppler npm package first - most reliable
      if (usePdfImages) {
        console.log(`[PDF Image Extraction] Checking if pdf-poppler is available...`);
        try {
          const pdfPopplerAvailable = await this.checkPdfPopplerAvailable();
          console.log(`[PDF Image Extraction] pdf-poppler available: ${pdfPopplerAvailable}`);
          if (pdfPopplerAvailable) {
            console.log(`[PDF Image Extraction] Using pdf-poppler for extraction...`);
            const extractedImageFiles = await this.extractImagesUsingPdfPoppler(pdfFilePath, outputDir);

            if (extractedImageFiles.length > 0) {
              // Get PDF page count
              const pdfBytes = await fs.readFile(pdfFilePath);
              const pdfDoc = await PDFDocument.load(pdfBytes);
              const pages = pdfDoc.getPages();
              const totalPages = pages.length;

              // Organize images by page (pdfimages doesn't provide page info directly)
              // We'll assign them sequentially or try to match by filename patterns
              const pagesData = [];

              // Group images - pdfimages outputs sequential files
              // We'll distribute them evenly across pages or use a heuristic
              const imagesPerPage = Math.ceil(extractedImageFiles.length / totalPages);

              for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const pageNumber = pageIndex + 1;
                const pageImages = [];

                // Get images for this page (distribute evenly)
                const startIdx = pageIndex * imagesPerPage;
                const endIdx = Math.min(startIdx + imagesPerPage, extractedImageFiles.length);

                for (let i = startIdx; i < endIdx; i++) {
                  const imagePath = extractedImageFiles[i];
                  try {
                    const stats = await fs.stat(imagePath);
                    const image = sharp(imagePath);
                    const metadata = await image.metadata();

                    pageImages.push({
                      pageNumber,
                      index: i - startIdx + 1,
                      ref: `pdfimages_${i}`,
                      width: metadata.width || 0,
                      height: metadata.height || 0,
                      format: metadata.format || 'png',
                      mimeType: `image/${metadata.format || 'png'}`,
                      path: imagePath,
                      fileName: path.basename(imagePath),
                      buffer: null,
                      size: stats.size
                    });
                  } catch (imgError) {
                    console.warn(`[Page ${pageNumber}] Could not process extracted image:`, imgError.message);
                  }
                }

                pagesData.push({
                  pageNumber,
                  pageIndex,
                  pageSize: { width: 0, height: 0 }, // Unknown from pdfimages
                  images: pageImages,
                  imageCount: pageImages.length
                });

                if (pageImages.length > 0) {
                  console.log(`[Page ${pageNumber}] Found ${pageImages.length} image(s) via pdf-poppler`);
                }
              }

              const totalImages = pagesData.reduce((sum, page) => sum + page.imageCount, 0);
              console.log(`[PDF Image Extraction] Complete: ${totalImages} image(s) extracted from ${totalPages} page(s) using pdf-poppler`);

              return {
                totalPages,
                totalImages,
                pages: pagesData,
                method: 'pdf-poppler',
                summary: pagesData.map(p => ({
                  pageNumber: p.pageNumber,
                  imageCount: p.imageCount
                }))
              };
            }
          }
        } catch (pdfPopplerError) {
          console.warn(`[PDF Image Extraction] pdf-poppler method failed, falling back to pdf-lib:`, pdfPopplerError.message);
          console.warn(`[PDF Image Extraction] Error details:`, pdfPopplerError.stack);
        }
      } else {
        console.log(`[PDF Image Extraction] pdf-poppler disabled (usePdfImages=false), using pdf-lib method...`);
      }

      // Method 2: Fallback to pdf-lib method
      console.log(`[PDF Image Extraction] Using pdf-lib method...`);
      const pdfBytes = await fs.readFile(pdfFilePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      const totalPages = pages.length;

      if (totalPages === 0) {
        throw new Error('PDF has no pages');
      }

      console.log(`[PDF Image Extraction] Processing ${totalPages} pages...`);

      const pagesData = [];
      const processedImageRefs = new Set(); // Track processed image references to avoid duplicates

      // Process each page
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const pageNumber = pageIndex + 1;
        const page = pages[pageIndex];
        const pageImages = [];

        try {
          // Get page dimensions
          const { width, height } = page.getSize();

          console.log(`[Page ${pageNumber}] Starting image extraction (page size: ${width}x${height})...`);

          // Extract embedded images from the page
          // Method 1: Try to access through page resources/XObject dictionary
          let imageIndexOnPage = 0;

          try {
            // Access the page's node and resources
            const pageNode = page.node;
            if (!pageNode) {
              console.log(`[Page ${pageNumber}] No page node found`);
              throw new Error('No page node');
            }

            const pageDict = pageNode.dict;
            if (!pageDict) {
              console.log(`[Page ${pageNumber}] No page dictionary found`);
              throw new Error('No page dictionary');
            }

            console.log(`[Page ${pageNumber}] Accessing page resources...`);
            // Get Resources dictionary - try different methods (including inherited /Resources on parent /Pages nodes)
            let resourcesRef = null;

            // Import PDFName once per page for the various lookup strategies.
            let PDFName = null;
            try {
              PDFName = (await import('pdf-lib')).PDFName;
            } catch (_) { }

            const resolveResourcesRefFromDict = (dictLike) => {
              if (!dictLike) return null;

              // Method A: get() with PDFName
              try {
                if (PDFName && dictLike.get) {
                  const ref = dictLike.get(PDFName.of('Resources'));
                  if (ref) return ref;
                }
              } catch (_) { }

              // Method B: direct get('Resources')
              try {
                if (dictLike.get) {
                  const ref = dictLike.get('Resources');
                  if (ref) return ref;
                }
              } catch (_) { }

              // Method C: sometimes the wrapper exposes inner dict
              try {
                const inner = dictLike.dict;
                if (inner && inner.Resources) return inner.Resources;
              } catch (_) { }

              // Method D: direct property
              try {
                if (dictLike.Resources) return dictLike.Resources;
              } catch (_) { }

              return null;
            };

            // Try direct resources on the page node first.
            resourcesRef = resolveResourcesRefFromDict(pageDict);

            // If missing, walk up the PDF node tree to pick up inherited resources from parent /Pages dictionaries.
            if (!resourcesRef) {
              let currentNode = pageNode;
              let steps = 0;
              while (!resourcesRef && currentNode && steps < 20) {
                const parentNode = currentNode.Parent || currentNode.parent || (typeof currentNode.getParent === 'function' ? currentNode.getParent() : null);
                if (!parentNode) break;
                currentNode = parentNode;
                steps += 1;

                const parentDict = currentNode.dict;
                resourcesRef = resolveResourcesRefFromDict(parentDict);
              }
            }

            if (resourcesRef) {
              const resources = pdfDoc.context.lookup(resourcesRef);

              if (resources) {
                // Get XObject dictionary (where images are stored)
                let xObjectRef = resources.get('XObject');
                if (!xObjectRef) {
                  // Some PDFs keep the page-level /Resources empty and inherit /XObject from the parent /Pages dictionary.
                  // In that case, we must walk up even when we already have a /Resources ref.
                  console.log(`[Page ${pageNumber}] /Resources found but no XObject; trying inherited /Resources...`);
                  let currentNode = pageNode;
                  let steps = 0;
                  while (!xObjectRef && currentNode && steps < 20) {
                    const parentNode = currentNode.Parent || currentNode.parent || (typeof currentNode.getParent === 'function' ? currentNode.getParent() : null);
                    if (!parentNode) break;
                    currentNode = parentNode;
                    steps += 1;
                    const parentDict = currentNode.dict;
                    const inheritedResourcesRef = resolveResourcesRefFromDict(parentDict);
                    if (!inheritedResourcesRef) continue;
                    const inheritedResources = pdfDoc.context.lookup(inheritedResourcesRef);
                    if (!inheritedResources) continue;
                    const inheritedXObjectRef = inheritedResources.get('XObject');
                    if (inheritedXObjectRef) {
                      xObjectRef = inheritedXObjectRef;
                      console.log(`[Page ${pageNumber}] Found XObject in inherited resources (ancestor steps=${steps}).`);
                      break;
                    }
                  }
                }

                if (xObjectRef) {
                  const xObjectDict = pdfDoc.context.lookup(xObjectRef);

                  if (xObjectDict && xObjectDict.keys) {
                    const xObjectKeys = xObjectDict.keys();
                    console.log(`[Page ${pageNumber}] Found ${xObjectKeys.length} XObject(s) in resources`);

                    for (const key of xObjectKeys) {
                      try {
                        const xObjectRef = xObjectDict.get(key);
                        const xObject = pdfDoc.context.lookup(xObjectRef);

                        if (xObject) {
                          // Check if it's an image
                          const subtypeRef = xObject.get('Subtype');
                          if (subtypeRef) {
                            const subtype = subtypeRef.toString();

                            if (subtype === '/Image') {
                              // This is an image XObject
                              let isImage = true;
                              let imageData = null;
                              let imgWidth = 0;
                              let imgHeight = 0;
                              let imageFormat = 'png';
                              let bitsPerComponent = 8;
                              let colorSpace = 'DeviceRGB';

                              // Get image properties
                              const widthRef = xObject.get('Width');
                              const heightRef = xObject.get('Height');
                              const bitsRef = xObject.get('BitsPerComponent');
                              const colorSpaceRef = xObject.get('ColorSpace');
                              const filterRef = xObject.get('Filter');

                              imgWidth = widthRef ? widthRef.asNumber() : 0;
                              imgHeight = heightRef ? heightRef.asNumber() : 0;
                              bitsPerComponent = bitsRef ? bitsRef.asNumber() : 8;

                              // Get color space
                              if (colorSpaceRef) {
                                if (colorSpaceRef.toString) {
                                  colorSpace = colorSpaceRef.toString();
                                }
                              }

                              // Determine format from filter
                              if (filterRef) {
                                const filterStr = filterRef.toString();
                                if (filterStr.includes('DCTDecode')) {
                                  imageFormat = 'jpg';
                                } else if (filterStr.includes('JPXDecode')) {
                                  imageFormat = 'jp2';
                                } else if (filterStr.includes('CCITTFaxDecode')) {
                                  imageFormat = 'tiff';
                                }
                              }

                              // Get the image stream
                              const streamRef = xObject.get('stream');
                              if (streamRef) {
                                const stream = pdfDoc.context.lookup(streamRef);
                                if (stream && stream.contents) {
                                  const streamBytes = stream.contents;
                                  imageData = Buffer.from(streamBytes);
                                }
                              }

                              if (isImage && imageData && imageData.length > 0) {
                                // Process image with sharp
                                let finalImageBuffer = imageData;
                                let finalWidth = imgWidth;
                                let finalHeight = imgHeight;
                                let finalFormat = imageFormat;

                                try {
                                  const image = sharp(imageData);
                                  const metadata = await image.metadata();

                                  finalWidth = metadata.width || finalWidth;
                                  finalHeight = metadata.height || finalHeight;

                                  // Apply transformations
                                  let transformedImage = image;

                                  // Apply scale if specified
                                  if (scale !== 1.0 && scale > 0) {
                                    finalWidth = Math.round(finalWidth * scale);
                                    finalHeight = Math.round(finalHeight * scale);
                                    transformedImage = transformedImage.resize(finalWidth, finalHeight);
                                  }

                                  // Convert format if needed
                                  if (format !== 'original' && format !== imageFormat) {
                                    if (format === 'png') {
                                      transformedImage = transformedImage.png();
                                    } else if (format === 'jpg') {
                                      transformedImage = transformedImage.jpeg({ quality: 90 });
                                    }
                                    finalFormat = format;
                                  } else {
                                    // Keep original format
                                    if (imageFormat === 'jpg') {
                                      transformedImage = transformedImage.jpeg({ quality: 90 });
                                    } else if (imageFormat === 'png') {
                                      transformedImage = transformedImage.png();
                                    }
                                  }

                                  finalImageBuffer = await transformedImage.toBuffer();
                                } catch (sharpError) {
                                  console.warn(`[Page ${pageNumber}] Could not process image with sharp, using raw data:`, sharpError.message);
                                  // Use raw buffer if sharp fails
                                }

                                // Save image to disk if requested
                                let imagePath = null;
                                let fileName = null;

                                if (saveToDisk) {
                                  fileName = `page_${pageNumber}_image_${imageIndexOnPage + 1}.${finalFormat}`;
                                  imagePath = path.join(outputDir, fileName);
                                  await fs.writeFile(imagePath, finalImageBuffer);
                                  console.log(`[Page ${pageNumber}] Extracted image: ${fileName} (${finalWidth}x${finalHeight}px, ${finalFormat})`);
                                }

                                pageImages.push({
                                  pageNumber,
                                  index: imageIndexOnPage + 1,
                                  ref: key.toString(),
                                  width: finalWidth,
                                  height: finalHeight,
                                  format: finalFormat,
                                  mimeType: finalFormat === 'jpg' ? 'image/jpeg' : `image/${finalFormat}`,
                                  bitsPerComponent,
                                  colorSpace,
                                  path: imagePath,
                                  fileName,
                                  buffer: saveToDisk ? null : finalImageBuffer,
                                  size: finalImageBuffer.length
                                });

                                imageIndexOnPage++;
                              }
                            }
                          }
                        }
                      } catch (xObjectError) {
                        console.warn(`[Page ${pageNumber}] Error processing XObject ${key}:`, xObjectError.message);
                        continue;
                      }
                    }
                  } else {
                    console.log(`[Page ${pageNumber}] No XObject dictionary found in resources`);
                  }
                } else {
                  console.log(`[Page ${pageNumber}] No XObject reference found in resources`);
                }
              } else {
                console.log(`[Page ${pageNumber}] Resources dictionary not found or empty`);
              }
            } else {
              console.log(`[Page ${pageNumber}] No Resources reference found in page dictionary`);
            }
          } catch (resourceError) {
            console.warn(`[Page ${pageNumber}] Could not access page resources via dict method:`, resourceError.message);
          }

          // Fallback: Try the enumerateIndirectObjects method (like old extractImages)
          if (pageImages.length === 0) {
            try {
              console.log(`[Page ${pageNumber}] Trying fallback method: enumerateIndirectObjects...`);
              const pageContext = page.node.context;
              const embeddedObjects = pageContext.enumerateIndirectObjects();

              let objectCount = 0;
              let imageObjectCount = 0;
              for (const [ref, object] of embeddedObjects) {
                objectCount++;
                try {
                  // Check if object is an image (XObject with Subtype 'Image')
                  if (object && typeof object === 'object') {
                    const subtype = object.get?.('Subtype');
                    if (subtype && (subtype.toString() === '/Image' || subtype === '/Image')) {
                      imageObjectCount++;
                      console.log(`[Page ${pageNumber}] Found image object via enumerateIndirectObjects: ${ref}`);

                      // Try to extract the image
                      try {
                        const width = object.get?.('Width')?.value || object.get?.('Width') || 0;
                        const height = object.get?.('Height')?.value || object.get?.('Height') || 0;
                        const stream = object.get?.('stream');

                        if (stream && stream.contents) {
                          const imageData = Buffer.from(stream.contents);
                          const filter = object.get?.('Filter');
                          let imageFormat = 'png';

                          if (filter) {
                            const filterStr = filter.toString();
                            if (filterStr.includes('DCTDecode')) {
                              imageFormat = 'jpg';
                            }
                          }

                          // Process and save image
                          let finalImageBuffer = imageData;
                          try {
                            const image = sharp(imageData);
                            const metadata = await image.metadata();
                            finalImageBuffer = await image.toBuffer();
                          } catch (sharpError) {
                            // Use raw buffer
                          }

                          if (saveToDisk) {
                            const fileName = `page_${pageNumber}_image_${imageIndexOnPage + 1}.${imageFormat}`;
                            const imagePath = path.join(outputDir, fileName);
                            await fs.writeFile(imagePath, finalImageBuffer);
                            console.log(`[Page ${pageNumber}] Extracted image via fallback: ${fileName} (${width}x${height}px)`);

                            pageImages.push({
                              pageNumber,
                              index: imageIndexOnPage + 1,
                              ref: ref.toString(),
                              width,
                              height,
                              format: imageFormat,
                              mimeType: imageFormat === 'jpg' ? 'image/jpeg' : `image/${imageFormat}`,
                              path: imagePath,
                              fileName,
                              buffer: saveToDisk ? null : finalImageBuffer,
                              size: finalImageBuffer.length
                            });

                            imageIndexOnPage++;
                          }
                        }
                      } catch (extractError) {
                        console.warn(`[Page ${pageNumber}] Could not extract image from object ${ref}:`, extractError.message);
                      }
                    }
                  }
                } catch (objError) {
                  // Skip
                }
              }
              console.log(`[Page ${pageNumber}] Enumerated ${objectCount} indirect objects, found ${imageObjectCount} image(s)`);
            } catch (fallbackError) {
              console.warn(`[Page ${pageNumber}] Fallback method also failed:`, fallbackError.message);
            }
          }

          // Store page data
          pagesData.push({
            pageNumber,
            pageIndex,
            pageSize: {
              width,
              height
            },
            images: pageImages,
            imageCount: pageImages.length
          });

          if (pageImages.length > 0) {
            console.log(`[Page ${pageNumber}] Found ${pageImages.length} image(s)`);
          }

        } catch (pageError) {
          console.error(`[Page ${pageNumber}] Error extracting images:`, pageError.message);
          // Continue with next page even if this one fails
          pagesData.push({
            pageNumber,
            pageIndex,
            images: [],
            imageCount: 0,
            error: pageError.message
          });
        }
      }

      const totalImages = pagesData.reduce((sum, page) => sum + page.imageCount, 0);
      console.log(`[PDF Image Extraction] Complete: ${totalImages} image(s) extracted from ${totalPages} page(s)`);

      return {
        totalPages,
        totalImages,
        pages: pagesData,
        summary: pagesData.map(p => ({
          pageNumber: p.pageNumber,
          imageCount: p.imageCount
        }))
      };

    } catch (error) {
      console.error('[PDF Image Extraction] Error:', error);
      throw new Error(`Failed to extract images from PDF: ${error.message}`);
    }
  }

  /**
   * Extract both text and images from PDF
   * @param {string} pdfFilePath - Path to the PDF file
   * @param {string} outputDir - Directory to save extracted images
   * @returns {Promise<Object>} Object containing text and images
   */
  static async extractContent(pdfFilePath, outputDir) {
    const [textData, images] = await Promise.all([
      this.extractText(pdfFilePath),
      this.extractImages(pdfFilePath, outputDir).catch(() => [])
    ]);

    return {
      text: textData,
      images,
      hasImages: images.length > 0
    };
  }
}

