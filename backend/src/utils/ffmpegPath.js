/**
 * ffmpegPath.js
 *
 * Resolves the ffmpeg and ffprobe binary paths and provides a helper to
 * build an augmented PATH string for child_process exec/execSync calls.
 *
 * Resolution order:
 *  1. FFMPEG_PATH env var (directory containing ffmpeg.exe / ffmpeg)
 *  2. Common Windows install locations
 *  3. Common Linux/macOS install locations
 *  4. Falls back to bare "ffmpeg" / "ffprobe" (relies on system PATH)
 *
 * Usage:
 *   import { ffmpegBin, ffprobeBin, getAugmentedEnv } from '../utils/ffmpegPath.js';
 *
 *   // Use explicit binary paths in commands:
 *   const cmd = `"${ffmpegBin}" -i "${input}" ...`;
 *
 *   // Or inject the ffmpeg directory into PATH for child processes:
 *   exec(cmd, { env: getAugmentedEnv() }, callback);
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const isWindows = os.platform() === 'win32';

/**
 * Candidate directories to search for ffmpeg binaries.
 * FFMPEG_PATH env var is checked first.
 */
function getCandidateDirs() {
  const candidates = [];

  // 1. Explicit env var (highest priority)
  if (process.env.FFMPEG_PATH) {
    candidates.push(process.env.FFMPEG_PATH);
  }

  if (isWindows) {
    // Common Windows install locations
    candidates.push(
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\Program Files (x86)\\ffmpeg\\bin',
      path.join(os.homedir(), 'ffmpeg', 'bin'),
      // Chocolatey / Scoop / winget typical paths
      'C:\\ProgramData\\chocolatey\\bin',
      path.join(os.homedir(), 'scoop', 'shims'),
      // WinGet Gyan.FFmpeg portable install (version-agnostic glob not supported here, so check common versions)
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.1.1-full_build', 'bin'),
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-7.1-full_build', 'bin'),
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-7.0-full_build', 'bin'),
    );

    // Also scan the WinGet Gyan.FFmpeg directory dynamically for any version
    try {
      const wingetGyanDir = path.join(
        os.homedir(),
        'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages',
        'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'
      );
      const entries = fs.readdirSync(wingetGyanDir);
      for (const entry of entries) {
        candidates.push(path.join(wingetGyanDir, entry, 'bin'));
      }
    } catch {
      // directory doesn't exist or can't be read — ignore
    }
  } else {
    // Linux / macOS
    candidates.push(
      '/usr/bin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/snap/bin',
    );
  }

  return candidates;
}

/**
 * Find the directory that contains the ffmpeg binary.
 * Returns null if not found in any candidate directory.
 */
function findFfmpegDir() {
  const binaryName = isWindows ? 'ffmpeg.exe' : 'ffmpeg';

  for (const dir of getCandidateDirs()) {
    try {
      const fullPath = path.join(dir, binaryName);
      if (fs.existsSync(fullPath)) {
        return dir;
      }
    } catch {
      // ignore access errors
    }
  }

  return null;
}

const _ffmpegDir = findFfmpegDir();

if (_ffmpegDir) {
  console.log(`[ffmpegPath] Found ffmpeg in: ${_ffmpegDir}`);
} else {
  console.warn(
    '[ffmpegPath] ffmpeg not found in any known location. ' +
    'Set FFMPEG_PATH in your .env to the directory containing ffmpeg (e.g. C:\\ffmpeg\\bin). ' +
    'Download from https://www.gyan.dev/ffmpeg/builds/'
  );
}

/**
 * Directory containing espeak-ng.exe or espeak.exe (Aeneas phoneme step).
 * Only used on Windows; returns null if not found.
 */
function findEspeakNgDir() {
  if (!isWindows) return null;
  const candidates = [];
  if (process.env.ESPEAK_PATH) {
    let p = process.env.ESPEAK_PATH;
    if (/\.exe$/i.test(p)) p = path.dirname(p);
    if (fs.existsSync(p)) candidates.push(p);
  }
  candidates.push(
    'C:\\Program Files\\eSpeak NG',
    'C:\\Program Files (x86)\\eSpeak NG',
    path.join(os.homedir(), 'scoop', 'shims'),
    path.join('C:', 'ProgramData', 'chocolatey', 'bin'),
  );
  for (const dir of candidates) {
    try {
      if (!dir || !fs.existsSync(dir)) continue;
      const ng = path.join(dir, 'espeak-ng.exe');
      const legacy = path.join(dir, 'espeak.exe');
      if (fs.existsSync(ng) || fs.existsSync(legacy)) return dir;
    } catch {
      // ignore
    }
  }
  return null;
}

const _espeakNgDir = findEspeakNgDir();
if (isWindows && _espeakNgDir) {
  console.log(`[ffmpegPath] Found eSpeak NG in: ${_espeakNgDir}`);
} else if (isWindows && !_espeakNgDir) {
  console.warn(
    '[ffmpegPath] eSpeak NG not found (Aeneas needs espeak-ng on PATH). ' +
      'Install from https://github.com/espeak-ng/espeak-ng/releases or set ESPEAK_PATH to its install folder.'
  );
}

/** Full path to the ffmpeg binary (quoted-safe for use in shell commands). */
export const ffmpegBin = _ffmpegDir
  ? path.join(_ffmpegDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg')
  : 'ffmpeg';

/** Full path to the ffprobe binary (quoted-safe for use in shell commands). */
export const ffprobeBin = _ffmpegDir
  ? path.join(_ffmpegDir, isWindows ? 'ffprobe.exe' : 'ffprobe')
  : 'ffprobe';

/** The resolved ffmpeg directory, or null if not found. */
export const ffmpegDir = _ffmpegDir;

/** Resolved eSpeak NG directory on Windows, or null. */
export const espeakNgDir = _espeakNgDir;

/**
 * Returns a process.env clone with the ffmpeg directory prepended to PATH.
 * Pass this as the `env` option to exec / execSync / spawn so that child
 * processes can find ffmpeg even when the system PATH doesn't include it.
 *
 * On Windows, also prepends eSpeak NG (required by Aeneas) and the user's
 * ~/bin shims folder (for the espeak → espeak-ng alias).
 *
 * @param {Object} [extra={}] - Additional env vars to merge in.
 * @returns {Object} Augmented environment object.
 */
export function getAugmentedEnv(extra = {}) {
  const currentPath = process.env.PATH || process.env.Path || '';

  const prefixDirs = _ffmpegDir ? [_ffmpegDir] : [];

  if (isWindows) {
    if (_espeakNgDir) prefixDirs.push(_espeakNgDir);
    // User shims: espeak.exe → espeak-ng.exe alias (only if present)
    if (process.env.USERPROFILE) {
      const userBin = path.join(process.env.USERPROFILE, 'bin');
      try {
        if (fs.existsSync(userBin)) prefixDirs.push(userBin);
      } catch {
        // ignore
      }
    }
  }

  const augmented = [...prefixDirs, currentPath].filter(Boolean).join(isWindows ? ';' : ':');

  return {
    ...process.env,
    ...extra,
    ...(isWindows && _espeakNgDir ? { ESPEAK_PATH: _espeakNgDir } : {}),
    PATH: augmented,
    ...(isWindows ? { Path: augmented } : {}),
  };
}
