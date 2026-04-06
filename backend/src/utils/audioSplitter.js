/**
 * Split audio into per-page segments (Kitaboo-style).
 * Uses FFmpeg -c copy for fast, lossless splitting.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPageNumFromZoneId(id) {
  const m = String(id || '').match(/^p(\d+)_/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Compute page boundaries from alignment segments.
 * When many pages are collapsed (same end time), falls back to proportional distribution.
 * @param {Array<{id: string, startTime: number, endTime: number}>} segments
 * @param {number} [audioDuration] - Total audio length (from ffprobe or last segment)
 * @returns {Array<{page: number, start: number, end: number}>}
 */
export function getPageBoundaries(segments, audioDuration) {
  const byPage = {};
  let maxEnd = 0;
  for (const s of segments) {
    const page = getPageNumFromZoneId(s.id);
    if (page == null) continue;
    const start = Number(s.startTime) || 0;
    const end = Number(s.endTime) || start + 0.2;
    if (end > maxEnd) maxEnd = end;
    if (!byPage[page]) byPage[page] = { minStart: Infinity, maxEnd: -Infinity };
    if (start < byPage[page].minStart) byPage[page].minStart = start;
    if (end > byPage[page].maxEnd) byPage[page].maxEnd = end;
  }
  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
  const totalDuration = audioDuration && audioDuration > 0 ? audioDuration : maxEnd;

  const raw = pages.map(page => ({
    page,
    start: byPage[page].minStart,
    end: byPage[page].maxEnd,
    duration: byPage[page].maxEnd - byPage[page].minStart
  }));

  console.log(`[AudioSplitter] Raw page boundaries from first pass:`, raw.map(b => `Page ${b.page}: ${b.start.toFixed(1)}s - ${b.end.toFixed(1)}s (${b.duration.toFixed(1)}s)`).join('; '));

  const collapsed = raw.filter(b => b.duration < 2);
  let boundaries;
  if (collapsed.length > pages.length * 0.3) {
    console.log(`[AudioSplitter] ${collapsed.length}/${pages.length} pages collapsed, using proportional boundaries`);
    const n = pages.length;
    boundaries = pages.map((page, i) => ({
      page,
      start: (i / n) * totalDuration,
      end: ((i + 1) / n) * totalDuration
    }));
  } else {
    boundaries = raw.map(b => ({ page: b.page, start: b.start, end: b.end }));
  }

  return boundaries;
}

/**
 * Compute page boundaries using proportional text-length distribution.
 * Pages with more text get more audio time. No per-PDF hardcoding.
 * @param {Array<{pageNum: number, textZones: Array<{content?: string}>}>} pagesWithZones
 * @param {number} audioDuration - Total audio length (from ffprobe)
 * @returns {Array<{page: number, start: number, end: number}>}
 */
export function getProportionalBoundaries(pagesWithZones, audioDuration) {
  if (!pagesWithZones?.length || audioDuration <= 0) return [];

  const totalChars = pagesWithZones.reduce((sum, p) => {
    const pageChars = (p.textZones || []).reduce((s, z) => s + (String(z.content || '').length), 0);
    return sum + Math.max(1, pageChars);
  }, 0);

  let currentPointer = 0;
  const boundaries = [];

  for (const p of pagesWithZones) {
    const pageChars = (p.textZones || []).reduce((s, z) => s + (String(z.content || '').length), 0);
    const pageWeight = Math.max(1, pageChars) / totalChars;
    const estimatedDuration = audioDuration * pageWeight;
    const start = Math.max(0, currentPointer);
    const end = Math.min(audioDuration, currentPointer + estimatedDuration);

    boundaries.push({
      page: p.pageNum,
      start: Number(start.toFixed(3)),
      end: Number(Math.max(start + 0.1, end).toFixed(3))
    });
    currentPointer = end;
  }

  console.log(`[AudioSplitter] Proportional boundaries:`, boundaries.map(b => `Page ${b.page}: ${b.start.toFixed(2)}s - ${b.end.toFixed(2)}s`).join('; '));
  return boundaries;
}

/**
 * Extract a slice of audio for Whisper search window.
 * @param {string} inputPath - Master audio
 * @param {number} startSec - Start time (seconds)
 * @param {number} durationSec - Duration (seconds)
 * @param {string} outputPath - Where to write the slice
 */
export function extractAudioSlice(inputPath, startSec, durationSec, outputPath) {
  const startStr = Math.max(0, startSec).toFixed(3);
  const durStr = Math.max(0.1, durationSec).toFixed(3);
  execSync(
    `ffmpeg -y -i "${inputPath}" -ss ${startStr} -t ${durStr} -acodec copy "${outputPath}"`,
    { encoding: 'utf8', timeout: 30000, stdio: 'pipe' }
  );
}

/**
 * Split a master audio file into per-page clips.
 * @param {string} inputPath - Full path to master audio
 * @param {Array<{page: number, start: number, end: number}>} boundaries
 * @param {string} outputDir - Where to write page_N.mp3
 * @returns {Promise<Array<{page: number, path: string, start: number, end: number}>>}
 */
export async function splitAudioByPageBoundaries(inputPath, boundaries, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const ext = path.extname(inputPath) || '.mp3';
  const results = [];
  for (const { page, start, end } of boundaries) {
    const duration = Math.max(0.1, end - start);
    const outPath = path.join(outputDir, `page_${page}${ext}`);
    const startStr = start.toFixed(3);
    const durStr = duration.toFixed(3);
    try {
      execSync(
        `ffmpeg -y -i "${inputPath}" -ss ${startStr} -t ${durStr} -acodec copy "${outPath}"`,
        { encoding: 'utf8', timeout: 60000, stdio: 'pipe' }
      );
      const absolutePath = path.resolve(outPath);
      console.log(`[AudioSplitter] Created page ${page}: ${startStr}s - ${end.toFixed(3)}s (${durStr}s) -> ${path.basename(absolutePath)}`);
      results.push({ page, path: absolutePath, start, end });
    } catch (e) {
      console.warn(`[AudioSplitter] Failed page ${page}:`, e.message);
    }
  }
  return results;
}
