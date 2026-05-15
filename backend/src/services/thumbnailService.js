/**
 * thumbnailService.js
 *
 * Generates a PNG thumbnail from page 1 of a PDF using pdfjs-dist + canvas.
 * Thumbnails are cached to disk at uploads/thumbnails/pdf-{id}.png so they
 * are only generated once per PDF.
 *
 * Dependencies already in package.json: pdfjs-dist, canvas, sharp, fs
 */

import path from 'path';
import fs from 'fs/promises';
import { getThumbnailDir } from '../config/fileStorage.js';
import { getPdfjsLib, buildPdfDocumentOptions } from '../utils/pdfjsHelper.js';

const THUMB_WIDTH  = 400;
const THUMB_HEIGHT = 560;

/**
 * Returns the disk path for a cached thumbnail.
 * @param {number} pdfId
 */
function thumbPath(pdfId) {
  return path.join(getThumbnailDir(), `pdf-${pdfId}.png`);
}

/**
 * Generate a PNG thumbnail from page 1 of the PDF at `filePath`.
 * Saves the result to disk and returns the file path.
 *
 * @param {number} pdfId
 * @param {string} filePath  - Absolute path to the PDF file on disk
 * @returns {Promise<string>} - Absolute path to the generated PNG
 */
export async function generatePdfThumbnail(pdfId, filePath) {
  const outPath = thumbPath(pdfId);

  // Ensure output directory exists
  await fs.mkdir(getThumbnailDir(), { recursive: true });

  // Load PDF from disk
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdfjsLib = await getPdfjsLib();
  const loadingTask = pdfjsLib.getDocument(buildPdfDocumentOptions(data, {
    disableFontFace: true,
  }));
  const pdfDoc = await loadingTask.promise;

  const page = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });

  // Scale to fit within THUMB_WIDTH × THUMB_HEIGHT preserving aspect ratio
  const scale = Math.min(THUMB_WIDTH / viewport.width, THUMB_HEIGHT / viewport.height);
  const scaledViewport = page.getViewport({ scale });

  const canvasWidth  = Math.ceil(scaledViewport.width);
  const canvasHeight = Math.ceil(scaledViewport.height);

  // Use the `canvas` npm package for Node-side rendering
  const { createCanvas } = await import('canvas');
  const canvas  = createCanvas(canvasWidth, canvasHeight);
  const context = canvas.getContext('2d');

  // White background
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  await page.render({
    canvasContext: context,
    viewport: scaledViewport,
  }).promise;

  // Write PNG to disk
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(outPath, buffer);

  // Cleanup PDF.js resources
  page.cleanup();
  await pdfDoc.destroy();

  return outPath;
}

/**
 * Returns the cached thumbnail path if it exists, otherwise generates it.
 *
 * @param {number} pdfId
 * @param {string} filePath  - Absolute path to the PDF file
 * @returns {Promise<string|null>} - Path to PNG, or null if generation failed
 */
export async function getOrGenerateThumbnail(pdfId, filePath) {
  const cached = thumbPath(pdfId);
  try {
    await fs.access(cached);
    return cached; // already generated
  } catch {
    // Not cached — generate now
  }

  try {
    return await generatePdfThumbnail(pdfId, filePath);
  } catch (err) {
    console.error(`[thumbnailService] Failed to generate thumbnail for PDF ${pdfId}:`, err.message);
    return null;
  }
}

/**
 * Invalidate (delete) the cached thumbnail for a PDF.
 * Call this when a PDF is deleted.
 *
 * @param {number} pdfId
 */
export async function invalidateThumbnail(pdfId) {
  try {
    await fs.unlink(thumbPath(pdfId));
  } catch {
    // File may not exist — that's fine
  }
}
