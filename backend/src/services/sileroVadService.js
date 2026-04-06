/**
 * Silero VAD (Voice Activity Detection) for full Kitaboo stack.
 * Pre-process: identify every millisecond of silence so SMIL never starts a highlight inside silence.
 * Prevents flicker during narrator's breath.
 *
 * Usage: Run silero_vad.py on audio; pass silence_periods to SMIL normalizer so clipBegin
 * is clamped to end of silence (never inside a silence zone).
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '../..');
const VENV_PYTHON = path.join(BACKEND_ROOT, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
const SILERO_SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'silero_vad.py');

/**
 * Check if Silero VAD is available (torch + silero-vad).
 */
async function isSileroAvailable() {
  try {
    const scriptExists = await fs.access(SILERO_SCRIPT).then(() => true).catch(() => false);
    if (!scriptExists) return false;
    const pythonPath = process.env.SILERO_PYTHON || VENV_PYTHON;
    execSync(`"${pythonPath}" -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True)"`, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Run Silero VAD on audio file; return { silence_periods, speech_periods, duration_sec }.
 * @param {string} audioPath - Path to WAV/MP3 (Silero expects 16kHz; script may resample via read_audio).
 * @param {number} minSilenceDurationSec - Minimum gap to count as silence (default 0.03).
 * @returns {Promise<{ silence_periods: Array<{start, end}>, speech_periods: Array<{start, end}>, duration_sec: number }>}
 */
async function getSilencePeriods(audioPath, minSilenceDurationSec = 0.03) {
  const pythonPath = process.env.SILERO_PYTHON || VENV_PYTHON;
  const cmd = `"${pythonPath}" "${SILERO_SCRIPT}" "${audioPath.replace(/"/g, '\\"')}" "${minSilenceDurationSec}"`;
  const env = { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' };
  let stdout;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env, timeout: 120000 });
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || '').toString();
    throw new Error(`Silero VAD failed: ${err || e.message}`);
  }
  const data = JSON.parse(stdout.trim());
  if (data.error) throw new Error(data.error);
  return {
    silence_periods: data.silence_periods || [],
    speech_periods: data.speech_periods || [],
    duration_sec: data.duration_sec || 0
  };
}

/**
 * Clamp fragment start times so no clipBegin falls inside a silence zone (Kitaboo constraint).
 * If startTime is inside [s.start, s.end], snap to s.end (start of speech).
 * Preserves monotonicity and min duration after clamping.
 * @param {Array<{id, startTime, endTime}>} fragments
 * @param {Array<{start, end}>} silencePeriods
 * @param {number} minDurationSec
 * @returns {Array<{id, startTime, endTime}>}
 */
function clampFragmentStartsOutOfSilence(fragments, silencePeriods, minDurationSec = 0.2) {
  if (!silencePeriods || silencePeriods.length === 0) return fragments;

  const out = [];
  let prevEnd = 0;
  for (const f of fragments) {
    let start = parseFloat(f.startTime);
    let end = parseFloat(f.endTime);
    const insideSilence = silencePeriods.find(s => start >= s.start && start < s.end);
    if (insideSilence) {
      start = insideSilence.end;
      if (end <= start) end = start + minDurationSec;
    }
    start = Math.max(start, prevEnd);
    end = Math.max(end, start + minDurationSec);
    out.push({ ...f, startTime: Number(start.toFixed(3)), endTime: Number(end.toFixed(3)) });
    prevEnd = end;
  }
  return out;
}

export const sileroVadService = {
  isSileroAvailable,
  getSilencePeriods,
  clampFragmentStartsOutOfSilence
};

export default sileroVadService;
