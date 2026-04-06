/**
 * G2P (Grapheme-to-Phoneme) for full Kitaboo stack.
 * Custom phonetic dictionary + OOV fallback (espeak-ng) so MFA doesn't fail on unknown words
 * (e.g. "Zog", "Fallback Score -1.00").
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let customDict = null;
let customDictPath = null;

/**
 * Load custom dictionary: one word per line, "word\tphonemes" (MFA format) or "word" (we'll G2P on demand).
 * @param {string} dictPath - Path to dictionary file
 */
async function loadDictionary(dictPath) {
  if (!dictPath) {
    customDict = null;
    customDictPath = null;
    return;
  }
  try {
    const content = await fs.readFile(dictPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    customDict = new Map();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 1) {
        const word = parts[0].toLowerCase();
        const phonemes = parts.length >= 2 ? parts.slice(1).join(' ') : null;
        customDict.set(word, phonemes);
      }
    }
    customDictPath = dictPath;
    return customDict;
  } catch (e) {
    console.warn('[G2P] Could not load dictionary:', dictPath, e.message);
    customDict = null;
    customDictPath = null;
    return null;
  }
}

/**
 * Get phonemes for a word: custom dict first, then espeak-ng OOV fallback.
 * @param {string} word - Single word
 * @param {string} language - Language code (e.g. en, eng)
 * @returns {Promise<string|null>} Phoneme string or null
 */
async function getPhonemes(word, language = 'en') {
  const w = (word || '').trim().toLowerCase();
  if (!w) return null;
  if (customDict && customDict.has(w)) {
    const p = customDict.get(w);
    if (p) return p;
  }
  const lang = language === 'eng' ? 'en' : language;
  const safe = w.replace(/"/g, '\\"');
  for (const cmd of [`espeak-ng -x -q --ipa -v ${lang} "${safe}"`, `espeak -x -q --ipa -v ${lang} "${safe}"`]) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
      const phonemes = (out || '').trim().replace(/\s+/g, ' ');
      if (phonemes) return phonemes;
    } catch (_) {}
  }
  return null;
}

/**
 * Generate MFA-format dictionary content from word list (custom dict + OOV via espeak).
 * @param {string[]} words - Unique words
 * @param {string} language
 * @returns {Promise<string>} "word\tphonemes" lines
 */
async function generateMfaDictionary(words, language = 'en') {
  const seen = new Set();
  const lines = [];
  for (const w of words) {
    const key = (w || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let phonemes = customDict && customDict.get(key);
    if (!phonemes) phonemes = await getPhonemes(key, language);
    if (phonemes) lines.push(`${key}\t${phonemes}`);
    else lines.push(`${key}\t${key}`);
  }
  return lines.join('\n');
}

export const g2pService = {
  loadDictionary,
  getPhonemes,
  generateMfaDictionary,
  get customDictPath() { return customDictPath; }
};

export default g2pService;
