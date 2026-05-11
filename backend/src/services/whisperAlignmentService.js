/**
 * Whisper-based alignment (Kitaboo-style alternative to Aeneas/MFA).
 * Uses Faster-Whisper transcription with word/segment timestamps, then fuzzy-maps
 * results back to p1_z1_s0 IDs. Better for long audio (e.g. 227s), accents, and dramatic narration.
 *
 * Strategy (Kitaboo-style):
 * 1. Transcribe full audio with Faster-Whisper (segment or word timestamps).
 * 2. Normalize XHTML text and Whisper text (lowercase, strip punctuation).
 * 3. Sliding-window fuzzy match: find run of Whisper segments that best matches
 *    each expected segment; assign start of first and end of last. Advance pointer
 *    after match so we don't "jump" (e.g. "Horse" on page 5 won't match page 1).
 * 4. Enforce chronology: clipBegin always increases; min duration 200ms (Kitaboo floor).
 * 5. Optional: apply silence snapping (via aeneasService.refinePlainSegmentResults).
 *
 * Fuzzy matching: built-in Levenshtein. For stronger matching, install optional
 * string-similarity and use compareTwoStrings in a pre-pass.
 *
 * Uses faster-whisper via backend/scripts/whisper_transcribe_wordlevel.py (backend/venv).
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ffprobeBin, getAugmentedEnv } from '../utils/ffmpegPath.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_ROOT = path.join(__dirname, '../..');
const VENV_PYTHON = path.join(BACKEND_ROOT, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
const WHISPER_SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'whisper_transcribe_wordlevel.py');
const WHISPERX_SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'whisperx_transcribe.py');

/** Lower: trust text when Whisper is unsure. Segment-level matching more permissive. */
const MIN_CONFIDENCE = 0.6;
const VIRTUAL_DURATION_MISSING = 0.05;
const MAX_WINDOW_SEGMENTS = 15;
/** Tighter: only accept confident word matches. Reduces false positives. */
const MIN_WORD_SIMILARITY = 0.8;
/** Kitaboo-style: 50ms min duration per highlight (reduced from 200ms for accuracy) */
const MIN_DURATION_SEC = 0.05;

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = 1 + Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]);
    }
  }
  return matrix[b.length][a.length];
}

function normalizeText(s) {
  return (String(s) || '')
    .toLowerCase()
    .replace(/[.,!?;:'"()\-–—…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWord(w) {
  return (w || '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// Fuzzy matching: built-in Levenshtein.
function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

function wordSimilarity(a, b) {
  const na = normalizeWord(a);
  const nb = normalizeWord(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

class WhisperAlignmentService {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp/whisper');
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (e) {}
  }

  /**
   * Check if faster-whisper is available via backend venv (pip install faster-whisper).
   */
  async isWhisperAvailable() {
    const pythonPath = VENV_PYTHON;
    try {
      const scriptExists = await fs.access(WHISPER_SCRIPT).then(() => true).catch(() => false);
      if (!scriptExists) {
        console.warn('[WhisperAlignment] Whisper not available: script missing at', WHISPER_SCRIPT);
        return false;
      }
      execSync(`"${pythonPath}" -c "import faster_whisper; print(1)"`, { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch (e) {
      const errMsg = e?.message || String(e);
      const stderr = (e?.stderr && e.stderr.toString()) || '';
      console.warn('[WhisperAlignment] Whisper not available:', errMsg, stderr ? `(stderr: ${stderr.slice(0, 200)})` : '', '| python:', pythonPath, '| script:', WHISPER_SCRIPT);
      return false;
    }
  }

  /**
   * Run faster-whisper via Python script; return parsed JSON (segments with start, end, text).
   */
  async transcribeWithTimestamps(audioPath, options = {}) {
    const useWhisperX = options.useWhisperX === true || process.env.USE_WHISPERX === '1';
    if (useWhisperX) {
      return this.transcribeWithWhisperX(audioPath, options);
    }
    const { language = 'en' } = options;
    const lang = language === 'eng' ? 'en' : language;
    const pythonPath = VENV_PYTHON;
    const scriptPath = WHISPER_SCRIPT;
    const cmd = `"${pythonPath}" "${scriptPath}" "${audioPath.replace(/"/g, '\\"')}" "${lang}"`;
    const env = { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' };
    const timeoutMs = parseInt(process.env.WHISPER_ALIGN_TIMEOUT_MS || '600000', 10);
    let stdout;
    try {
      stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env, timeout: timeoutMs });
    } catch (e) {
      const errMsg = (e.stderr || e.stdout || e.message || '').toString();
      throw new Error(`Whisper transcription failed: ${errMsg || e.message}`);
    }
    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch (e) {
      throw new Error(`Whisper JSON parse failed: ${e.message}`);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  /**
   * Run Whisper-X (transcribe + wav2vec2 phonemic alignment) for full Kitaboo stack.
   * Same output shape as transcribeWithTimestamps; use when USE_WHISPERX=1 for human narration.
   */
  async transcribeWithWhisperX(audioPath, options = {}) {
    const { language = 'en' } = options;
    const lang = language === 'eng' ? 'en' : language;
    const pythonPath = VENV_PYTHON;
    const scriptPath = WHISPERX_SCRIPT;
    try {
      await fs.access(scriptPath);
    } catch (_) {
      throw new Error('Whisper-X script not found at ' + scriptPath + '. Install whisperx and add whisperx_transcribe.py.');
    }
    const cmd = `"${pythonPath}" "${scriptPath}" "${audioPath.replace(/"/g, '\\"')}" "${lang}"`;
    const env = { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' };
    let stdout;
    try {
      stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env, timeout: 300000 });
    } catch (e) {
      const errMsg = (e.stderr || e.stdout || e.message || '').toString();
      throw new Error(`Whisper-X transcription failed: ${errMsg || e.message}`);
    }
    let data;
    try {
      data = JSON.parse(stdout.trim());
    } catch (e) {
      throw new Error(`Whisper-X JSON parse failed: ${e.message}`);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  /**
   * Flatten Whisper words from a run of segments into a single list with start/end.
   */
  _collectWhisperWordsInRun(segments, startIdx, endIdx) {
    const words = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const seg = segments[i];
      const list = seg?.words || [];
      for (const w of list) {
        const start = typeof w.start === 'number' ? w.start : parseFloat(w.start);
        const end = typeof w.end === 'number' ? w.end : parseFloat(w.end);
        words.push({ word: (w.word || '').trim(), start, end });
      }
    }
    return words.filter(w => w.word.length > 0);
  }

  /**
   * Map expected words (tokenized text) to Whisper words in range: 1:1 or proportional.
   * Returns array of { id, startTime, endTime } for words.
   */
  _mapWordsInRange(baseId, expectedWords, whisperWords) {
    const out = [];
    if (expectedWords.length === 0 || whisperWords.length === 0) return out;
    if (expectedWords.length === whisperWords.length) {
      expectedWords.forEach((_, i) => {
        const w = whisperWords[i];
        out.push({ id: `${baseId}_w${i + 1}`, startTime: Number(w.start.toFixed(3)), endTime: Number(w.end.toFixed(3)) });
      });
      return out;
    }
    const nExp = expectedWords.length;
    const nWh = whisperWords.length;
    for (let i = 0; i < nExp; i++) {
      const j0 = Math.min(Math.floor((i / nExp) * nWh), nWh - 1);
      let j1 = i === nExp - 1 ? nWh - 1 : Math.floor(((i + 1) / nExp) * nWh) - 1;
      if (j1 < j0) j1 = j0;
      j1 = Math.min(j1, nWh - 1);
      const start = whisperWords[j0].start;
      const end = whisperWords[j1].end;
      out.push({ id: `${baseId}_w${i + 1}`, startTime: Number(start.toFixed(3)), endTime: Number(Math.max(start + 0.01, end).toFixed(3)) });
    }
    return out;
  }

  /**
   * Find zone words as a subsequence in allWords (allows narrator fillers/gaps).
   * Returns { start, end, lastIdx } or null.
   */
  _findSubsequenceMatch(zoneWords, allWords, searchFrom) {
    if (zoneWords.length === 0 || searchFrom >= allWords.length) return null;
    const indices = [];
    let i = searchFrom;
    for (const zw of zoneWords) {
      let found = false;
      while (i < allWords.length) {
        const sim = wordSimilarity(zw, allWords[i].word);
        if (sim >= MIN_WORD_SIMILARITY) {
          indices.push(i);
          i++;
          found = true;
          break;
        }
        i++;
      }
      if (!found) return null;
    }
    if (indices.length < zoneWords.length) return null;
    const first = allWords[indices[0]];
    const last = allWords[indices[indices.length - 1]];
    const matchRatio = indices.length / zoneWords.length;
    return {
      start: first.start,
      end: last.end,
      lastIdx: indices[indices.length - 1],
      matchRatio
    };
  }

  /**
   * Word-first alignment: use Whisper word timestamps directly.
   * Subsequence matching allows narrator fillers ("um", "the") between zone words.
   */
  wordFirstMap(whisperSegments, expectedSegments, options = {}) {
    const segs = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    const allWords = [];
    for (const seg of segs) {
      for (const w of seg?.words || []) {
        const word = (w.word || '').trim();
        if (!word) continue;
        const start = typeof w.start === 'number' ? w.start : parseFloat(w.start);
        const end = typeof w.end === 'number' ? w.end : parseFloat(w.end);
        allWords.push({ word, start, end });
      }
    }
    if (allWords.length < 3) return null;

    const normalized = expectedSegments
      .map(s => ({ id: s.id, text: (s.text || '').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => {
        const parseId = (id) => {
          const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
          if (!m) {
            const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
            if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
            return { p: 999, z: 999, s: 999, w: 999 };
          }
          return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
        };
        const da = parseId(a.id);
        const db = parseId(b.id);
        return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
      });
    if (normalized.length === 0) return null;

    const results = [];
    let searchFrom = 0;

    for (const exp of normalized) {
      const zoneWords = (exp.text || '').split(/\s+/).filter(Boolean);
      if (zoneWords.length === 0) {
        const prevEnd = results.length ? results[results.length - 1].endTime : 0;
        results.push({ id: exp.id, startTime: prevEnd, endTime: prevEnd + MIN_DURATION_SEC });
        continue;
      }

      let match = this._findSubsequenceMatch(zoneWords, allWords, searchFrom);
      if (!match && zoneWords.length >= 2) {
        for (let tryFrom = searchFrom; tryFrom < Math.min(searchFrom + 50, allWords.length - zoneWords.length); tryFrom++) {
          let matchCount = 0;
          let totalSim = 0;
          let endIdx = -1;
          for (let j = 0; j < zoneWords.length && tryFrom + j < allWords.length; j++) {
            const sim = wordSimilarity(zoneWords[j], allWords[tryFrom + j].word);
            if (sim >= MIN_WORD_SIMILARITY) {
              matchCount++;
              totalSim += sim;
              endIdx = tryFrom + j;
            }
          }
          if (matchCount >= Math.ceil(zoneWords.length * 0.5)) {
            match = {
              start: allWords[tryFrom].start,
              end: allWords[endIdx].end,
              lastIdx: endIdx,
              matchRatio: matchCount / zoneWords.length
            };
            break;
          }
        }
      }
      const prevEnd = results.length ? results[results.length - 1].endTime : 0;

      if (match) {
        const start = Math.max(match.start, prevEnd);
        const end = Math.max(match.end, start + MIN_DURATION_SEC);
        results.push({ id: exp.id, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
        searchFrom = match.lastIdx + 1;
      } else {
        results.push({
          id: exp.id,
          startTime: Number(prevEnd.toFixed(3)),
          endTime: Number((prevEnd + MIN_DURATION_SEC).toFixed(3))
        });
      }
    }

    const guarded = [];
    let prev = 0;
    for (const r of results) {
      const start = Math.max(r.startTime, prev);
      const end = Math.max(r.endTime, start + MIN_DURATION_SEC);
      guarded.push({ ...r, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
      prev = end;
    }
    return guarded;
  }

  /**
   * Anchor-based alignment: find unique words in zones, match in Whisper, use as anchors,
   * then rubber-band the rest. Best when fuzzy match yields few results but narration follows text.
   */
  anchorBasedMap(whisperSegments, expectedSegments, options = {}) {
    const segs = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    const allWords = [];
    for (const seg of segs) {
      for (const w of seg?.words || []) {
        const word = (w.word || '').trim();
        if (!word) continue;
        const start = typeof w.start === 'number' ? w.start : parseFloat(w.start);
        const end = typeof w.end === 'number' ? w.end : parseFloat(w.end);
        allWords.push({ word, start, end });
      }
    }
    if (allWords.length < 5) return null;

    const normalized = expectedSegments
      .map(s => ({ id: s.id, text: (s.text || '').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => {
        const parseId = (id) => {
          const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
          if (!m) {
            const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
            if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
            return { p: 999, z: 999, s: 999, w: 999 };
          }
          return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
        };
        const da = parseId(a.id);
        const db = parseId(b.id);
        return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
      });
    if (normalized.length < 3) return null;

    const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'by', 'from']);
    const ANCHOR_SIMILARITY = 0.85;

    const lastSeg = segs[segs.length - 1];
    const audioEnd = typeof lastSeg?.end === 'number' ? lastSeg.end : parseFloat(lastSeg?.end || '0');
    const nZones = normalized.length;

    const anchors = [];
    let whisperIdx = 0;
    for (let zi = 0; zi < nZones; zi++) {
      const words = (normalized[zi].text || '').split(/\s+/).filter(Boolean);
      const maxTime = ((zi + 2) / nZones) * audioEnd * 1.2;
      for (const w of words) {
        const nw = normalizeWord(w);
        if (nw.length < 4 || STOPWORDS.has(nw)) continue;
        for (let wi = whisperIdx; wi < allWords.length; wi++) {
          const t = allWords[wi].start;
          if (t > maxTime) break;
          if (wordSimilarity(w, allWords[wi].word) >= ANCHOR_SIMILARITY) {
            anchors.push({ zoneIdx: zi, time: t, whisperIdx: wi });
            whisperIdx = wi + 1;
            break;
          }
        }
      }
    }
    const uniqueAnchors = [];
    const seen = new Set();
    for (const a of anchors) {
      if (seen.has(a.zoneIdx)) continue;
      seen.add(a.zoneIdx);
      uniqueAnchors.push(a);
    }
    if (uniqueAnchors.length < 2) return null;

    const n = normalized.length;
    const results = [];
    const a0 = uniqueAnchors[0];
    const aLast = uniqueAnchors[uniqueAnchors.length - 1];

    for (let i = 0; i < n; i++) {
      const exp = normalized[i];
      let startTime;
      let endTime;
      if (i <= a0.zoneIdx) {
        const count = a0.zoneIdx + 1;
        const segDur = a0.time / count;
        startTime = (i / count) * a0.time;
        endTime = ((i + 1) / count) * a0.time;
      } else if (i >= aLast.zoneIdx) {
        const count = n - aLast.zoneIdx;
        const span = audioEnd - aLast.time;
        const localIdx = i - aLast.zoneIdx;
        startTime = aLast.time + (localIdx / count) * span;
        endTime = aLast.time + ((localIdx + 1) / count) * span;
      } else {
        let aPrev = a0;
        let aNext = aLast;
        for (let k = 0; k < uniqueAnchors.length - 1; k++) {
          if (uniqueAnchors[k].zoneIdx <= i && uniqueAnchors[k + 1].zoneIdx >= i) {
            aPrev = uniqueAnchors[k];
            aNext = uniqueAnchors[k + 1];
            break;
          }
        }
        const span = Math.max(1, aNext.zoneIdx - aPrev.zoneIdx);
        const localIdx = i - aPrev.zoneIdx;
        const segSpan = (aNext.time - aPrev.time) / span;
        startTime = aPrev.time + (localIdx / span) * (aNext.time - aPrev.time);
        endTime = aPrev.time + ((localIdx + 1) / span) * (aNext.time - aPrev.time);
      }
      const prevEnd = results.length ? results[results.length - 1].endTime : 0;
      const start = Math.max(startTime, prevEnd);
      const end = Math.max(endTime, start + MIN_DURATION_SEC);
      results.push({ id: exp.id, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
    }
    console.log(`[WhisperAlignment] Anchor-based: ${uniqueAnchors.length} anchors, rubber-banded ${normalized.length} zones`);
    return results;
  }

  /**
   * Text-first alignment: slide through Whisper transcript forward-only,
   * picking the best matching run for each expected segment. If no good
   * match, assign a short virtual slot after the last end. Ensures
   * monotonic timeline with minimum duration.
   */
  textFirstMap(whisperSegments, expectedSegments, options = {}) {
    const { minConfidence = MIN_CONFIDENCE, includeWords = true } = options;
    const normalized = expectedSegments
      .map(s => ({ id: s.id, text: (s.text || '').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => {
        const parseId = (id) => {
          const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
          if (!m) {
            const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
            if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
            return { p: 999, z: 999, s: 999, w: 999 };
          }
          return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
        };
        const da = parseId(a.id);
        const db = parseId(b.id);
        return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
      });
    if (normalized.length === 0) return [];

    const segs = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    if (segs.length === 0) return normalized.map((s, i) => ({
      id: s.id,
      startTime: i * VIRTUAL_DURATION_MISSING,
      endTime: (i + 1) * VIRTUAL_DURATION_MISSING
    }));

    const results = [];
    let wIndex = 0;
    let lastEnd = 0;
    const MIN_DUR = MIN_DURATION_SEC; // Kitaboo: 200ms floor to prevent flicker

    for (const exp of normalized) {
      let bestScore = -1;
      let bestStart = 0;
      let bestEnd = 0;
      let bestEndIdx = wIndex;

      // Search forward only (no backtracking)
      for (let runEnd = wIndex; runEnd < segs.length; runEnd++) {
        const runText = segs.slice(wIndex, runEnd + 1)
          .map(w => (w.text || '').trim())
          .filter(Boolean)
          .join(' ');
        if (!runText) continue;
        const score = similarity(exp.text, runText);
        if (score > bestScore) {
          bestScore = score;
          const first = segs[wIndex];
          const last = segs[runEnd];
          const start = typeof first.start === 'number' ? first.start : parseFloat(first.start);
          const end = typeof last.end === 'number' ? last.end : parseFloat(last.end);
          bestStart = start;
          bestEnd = end;
          bestEndIdx = runEnd;
        }
      }

      if (bestScore < minConfidence) {
        // No good match: assign a short virtual slot after lastEnd
        const start = lastEnd;
        const end = start + MIN_DUR;
        results.push({ id: exp.id, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)), confidence: bestScore });
        lastEnd = end;
      } else {
        // Use best match and advance pointer
        const runStartIdx = wIndex;
        wIndex = bestEndIdx + 1;
        const start = Math.max(bestStart, lastEnd);
        const end = Math.max(bestEnd, start + MIN_DUR);
        results.push({ id: exp.id, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)), confidence: bestScore });
        lastEnd = end;

        if (includeWords) {
          const whisperWordsInRun = this._collectWhisperWordsInRun(segs, runStartIdx, bestEndIdx);
          const expectedWords = (exp.text || '').split(/\s+/).filter(Boolean);
          if (whisperWordsInRun.length > 0 && expectedWords.length > 0) {
            const wordResults = this._mapWordsInRange(exp.id, expectedWords, whisperWordsInRun);
            wordResults.forEach(wr => {
              const ws = Math.max(wr.startTime, start);
              const we = Math.min(wr.endTime, end);
              wr.startTime = Number(ws.toFixed(3));
              wr.endTime = Number(Math.max(ws + 0.05, we).toFixed(3));
              results.push(wr);
            });
          }
        }
      }
    }

    // Final monotonic guard + min duration (Kitaboo: clipBegin always increases, 200ms floor)
    const guarded = [];
    let prevEnd = 0;
    for (const r of results) {
      const start = Math.max(r.startTime, prevEnd);
      const end = Math.max(r.endTime, start + MIN_DURATION_SEC);
      guarded.push({ ...r, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
      prevEnd = end;
    }
    return guarded;
  }

  /**
   * Proportional distribution: when fuzzy matching fails, distribute Whisper segments
   * across expected segments based on position/reading order (Option 1: Whisper as source of truth).
   */
  _proportionalDistribution(whisperSegments, expectedSegments) {
    const segments = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    if (segments.length === 0 || expectedSegments.length === 0) return [];
    
    const results = [];
    const nExpected = expectedSegments.length;
    const nWhisper = segments.length;
    
    // Sort expected segments by reading order to ensure correct proportional mapping
    const sortedExpected = [...expectedSegments].sort((a, b) => {
      // Extract page number and reading order from ID (e.g. p1_z1_s0)
      const parseId = (id) => {
        const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
        if (!m) {
          // Check for word-level IDs (e.g. p1_z1_w0)
          const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
          if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
          return { p: 999, z: 999, s: 999, w: 999 };
        }
        return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
      };
      const da = parseId(a.id);
      const db = parseId(b.id);
      return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
    });

    console.log(`[WhisperAlignment] Proportional distribution: ${nWhisper} Whisper segments → ${nExpected} expected zones`);
    
    // Validate Whisper segments cover full audio duration
    if (nWhisper > 0) {
      const lastSeg = segments[nWhisper - 1];
      const lastEnd = typeof lastSeg.end === 'number' ? lastSeg.end : parseFloat(lastSeg.end);
      const firstStart = typeof segments[0].start === 'number' ? segments[0].start : parseFloat(segments[0].start);
      console.log(`[WhisperAlignment] Whisper segments span ${firstStart.toFixed(2)}s - ${lastEnd.toFixed(2)}s`);
    }
    
    for (let i = 0; i < nExpected; i++) {
      const exp = sortedExpected[i];
      
      // Calculate proportional position in Whisper segments (0.0 to 1.0)
      const ratio = i / nExpected;
      const nextRatio = (i + 1) / nExpected;
      
      // Map to Whisper segment indices (continuous mapping)
      const whisperStartIdx = Math.min(Math.floor(ratio * nWhisper), nWhisper - 1);
      const whisperEndIdx = Math.min(Math.floor(nextRatio * nWhisper), nWhisper - 1);
      
      // Get start time from first Whisper segment in range
      const startSeg = segments[whisperStartIdx];
      let startTime = typeof startSeg.start === 'number' ? startSeg.start : parseFloat(startSeg.start);
      
      // Get end time from last Whisper segment in range
      let endTime;
      if (whisperStartIdx === whisperEndIdx) {
        // Multiple expected segments map to same Whisper segment: split proportionally
        const seg = segments[whisperStartIdx];
        const segStart = typeof seg.start === 'number' ? seg.start : parseFloat(seg.start);
        const segEnd = typeof seg.end === 'number' ? seg.end : parseFloat(seg.end);
        const segDuration = segEnd - segStart;
        
        // Calculate how many expected segments map to this Whisper segment
        let countInThisSeg = 0;
        for (let k = 0; k < nExpected; k++) {
          if (Math.min(Math.floor((k / nExpected) * nWhisper), nWhisper - 1) === whisperStartIdx) {
            countInThisSeg++;
          }
        }
        // Calculate local index within those that map to this segment
        let localIdx = 0;
        for (let k = 0; k < i; k++) {
          if (Math.min(Math.floor((k / nExpected) * nWhisper), nWhisper - 1) === whisperStartIdx) {
            localIdx++;
          }
        }
        
        const subDuration = segDuration / Math.max(1, countInThisSeg);
        startTime = segStart + (localIdx * subDuration);
        endTime = segStart + ((localIdx + 1) * subDuration);
      } else {
        // Expected segment spans multiple Whisper segments: use start of next segment as end
        const endSeg = segments[whisperEndIdx];
        endTime = typeof endSeg.start === 'number' ? endSeg.start : parseFloat(endSeg.start);
        
        // If this is the last expected segment, use the end of the last Whisper segment instead
        if (i === nExpected - 1) {
          const lastSeg = segments[nWhisper - 1];
          endTime = typeof lastSeg.end === 'number' ? lastSeg.end : parseFloat(lastSeg.end);
        }
      }
      
      results.push({
        id: exp.id,
        startTime: Number(startTime.toFixed(3)),
        endTime: Number(Math.max(startTime + 0.01, endTime).toFixed(3))
      });
    }
    
    // Validate results span expected duration
    if (results.length > 0) {
      const firstStart = results[0].startTime;
      const lastEnd = results[results.length - 1].endTime;
      console.log(`[WhisperAlignment] Proportional distribution result: ${firstStart.toFixed(2)}s - ${lastEnd.toFixed(2)}s (${(lastEnd - firstStart).toFixed(2)}s total)`);
    }
    
    return results;
  }

  /**
   * Linear spread across full Whisper duration (monotonic, no overlap).
   * Uses text length weighting to allocate time slices. Ensures strictly
   * increasing start/end so highlights follow the audio even when text
   * does not match narration (last-resort fallback).
   */
  _linearSpreadByLength(whisperSegments, expectedSegments) {
    const segments = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    if (segments.length === 0 || expectedSegments.length === 0) return [];

    const sortedExpected = [...expectedSegments];
    // Total duration from Whisper (fallback if missing: use 1s per segment)
    const totalDuration = (() => {
      const last = segments[segments.length - 1];
      const end = typeof last?.end === 'number' ? last.end : parseFloat(last?.end || '0');
      return Number.isFinite(end) && end > 0 ? end : expectedSegments.length * 1.0;
    })();

    // Weight by text length (at least 1)
    const weights = sortedExpected.map(s => Math.max(1, (s.text || '').split(/\s+/).filter(Boolean).join(' ').length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let cumulative = 0;
    const results = [];
    for (let i = 0; i < sortedExpected.length; i++) {
      const w = weights[i];
      const startRatio = cumulative / totalWeight;
      cumulative += w;
      const endRatio = cumulative / totalWeight;
      const startTime = startRatio * totalDuration;
      const endTime = Math.max(startTime + 0.05, endRatio * totalDuration); // min 50ms
      results.push({
        id: sortedExpected[i].id,
        startTime: Number(startTime.toFixed(3)),
        endTime: Number(endTime.toFixed(3))
      });
    }

    console.log(`[WhisperAlignment] Linear spread fallback: ${results.length} segments over ${totalDuration.toFixed(2)}s (text-length weighted, monotonic)`);
    return results;
  }

  /**
   * Map expected segments (id + text) to Whisper segments using sliding-window run matching.
   * Hierarchical: sentence-level first, then word-level from Whisper words within that run.
   * Advance pointer after each match (no drift; "If You Were a Horse" won't match page 1).
   * 
   * If fuzzy matching fails for most segments (mismatch between narration and zone text),
   * falls back to proportional distribution using Whisper's timings as source of truth.
   */
  mapWhisperToSegments(whisperSegments, expectedSegments, options = {}) {
    const { minConfidence = MIN_CONFIDENCE, maxWindow = MAX_WINDOW_SEGMENTS, includeWords = true } = options;
    const normalized = expectedSegments
      .map(s => ({ id: s.id, text: (s.text || '').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => {
        // Ensure segments are in reading order for sliding window
        const parseId = (id) => {
          const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
          if (!m) {
            // Check for word-level IDs (e.g. p1_z1_w0)
            const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
            if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
            return { p: 999, z: 999, s: 999, w: 999 };
          }
          return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
        };
        const da = parseId(a.id);
        const db = parseId(b.id);
        return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
      });
    if (normalized.length === 0) return [];

    const segments = Array.isArray(whisperSegments) ? whisperSegments : (whisperSegments?.segments ?? []);
    if (segments.length === 0) return normalized.map(s => ({ id: s.id, startTime: 0, endTime: VIRTUAL_DURATION_MISSING }));

    const hasWordTimestamps = segments.some(s => s.words && s.words.length > 0);
    const expectedCount = normalized.length;

    // Word-first uses Whisper word timestamps directly - more accurate for human narration
    if (hasWordTimestamps) {
      const wordFirst = this.wordFirstMap(segments, normalized, options);
      const matched = wordFirst?.filter(r => (r.endTime - r.startTime) > 0.1).length ?? 0;
      // When < 40% matched, try anchor-based (position-constrained to avoid wrong matches)
      if (matched < expectedCount * 0.4 && matched < 25) {
        const anchorResult = this.anchorBasedMap(segments, normalized, options);
        if (anchorResult && anchorResult.length > 0) {
          return anchorResult;
        }
      }
      if (wordFirst && wordFirst.length > 0 && matched >= Math.min(3, expectedCount * 0.3)) {
        console.log(`[WhisperAlignment] Using word-first alignment (${expectedCount} zones, ${matched} matched)`);
        return wordFirst;
      }
    }

    // Fallback: text-first segment matching.
    const textFirst = this.textFirstMap(segments, normalized, { minConfidence, includeWords });
    if (textFirst && textFirst.length > 0) return textFirst;

    // Last-resort: proportional distribution by text length
    console.log('[WhisperAlignment] Falling back to proportional distribution (text-first yielded no results)');
    return this._linearSpreadByLength(segments, normalized);
  }

  /**
   * Redistribute collapsed segments: when many zones failed to match and got virtual slots
   * stacked at the end, spread them proportionally from last good segment to audio end.
   */
  redistributeCollapsedSegments(results, normalized, audioPath, knownDuration) {
    try {
      if (!results || results.length < 2) return results;
      console.log('[WhisperAlignment] Redistributing collapsed segments...');
      const textById = Object.fromEntries((normalized || []).map(s => [s.id, s.text || '']));
      let audioDuration = knownDuration && knownDuration > 0 ? knownDuration : 0;
      if (!(audioDuration > 0)) {
        try {
          const out = execSync(
            `"${ffprobeBin}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
            { encoding: 'utf8', timeout: 5000, env: getAugmentedEnv() }
          ).trim();
          audioDuration = parseFloat(out) || 0;
        } catch (_) {
          const lastEnd = results.length ? Math.max(...results.map(r => r.endTime || 0)) : 0;
          audioDuration = Math.max(lastEnd + 10, 60);
          console.warn('[WhisperAlignment] ffprobe failed, using fallback duration:', audioDuration.toFixed(1), 's');
        }
      }
      if (!(audioDuration > 0)) return results;

      const COLLAPSED_DUR = 0.15;
      const MIN_RUN = 3;
      const out = [...results];
      let i = 0;
      while (i < out.length) {
        while (i < out.length && ((out[i].endTime || 0) - (out[i].startTime || 0)) >= COLLAPSED_DUR) i++;
        if (i >= out.length) break;
        const runStart = i;
        while (i < out.length && ((out[i].endTime || 0) - (out[i].startTime || 0)) < COLLAPSED_DUR) i++;
        const runLen = i - runStart;
        if (runLen < MIN_RUN) continue;

        const lastGoodEnd = runStart > 0 ? out[runStart - 1].endTime : 0;
        const remTime = Math.max(1, audioDuration - lastGoodEnd);
        const weights = [];
        for (let j = runStart; j < i; j++) {
          const text = textById[out[j].id] || '';
          weights.push(Math.max(1, text.split(/\s+/).filter(Boolean).length));
        }
        const totalW = weights.reduce((a, b) => a + b, 0) || 1;
        let cum = 0;
        for (let j = runStart; j < i; j++) {
          const w = weights[j - runStart];
          const startRatio = cum / totalW;
          cum += w;
          const endRatio = cum / totalW;
          const start = lastGoodEnd + startRatio * remTime;
          const end = Math.max(start + 0.05, lastGoodEnd + endRatio * remTime);
          out[j] = { ...out[j], startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) };
        }
        console.log(`[WhisperAlignment] Redistributed ${runLen} collapsed segments from ${lastGoodEnd.toFixed(1)}s to ${audioDuration.toFixed(1)}s`);
      }
      return out;
    } catch (e) {
      console.warn('[WhisperAlignment] Redistribution failed, using raw results:', e.message);
      return results;
    }
  }

  /**
   * Align audio to expected segments using Whisper + fuzzy matching.
   * Same contract as aeneasService.alignPlainSegments: returns [{ id, startTime, endTime }].
   */
  async alignPlainSegments(audioPath, segments, options = {}) {
    const { language = 'en' } = options;
    if (!segments || segments.length === 0) return [];

    const available = await this.isWhisperAvailable();
    if (!available) {
      throw new Error('Whisper is not installed. Install with: pip install openai-whisper');
    }

    const normalized = segments
      .map(s => ({ id: s.id, text: (s.text || '').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => {
        // Ensure segments are in reading order for alignment
        const parseId = (id) => {
          const m = String(id).match(/^p(\d+)_z(\d+)(?:_s(\d+))?/);
          if (!m) {
            // Check for word-level IDs (e.g. p1_z1_w0)
            const mw = String(id).match(/^p(\d+)_z(\d+)_w(\d+)/);
            if (mw) return { p: parseInt(mw[1]), z: parseInt(mw[2]), s: 0, w: parseInt(mw[3]) };
            return { p: 999, z: 999, s: 999, w: 999 };
          }
          return { p: parseInt(m[1]), z: parseInt(m[2]), s: parseInt(m[3] || 0), w: 0 };
        };
        const da = parseId(a.id);
        const db = parseId(b.id);
        return da.p - db.p || da.z - db.z || da.s - db.s || (da.w - db.w);
      });
    if (normalized.length === 0) return [];

    const langMap = { eng: 'en', en: 'en' };
    const whisperLang = langMap[language] || language;

    console.log('[WhisperAlignment] Transcribing with Whisper (timestamped mode)...');
    const data = await this.transcribeWithTimestamps(audioPath, { language: whisperLang });

    const whisperSegments = data.segments || [];
    const hasWords = whisperSegments.some(s => s.words && s.words.length > 0);
    console.log(`[WhisperAlignment] Got ${whisperSegments.length} segments from Whisper (word timestamps: ${hasWords ? 'yes' : 'no'})`);

    // Validate Whisper segments cover full audio duration
    if (whisperSegments.length > 0) {
      const lastEnd = typeof whisperSegments[whisperSegments.length - 1].end === 'number' 
        ? whisperSegments[whisperSegments.length - 1].end 
        : parseFloat(whisperSegments[whisperSegments.length - 1].end);
      
      try {
        const audioDurationStr = execSync(
          `"${ffprobeBin}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
          { encoding: 'utf8', timeout: 10000, env: getAugmentedEnv() }
        ).trim();
        const audioDuration = parseFloat(audioDurationStr);
        
        if (!isNaN(audioDuration) && lastEnd < audioDuration * 0.8) {
          console.warn(`[WhisperAlignment] ⚠️  Whisper segments end at ${lastEnd.toFixed(2)}s but audio is ${audioDuration.toFixed(2)}s. This may cause compressed SMIL timings.`);
        }
      } catch (e) {
        // ffprobe not available or failed, skip validation
      }
    }

    let results = this.mapWhisperToSegments(whisperSegments, normalized, { minConfidence: MIN_CONFIDENCE, includeWords: true });
    const whisperLastEnd = whisperSegments.length
      ? (typeof whisperSegments[whisperSegments.length - 1].end === 'number'
          ? whisperSegments[whisperSegments.length - 1].end
          : parseFloat(whisperSegments[whisperSegments.length - 1].end))
      : 0;
    results = this.redistributeCollapsedSegments(results, normalized, audioPath, whisperLastEnd || undefined);

    const sentenceCount = results.filter(r => !/_w\d+$/.test(String(r.id || ''))).length;
    const wordCount = results.length - sentenceCount;

    const lowConfidenceCount = normalized.filter((_, i) => {
      return results[i] && results[i].startTime === 0 && results[i].endTime === VIRTUAL_DURATION_MISSING;
    }).length;
    const isProportional = (lowConfidenceCount / normalized.length) > 0.5;

    console.log(`[WhisperAlignment] Mapped ${sentenceCount} sentences + ${wordCount} words (${isProportional ? 'proportional distribution' : 'sliding-window fuzzy match'})`);
    return results;
  }
}

const whisperAlignmentService = new WhisperAlignmentService();
export { WhisperAlignmentService, whisperAlignmentService };
