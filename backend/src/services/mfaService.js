/**
 * Montreal Forced Aligner (MFA) for full Kitaboo stack.
 * Acoustic modeling (Kaldi-based) for millisecond-level alignment; use with custom G2P dictionary
 * to avoid "Fallback Score -1.00" on unique names (e.g. "Zog").
 *
 * Requires: pip install montreal-forced-aligner; download acoustic model + dictionary or use G2P.
 * Usage: USE_MFA=1 and MFA_ACOUSTIC_MODEL_PATH / MFA_DICTIONARY_PATH (or g2pService for OOV).
 */

import { execSync, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import g2pService from './g2pService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '../../temp/mfa');

async function ensureTempDir() {
  await fs.mkdir(tempDir, { recursive: true });
}

/**
 * Check if MFA is installed (mfa version).
 */
async function isMfaAvailable() {
  try {
    const out = execSync('mfa version', { encoding: 'utf8', timeout: 3000 });
    return (out || '').toLowerCase().includes('montreal') || (out || '').includes('mfa');
  } catch (_) {
    return false;
  }
}

/**
 * Align plain segments (id + text) to audio using MFA.
 * Creates temp corpus: one .wav + one .lab (or .txt) with transcript; runs mfa align; parses output.
 * @param {string} audioPath - Path to WAV (MFA prefers 16kHz mono)
 * @param {Array<{id: string, text: string}>} segments
 * @param {Object} options - { language, dictionaryPath, acousticModelPath }
 * @returns {Promise<Array<{id: string, startTime: number, endTime: number}>>}
 */
async function alignPlainSegments(audioPath, segments, options = {}) {
  const { language = 'eng', dictionaryPath, acousticModelPath } = options;
  const dictPath = dictionaryPath || process.env.MFA_DICTIONARY_PATH;
  const modelPath = acousticModelPath || process.env.MFA_ACOUSTIC_MODEL_PATH;
  if (!dictPath || !modelPath) {
    throw new Error('MFA requires MFA_DICTIONARY_PATH and MFA_ACOUSTIC_MODEL_PATH (or options.dictionaryPath / acousticModelPath)');
  }

  await ensureTempDir();
  const sessionId = uuidv4().slice(0, 8);
  const corpusDir = path.join(tempDir, `corpus_${sessionId}`);
  const outputDir = path.join(tempDir, `out_${sessionId}`);
  await fs.mkdir(corpusDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const baseName = 'utterance';
  const wavPath = path.join(corpusDir, `${baseName}.wav`);
  const labPath = path.join(corpusDir, `${baseName}.lab`);

  try {
    await fs.copyFile(audioPath, wavPath).catch(async () => {
      const { execSync: execSyncNode } = await import('child_process');
      execSyncNode(`ffmpeg -i "${audioPath}" -acodec pcm_s16le -ac 1 -ar 16000 -y "${wavPath}"`, { stdio: 'pipe' });
    });
  } catch (e) {
    throw new Error('MFA: failed to prepare WAV: ' + e.message);
  }

  const text = (segments || []).map((s) => (s.text || '').trim()).filter(Boolean).join(' ');
  await fs.writeFile(labPath, text, 'utf8');

  const cmd = `mfa align --output_format json "${corpusDir}" "${dictPath}" "${modelPath}" "${outputDir}"`;
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, async (err, stdout, stderr) => {
      try {
        if (err) {
          reject(new Error('MFA align failed: ' + (stderr || err.message)));
          return;
        }
        const jsonPath = path.join(outputDir, `${baseName}.json`);
        let data;
        try {
          const content = await fs.readFile(jsonPath, 'utf8');
          data = JSON.parse(content);
        } catch (e) {
          reject(new Error('MFA: could not read alignment JSON: ' + e.message));
          return;
        }

        const words = data.words || data.tiers?.words?.entries || [];
        const segmentTexts = (segments || []).map((s) => (s.text || '').trim()).filter(Boolean);
        const wordList = segmentTexts.flatMap((t) => t.split(/\s+/).filter(Boolean));
        const results = [];
        let wordIdx = 0;
        let currentSegmentIdx = 0;
        let segmentStart = null;
        let segmentEnd = null;
        let segmentWordCount = 0;
        const wordsPerSegment = segmentTexts.map((t) => t.split(/\s+/).filter(Boolean).length);

        for (const w of words) {
          const start = typeof w.start === 'number' ? w.start : parseFloat(w.start);
          const end = typeof w.end === 'number' ? w.end : parseFloat(w.end);
          if (currentSegmentIdx < segments.length && segmentWordCount === 0) segmentStart = start;
          segmentEnd = end;
          segmentWordCount++;
          const needed = wordsPerSegment[currentSegmentIdx] || 1;
          if (segmentWordCount >= needed && currentSegmentIdx < segments.length) {
            results.push({
              id: segments[currentSegmentIdx].id,
              startTime: Number((segmentStart ?? start).toFixed(3)),
              endTime: Number((segmentEnd ?? end).toFixed(3))
            });
            currentSegmentIdx++;
            segmentWordCount = 0;
            segmentStart = null;
          }
        }
        if (currentSegmentIdx < segments.length && segmentStart != null) {
          results.push({
            id: segments[currentSegmentIdx].id,
            startTime: Number(segmentStart.toFixed(3)),
            endTime: Number((segmentEnd ?? segmentStart + 0.2).toFixed(3))
          });
          currentSegmentIdx++;
        }
        while (currentSegmentIdx < segments.length) {
          const prev = results[results.length - 1];
          const end = prev ? prev.endTime : 0;
          results.push({
            id: segments[currentSegmentIdx].id,
            startTime: end,
            endTime: end + 0.2
          });
          currentSegmentIdx++;
        }

        await fs.rm(corpusDir, { recursive: true, force: true }).catch(() => {});
        await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
        resolve(results);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export const mfaService = {
  isMfaAvailable,
  alignPlainSegments
};

export default mfaService;
