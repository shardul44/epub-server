/**
 * Zone Text Sanitizer — KITABOO-style dictionary-based correction.
 *
 * Applies replacement rules to zone text before alignment so the aligner
 * "hears" the right words (fix OCR errors, proper nouns, technical terms).
 *
 * Config: backend/config/zone_text_replacements.json
 *   { "replacements": [ { "from": "Blazernan", "to": "Blazeman" }, ... ] }
 *
 * Or env ZONE_TEXT_REPLACEMENTS (JSON): [{"from":"X","to":"Y"},...]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let rulesCache = null;

async function loadRules() {
  if (rulesCache) return rulesCache;
  const configPath = path.join(__dirname, '../../config/zone_text_replacements.json');
  try {
    const raw = process.env.ZONE_TEXT_REPLACEMENTS;
    if (raw) {
      const parsed = JSON.parse(raw);
      rulesCache = Array.isArray(parsed) ? parsed : (parsed.replacements || []);
      return rulesCache;
    }
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    rulesCache = Array.isArray(parsed) ? parsed : (parsed.replacements || []);
    return rulesCache;
  } catch (_) {
    rulesCache = [];
    return rulesCache;
  }
}

/**
 * Apply replacement rules to text. Case-insensitive by default.
 */
function applyRules(text, rules) {
  if (!text || rules.length === 0) return text;
  let out = String(text);
  for (const r of rules) {
    const from = r.from;
    const to = r.to ?? '';
    if (!from) continue;
    const regex = new RegExp(escapeRegex(from), 'gi');
    out = out.replace(regex, to);
  }
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize zone segments before alignment.
 * @param {Array<{id: string, text: string}>} segments
 * @returns {Promise<Array<{id: string, text: string}>>} Segments with sanitized text
 */
export async function sanitizeZoneText(segments) {
  const rules = await loadRules();
  if (rules.length === 0) return segments;
  return segments.map(s => ({
    ...s,
    text: applyRules(s.text, rules)
  }));
}
