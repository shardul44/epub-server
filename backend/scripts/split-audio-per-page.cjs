#!/usr/bin/env node
/**
 * Split a long narration audio file into per-page segments (Kitaboo-style).
 * Uses alignment timestamps as boundaries. Run after first Align pass.
 *
 * Usage:
 *   node scripts/split-audio-per-page.cjs <audio-path> <alignment-json-path> [output-dir]
 *
 * Example:
 *   node scripts/split-audio-per-page.cjs ./uploads/narration.mp3 ./alignment.json ./page-audio
 *
 * Kitaboo 3-step workflow:
 *   1. Run Align (whole file, ~30% accuracy)
 *   2. Run this script to create page_1.mp3, page_2.mp3, ...
 *   3. Re-run Align with per-page audio (or set USE_TWO_PASS_ALIGNMENT=1 for automatic)
 *
 * Output: page_1.mp3, page_2.mp3, ... in output-dir
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getPageNumFromZoneId(id) {
  const m = String(id || '').match(/^p(\d+)_/);
  return m ? parseInt(m[1], 10) : null;
}

function splitAudioPerPage(audioPath, alignmentPath, outputDir) {
  const audioAbs = path.resolve(audioPath);
  const alignAbs = path.resolve(alignmentPath);
  const outDir = outputDir ? path.resolve(outputDir) : path.dirname(audioAbs);

  if (!fs.existsSync(audioAbs)) {
    console.error('Audio file not found:', audioAbs);
    process.exit(1);
  }
  if (!fs.existsSync(alignAbs)) {
    console.error('Alignment file not found:', alignAbs);
    process.exit(1);
  }

  const alignment = JSON.parse(fs.readFileSync(alignAbs, 'utf8'));
  const segments = Array.isArray(alignment) ? alignment : alignment.segments || alignment.alignment || [];

  const byPage = {};
  for (const s of segments) {
    const page = getPageNumFromZoneId(s.id);
    if (page == null) continue;
    const start = Number(s.startTime) || 0;
    const end = Number(s.endTime) || start + 0.2;
    if (!byPage[page]) byPage[page] = { minStart: Infinity, maxEnd: -Infinity };
    if (start < byPage[page].minStart) byPage[page].minStart = start;
    if (end > byPage[page].maxEnd) byPage[page].maxEnd = end;
  }

  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
  if (pages.length === 0) {
    console.error('No page data found in alignment. IDs must match p<N>_z...');
    process.exit(1);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {}

  const ext = path.extname(audioAbs) || '.mp3';
  const results = [];

  for (const p of pages) {
    const { minStart, maxEnd } = byPage[p];
    const duration = Math.max(0.1, maxEnd - minStart);
    const outPath = path.join(outDir, `page_${p}${ext}`);
    const startStr = minStart.toFixed(3);
    const durStr = duration.toFixed(3);
    try {
      execSync(
        `ffmpeg -y -i "${audioAbs}" -ss ${startStr} -t ${durStr} -acodec copy "${outPath}"`,
        { stdio: 'pipe' }
      );
      console.log(`Page ${p}: ${startStr}s - ${maxEnd.toFixed(3)}s → ${path.basename(outPath)}`);
      results.push({ page: p, path: outPath, start: minStart, end: maxEnd });
    } catch (e) {
      console.error(`Failed to extract page ${p}:`, e.message);
    }
  }

  console.log(`\nCreated ${results.length} files in ${outDir}`);
  return results;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
Split audio into per-page segments using alignment timestamps.

Usage: node scripts/split-audio-per-page.cjs <audio-path> <alignment-json-path> [output-dir]

Example:
  node scripts/split-audio-per-page.cjs ./uploads/narration.mp3 ./alignment.json ./page-audio

Alignment JSON: from Sync Studio Save, or GET /api/kitaboo/sync-studio/:jobId → alignment array.
`);
  process.exit(1);
}

splitAudioPerPage(args[0], args[1], args[2]);
