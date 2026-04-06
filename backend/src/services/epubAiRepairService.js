import JSZip from 'jszip';
import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { GeminiService } from './geminiService.js';
import { runEpubcheck } from './epubcheckService.js';

const TEXT_EXT = /\.(xhtml|html|htm|xml|opf|css|ncx|svg|txt|json|smil)$/i;

/** Max characters sent to the model per file (truncated with notice). */
const MAX_CHARS_PER_FILE = 100000;
/** Max total characters across all file payloads in one request. */
const MAX_TOTAL_CHARS = 280000;
const MAX_PATHS = 18;

/** Input caps per repair request (raise if your EPUB has very large text files). */
const REPAIR_MAX_CHARS_PER_FILE = parseInt(process.env.EPUB_REPAIR_MAX_INPUT_CHARS || '60000', 10);
const REPAIR_MAX_TOTAL_CHARS = parseInt(process.env.EPUB_REPAIR_MAX_TOTAL_INPUT_CHARS || '800000', 10);
/** Package document is often >16k; truncating OPF makes the model invent a tiny invalid package. */
const REPAIR_MAX_OPF_INPUT_CHARS = parseInt(process.env.EPUB_REPAIR_MAX_OPF_INPUT_CHARS || '200000', 10);
/** OPF reads use at least this many chars so the full package document is loaded (not a mid-manifest cut). */
const OPF_FULL_READ_MIN_CHARS = parseInt(process.env.EPUB_REPAIR_OPF_FULL_READ_MIN_CHARS || '999999', 10);
/** Prompt-only: XHTML/HTML sent to the model is capped to reduce request tokens; full file stays in payload for UI/apply. */
const PROMPT_XHTML_MAX_CHARS = parseInt(process.env.EPUB_REPAIR_PROMPT_XHTML_MAX_CHARS || '20000', 10);
/** Max EPUBCheck lines per file in the repair prompt (reduces noise + tokens). */
const REPAIR_MAX_MESSAGES_PER_FILE = parseInt(process.env.EPUB_REPAIR_MAX_MESSAGES_PER_FILE || '5', 10);

/** Set DEBUG_EPUB_REPAIR=1 or EPUB_REPAIR_DEBUG=1 for path / messages / apply logs. */
const DEBUG_EPUB_REPAIR =
  process.env.DEBUG_EPUB_REPAIR === '1' || process.env.EPUB_REPAIR_DEBUG === '1';
const REPAIR_RAW_LOG_MAX_CHARS = parseInt(process.env.EPUB_REPAIR_RAW_LOG_MAX_CHARS || '12000', 10);

/** Debug only: accept structurally weak OPF so you can trace apply/write (not for production). */
const SKIP_OPF_VALIDATION = process.env.EPUB_REPAIR_SKIP_OPF_VALIDATION === 'true';

function repairDebug(...args) {
  if (DEBUG_EPUB_REPAIR) console.log('[epubAiRepair]', ...args);
}

/** Default max output tokens (full-file JSON needs far more than 8k). Override with GEMINI_EPUB_REPAIR_MAX_OUTPUT. */
const DEFAULT_REPAIR_MAX_OUTPUT = parseInt(process.env.GEMINI_EPUB_REPAIR_MAX_OUTPUT || '131072', 10);
const REPAIR_MAX_OUTPUT_HARD_CAP = parseInt(process.env.GEMINI_EPUB_REPAIR_MAX_OUTPUT_HARD_CAP || '262144', 10);

/**
 * Scale output token budget from source size so JSON-escaped full files are not cut mid-string.
 * OPF / large XHTML need extra headroom (JSON escaping); EPUB 3 OPF is often huge.
 */
function maxOutputTokensForRepairFile(payloadMeta, relPath = '') {
  const len = String(payloadMeta?.content || '').length;
  const rp = String(relPath || '').toLowerCase();
  let estimated = Math.ceil((len / 3.0) * 1.55) + 4096;
  if (rp.endsWith('.opf')) {
    estimated = Math.max(estimated, Math.ceil((len / 2.8) * 1.9) + 32768);
  } else if (rp.endsWith('.xhtml') || rp.endsWith('.html') || rp.endsWith('.htm')) {
    estimated = Math.max(estimated, Math.ceil((len / 3.2) * 1.75) + 16384);
  } else if (rp.endsWith('.smil')) {
    estimated = Math.max(estimated, Math.ceil((len / 3.2) * 1.6) + 8192);
  }
  return Math.min(REPAIR_MAX_OUTPUT_HARD_CAP, Math.max(DEFAULT_REPAIR_MAX_OUTPUT, estimated));
}

/**
 * EPUB package document must include full metadata, manifest, and spine — not a fragment.
 */
function isValidEpubPackageOpf(xml) {
  const s = String(xml || '').trim();
  if (s.length < 200) return false;
  const lower = s.toLowerCase();
  if (!lower.includes('</package>')) return false;
  if (!lower.includes('<manifest')) return false;
  if (!lower.includes('</manifest>')) return false;
  if (!lower.includes('<spine')) return false;
  if (!lower.includes('</spine>')) return false;
  if (!lower.includes('<metadata')) return false;
  if (!lower.includes('</metadata>')) return false;
  if (!lower.includes('dc:title')) return false;
  if (!lower.includes('dc:language')) return false;
  const isV3 = /<\s*package[^>]*version\s*=\s*["']3\.0["']/i.test(s);
  if (isV3) {
    const hasMod = /dcterms:modified|property\s*=\s*["']dcterms:modified/i.test(s);
    if (!hasMod) return false;
  }
  return true;
}

/**
 * Detect obvious mid-generation cut (missing root close). Case-insensitive.
 * XHTML: accept </html> or a closed <body>...</body> pair (valid EPUB docs; avoids false positives when </html> is omitted).
 */
function looksLikeTruncatedFullFile(relPath, content) {
  const text = String(content || '').trim();
  if (text.length < 30) return true;
  const lower = text.toLowerCase();
  const p = String(relPath || '').toLowerCase();
  if (p.endsWith('.opf')) {
    return !lower.includes('</package>');
  }
  if (p.endsWith('.xhtml') || p.endsWith('.html') || p.endsWith('.htm')) {
    if (lower.includes('</html>')) return false;
    if (lower.includes('<body') && lower.includes('</body>')) return false;
    return true;
  }
  if (p.endsWith('.ncx')) {
    return !lower.includes('</ncx>');
  }
  if (p.endsWith('.xml') && p.includes('container')) {
    return !lower.includes('</container>');
  }
  if (p.endsWith('.svg')) {
    return !lower.includes('</svg>');
  }
  if (p.endsWith('.smil')) {
    return !lower.includes('</smil>');
  }
  return false;
}

/** Max files to send to AI in one repair run (same idea as accessibility MAX_CODE_REPAIRS). */
const MAX_FILES_AI_REPAIR = parseInt(process.env.EPUB_AI_REPAIR_MAX_FILES || '20', 10);

function sanitizeZipEntry(name) {
  const n = String(name).replace(/\\/g, '/').replace(/^\//, '');
  if (!n || n.includes('..')) return null;
  return n;
}

function safeResolvedPath(root, relPosix) {
  const rel = sanitizeZipEntry(relPosix);
  if (!rel) return null;
  const full = path.resolve(root, ...rel.split('/'));
  const base = path.resolve(root);
  if (!full.startsWith(base)) return null;
  return full;
}

/**
 * Unpack EPUB buffer to a directory (flat paths only, no ..).
 */
export async function unpackEpubToDir(buffer, outDir) {
  await fs.ensureDir(outDir);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  for (const name of names) {
    const safe = sanitizeZipEntry(name);
    if (!safe) continue;
    const dest = path.join(outDir, ...safe.split('/'));
    await fs.ensureDir(path.dirname(dest));
    const entry = zip.files[name];
    const data = await entry.async('nodebuffer');
    await fs.writeFile(dest, data);
  }
}

/**
 * Package directory to EPUB buffer (mimetype first, STORE).
 */
export async function packageDirToEpubBuffer(rootDir) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  const addDir = async (dirPath, zipPrefix = '') => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      const zipPath = zipPrefix ? `${zipPrefix}/${ent.name}` : ent.name;
      if (ent.name === 'mimetype' && !zipPrefix) {
        continue;
      }
      if (ent.isDirectory()) {
        await addDir(full, zipPath);
      } else {
        const buf = await fs.readFile(full);
        zip.file(zipPath, buf);
      }
    }
  };

  await addDir(rootDir);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
}

function severityRank(sev) {
  const order = { FATAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  return order[sev] ?? 9;
}

/**
 * Collect unique paths from EPUBCheck messages (EPUB-internal paths).
 */
export function collectPathsFromMessages(messages) {
  const ordered = [];
  const seen = new Set();
  const sorted = [...(messages || [])].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const msg of sorted) {
    for (const loc of msg.locations || []) {
      let p = loc.path != null ? String(loc.path) : '';
      p = p.replace(/\\/g, '/');
      if (!p || p.includes('..')) continue;
      if (/additional\s+locations/i.test(p)) continue;
      if (!seen.has(p)) {
        seen.add(p);
        ordered.push(p);
      }
    }
  }
  return ordered;
}

async function tryAddOpfFromContainer(extractDir, pathsSet) {
  const containerPath = path.join(extractDir, 'META-INF', 'container.xml');
  if (!(await fs.pathExists(containerPath))) return;
  try {
    const xml = await fs.readFile(containerPath, 'utf8');
    const m = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (m && m[1]) {
      const opf = m[1].replace(/\\/g, '/');
      if (!pathsSet.has(opf)) pathsSet.add(opf);
    }
  } catch {
    /* ignore */
  }
}

async function getOpfRelativePath(extractDir) {
  const containerPath = path.join(extractDir, 'META-INF', 'container.xml');
  if (!(await fs.pathExists(containerPath))) return null;
  try {
    const xml = await fs.readFile(containerPath, 'utf8');
    const m = xml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    return m && m[1] ? m[1].replace(/\\/g, '/') : null;
  } catch {
    return null;
  }
}

/** Recursive list of POSIX relative paths under extractDir (files only). */
async function listAllRelativeFiles(extractDir) {
  const out = [];
  async function walk(dir, relPrefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        await walk(full, rel);
      } else {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  }
  await walk(extractDir, '');
  return out;
}

function scorePathPreference(rel) {
  const r = rel.toLowerCase();
  if (r.startsWith('oebps/')) return 0;
  if (r.startsWith('ops/')) return 1;
  if (r.startsWith('epub/')) return 2;
  return 50;
}

/**
 * Map EPUBCheck location paths to a path that exists in the ZIP (e.g. nav.xhtml → OEBPS/nav.xhtml).
 */
export async function resolveEpubInternalPath(extractDir, reportedPath) {
  const normalized = String(reportedPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!normalized || normalized.includes('..')) return null;

  const directAbs = safeResolvedPath(extractDir, normalized);
  if (directAbs && (await fs.pathExists(directAbs))) return normalized;

  const all = await listAllRelativeFiles(extractDir);
  const nLower = normalized.toLowerCase();

  const suffixMatches = all.filter(
    (r) =>
      r === normalized ||
      r.toLowerCase() === nLower ||
      r.toLowerCase().endsWith('/' + nLower)
  );
  if (suffixMatches.length === 1) return suffixMatches[0];
  if (suffixMatches.length > 1) {
    suffixMatches.sort((a, b) => {
      const d = scorePathPreference(a) - scorePathPreference(b);
      if (d !== 0) return d;
      return a.length - b.length;
    });
    return suffixMatches[0];
  }

  const base = path.posix.basename(normalized);
  const baseMatches = all.filter(
    (r) => path.posix.basename(r).toLowerCase() === base.toLowerCase()
  );
  if (baseMatches.length === 1) return baseMatches[0];
  if (baseMatches.length > 1) {
    baseMatches.sort((a, b) => {
      const d = scorePathPreference(a) - scorePathPreference(b);
      if (d !== 0) return d;
      return a.length - b.length;
    });
    return baseMatches[0];
  }

  return null;
}

/**
 * If the package rootfile lists an item with this basename (e.g. nav), return its full EPUB-internal path.
 */
async function expectedPathFromOpfForBasename(extractDir, basename) {
  const opfRel = await getOpfRelativePath(extractDir);
  if (!opfRel) return null;
  const opfDir = path.posix.dirname(opfRel);
  const opfAbs = safeResolvedPath(extractDir, opfRel);
  if (!opfAbs || !(await fs.pathExists(opfAbs))) return null;
  let opf;
  try {
    opf = await fs.readFile(opfAbs, 'utf8');
  } catch {
    return null;
  }
  const want = basename.toLowerCase();
  const itemTag = /<item\b[^>]*>/gi;
  let match;
  let best = null;
  let bestScore = -1;
  while ((match = itemTag.exec(opf)) !== null) {
    const tag = match[0];
    const hrefM = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefM) continue;
    const href = hrefM[1].replace(/\\/g, '/');
    const b = path.posix.basename(href).toLowerCase();
    if (b !== want) continue;
    const fullRel = path.posix.normalize(path.posix.join(opfDir, href)).replace(/\\/g, '/');
    let sc = 0;
    if (/\bproperties\s*=\s*["'][^"']*\bnav\b/i.test(tag)) sc += 10;
    if (/\bproperties\s*=\s*["'][^"']*\bscripted\b/i.test(tag)) sc += 1;
    if (sc > bestScore) {
      bestScore = sc;
      best = fullRel;
    }
  }
  if (best) return best;
  if (opfDir && want) {
    return path.posix.normalize(path.posix.join(opfDir, basename)).replace(/\\/g, '/');
  }
  return null;
}

/**
 * Rewrite EPUBCheck location paths so they match files inside the unpacked EPUB (folder prefixes, OPF manifest).
 * Mutates messages in place.
 */
export async function resolveMessagePathsForEpub(extractDir, messages) {
  for (const m of messages || []) {
    for (const loc of m.locations || []) {
      if (loc.path == null || String(loc.path).trim() === '') continue;
      const original = String(loc.path).replace(/\\/g, '/');
      const resolved = await resolveEpubInternalPath(extractDir, original);
      if (resolved) {
        loc.path = resolved;
        continue;
      }
      const base = path.posix.basename(original);
      const fromOpf = await expectedPathFromOpfForBasename(extractDir, base);
      if (fromOpf) {
        loc.path = fromOpf;
      }
    }
  }
}

/**
 * Build map path -> content for text files to send to the model.
 * @param {object} [limits] - optional maxCharsPerFile, maxTotalChars (defaults: large catalog scan)
 */
export async function loadFilePayloads(extractDir, messagePaths, limits = {}) {
  const baseCapPer = limits.maxCharsPerFile ?? MAX_CHARS_PER_FILE;
  const capTotal = limits.maxTotalChars ?? MAX_TOTAL_CHARS;

  const paths = [...messagePaths];
  const fromReport = new Set(paths.map((p) => String(p).replace(/\\/g, '/')));
  const set = new Set(paths);
  await tryAddOpfFromContainer(extractDir, set);
  if (await fs.pathExists(path.join(extractDir, 'META-INF', 'container.xml'))) {
    set.add('META-INF/container.xml');
  }

  const ordered = [...set].sort((a, b) => {
    const ao = /\.opf$/i.test(a) ? 0 : 1;
    const bo = /\.opf$/i.test(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(a).localeCompare(String(b));
  });
  const files = {};
  let total = 0;

  for (const rel of ordered) {
    if (Object.keys(files).length >= MAX_PATHS) break;
    if (!TEXT_EXT.test(rel)) continue;
    // Never truncate OPF mid-file: use a high read cap so the model always sees the full package document.
    const capPer = /\.opf$/i.test(rel)
      ? Math.max(baseCapPer, REPAIR_MAX_OPF_INPUT_CHARS, OPF_FULL_READ_MIN_CHARS)
      : baseCapPer;
    const abs = safeResolvedPath(extractDir, rel);
    if (!abs || !(await fs.pathExists(abs))) {
      if (fromReport.has(rel)) {
        files[rel] = { content: '', truncated: false, missing: true };
      }
      continue;
    }
    let text = await fs.readFile(abs, 'utf8');
    let truncated = false;
    if (text.length > capPer) {
      text = text.slice(0, capPer);
      truncated = true;
    }
    const nextTotal = total + text.length;
    // Package document must load whole: do not skip OPF because of total-char budget.
    if (nextTotal > capTotal && !/\.opf$/i.test(rel)) break;
    files[rel] = { content: text, truncated };
    total = nextTotal;
  }

  return files;
}

function normalizeRelPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/** Case-insensitive key for matching EPUBCheck paths to payload keys (ZIP paths vary by case). */
function normalizePathKey(p) {
  return normalizeRelPath(p).toLowerCase();
}

/**
 * EPUBCheck messages that apply to this path (locations match), plus package-wide messages (no locations)
 * assigned only to orphanTarget — mirrors accessibility: one focused chunk per target, not the full report every time.
 */
export function messagesForPath(messages, relPath, orphanTarget) {
  const relKey = normalizePathKey(relPath);
  const otKey = orphanTarget ? normalizePathKey(orphanTarget) : '';
  const out = [];
  const orphans = [];

  for (const m of messages || []) {
    const locs = m.locations || [];
    if (locs.length === 0) {
      orphans.push(m);
      continue;
    }
    if (locs.some((l) => normalizePathKey(l.path) === relKey)) {
      out.push(m);
    }
  }

  if (otKey && relKey === otKey && orphans.length > 0) {
    out.push(...orphans);
  }

  return out;
}

/**
 * Map model-returned file path to our expected EPUB-internal path (handles short names vs OEBPS/...).
 */
function pickProposedContentFromAiFiles(files, rel) {
  if (!Array.isArray(files) || !files.length) return '';
  const wantKey = normalizePathKey(rel);
  const wantNorm = normalizeRelPath(rel);

  for (const f of files) {
    if (typeof f?.content !== 'string') continue;
    const fp = normalizeRelPath(f?.path || '');
    if (normalizePathKey(fp) === wantKey) return f.content;
  }
  for (const f of files) {
    if (typeof f?.content !== 'string') continue;
    const fp = normalizeRelPath(f?.path || '');
    const fk = normalizePathKey(fp);
    if (
      wantKey &&
      (fk === wantKey || (wantKey.length && fk.endsWith('/' + wantKey)))
    ) {
      return f.content;
    }
  }
  const wantBase = path.posix.basename(wantNorm).toLowerCase();
  const withContent = files.filter((f) => typeof f?.content === 'string');
  const baseMatches = withContent.filter(
    (f) => path.posix.basename(normalizeRelPath(f.path || '')).toLowerCase() === wantBase
  );
  if (baseMatches.length === 1) return baseMatches[0].content;
  if (withContent.length === 1) return withContent[0].content;
  return '';
}

/** Prefer OPF for package-wide messages; else first path (sorted) for stability. */
export function pickOrphanTarget(payloadKeys) {
  const keys = [...payloadKeys].sort();
  const opf = keys.find((k) => /(^|\/)content\.opf$/i.test(k));
  return opf || keys[0] || null;
}

function promptBodyForFile(p, meta) {
  const raw = String(meta?.content || '');
  const lower = p.toLowerCase();
  const isXhtmlFamily =
    lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm');
  if (isXhtmlFamily && raw.length > PROMPT_XHTML_MAX_CHARS) {
    const trimmed = raw.slice(0, PROMPT_XHTML_MAX_CHARS);
    return {
      body: trimmed,
      note: `\n[NOTE: Prompt shows only the first ${PROMPT_XHTML_MAX_CHARS} characters of this XHTML/HTML to save tokens. The on-disk file is full-length. You must return the FULL corrected file in JSON "content" for this path — fix ALL EPUBCheck issues that apply to this file; do not truncate your output.]`
    };
  }
  return { body: raw, note: '' };
}

function buildRepairPrompt(epubcheckMessages, filePayloads, opts = {}) {
  const errLines = (epubcheckMessages || []).map((m) => {
    const id = m.ID || m.id || '';
    const loc = (m.locations || [])
      .map((l) => `${l.path || ''}${l.line != null ? `:${l.line}` : ''}`)
      .join('; ');
    return `- [${m.severity || '?'}] ${id}: ${m.message || ''}${loc ? ` (${loc})` : ''}`;
  });

  const fileBlocks = Object.entries(filePayloads).map(([p, meta]) => {
    let t = '';
    if (meta.truncated) {
      t = /\.opf$/i.test(p)
        ? '\n[NOTE: OPF input was truncated at load. Do NOT return a minimal package with only metadata—you must preserve or reconstruct the full <manifest> and <spine> from what is visible. If impossible, return "files": [] and explain.]'
        : '\n[NOTE: file truncated for size at load; fix visible issues only]';
    } else if (meta.missing) {
      t =
        '\n[NOTE: this path is missing from the package (e.g. RSC-001). Create a complete valid file at this path for EPUB 3.]';
    }
    const { body, note } = promptBodyForFile(p, meta);
    t += note;
    return `### FILE: ${p}${t}\n\`\`\`\n${body}\n\`\`\``;
  });

  const hasOpf = Object.keys(filePayloads).some((k) => /\.opf$/i.test(k));
  const opfRules = hasOpf
    ? `

PACKAGE DOCUMENT (content.opf):
- IMPORTANT: Return a FULL valid OPF package document. Do NOT truncate. The FILE section above is the complete package document (not a fragment).
- Returned content.opf must be a complete EPUB package: closed </package>, full <metadata> (dc:title, dc:language, dc:identifier), <manifest> listing all publication resources, <spine> with itemrefs. For EPUB 3 include exactly one meta with property dcterms:modified.
- Never return only a metadata fragment or an empty/minimal manifest or spine.
- Keep existing manifest hrefs and spine order unless a message requires changing them.
`
    : '';

  const singleFileRule = opts.onlyEditPath
    ? `

IMPORTANT (this request): Only edit the file "${opts.onlyEditPath}".
Return "files" with at most one object; "path" must be exactly "${opts.onlyEditPath}".
If nothing should change, return "files": [] and a short "notes" explaining why.
`
    : '';

  return `You are an expert EPUB 3 / EPUB 2 repair assistant. The user ran W3C EPUBCheck and got these messages.

Fix ALL EPUBCheck issues listed below. Return FULL corrected files. Do not truncate output. Preserve existing structure, IDs, and hrefs unless the spec requires a change.

EPUBCheck messages:
${errLines.join('\n')}

Below are the current contents of relevant files inside the EPUB (ZIP). Paths use forward slashes.

${fileBlocks.join('\n\n')}
${opfRules}${singleFileRule}
TASK:
1. Address every applicable EPUBCheck message for the files you edit — not cosmetic-only fixes unless that is all that is required.
2. Preserve valid XML/XHTML, namespaces, and document order unless a change is required to satisfy the spec.
3. Do not rename files unless strictly necessary. Keep the same path keys as in FILE sections above.
4. Respond with JSON only (schema enforced): object with "files" (array of { "path", "content" }) and optional "notes".
5. Include one entry per file you modified. "content" must be the complete new file text (properly escaped in JSON).
6. Omit unchanged files from "files", or include only files you edited.
`;
}

function parseRepairJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.replace(/^\uFEFF/, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/s, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const stripped = cleaned.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    /* continue */
  }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    /* continue */
  }
  const start2 = cleaned.indexOf('{');
  const end2 = cleaned.lastIndexOf('}');
  if (start2 !== -1 && end2 > start2) {
    try {
      return JSON.parse(cleaned.slice(start2, end2 + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Apply AI-returned files onto extractDir. Only writes paths that were in allowedPrefixes set (from filePayloads keys) OR under same roots.
 */
export async function applyRepairFiles(extractDir, filesArray, allowedPaths) {
  const allowedList = [...(allowedPaths || [])].map((p) => normalizeRelPath(String(p || '')));
  const allowedKeyToPath = new Map(allowedList.map((p) => [normalizePathKey(p), p]));
  const written = [];
  for (const item of filesArray || []) {
    let rel = item?.path != null ? String(item.path).replace(/\\/g, '/') : '';
    rel = rel.replace(/^\.\//, '');
    const content = item?.content;
    if (!rel || typeof content !== 'string') continue;
    const canonical = allowedKeyToPath.get(normalizePathKey(rel));
    if (!canonical) {
      console.warn('[epubAiRepair] skip disallowed path:', rel);
      continue;
    }
    rel = canonical;
    const abs = safeResolvedPath(extractDir, rel);
    if (!abs) continue;
    repairDebug('writing', rel, '->', abs, 'bytes=', Buffer.byteLength(content, 'utf8'));
    if (/\.opf$/i.test(rel) && !SKIP_OPF_VALIDATION && !isValidEpubPackageOpf(content)) {
      throw new Error(
        'Refusing to write content.opf: file must include complete metadata, manifest, spine, and (EPUB 3) dcterms:modified. Edit the draft or regenerate AI suggestions.'
      );
    }
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content, 'utf8');
    written.push(rel);
  }
  return written;
}

async function runGeminiRepairForPath(rel, messagesSubset, payloadMeta, { modelName, maxOut }) {
  repairDebug('Gemini repair', rel, 'messagesCount=', messagesSubset?.length ?? 0);
  const singlePayload = { [rel]: payloadMeta };
  const prompt = buildRepairPrompt(messagesSubset, singlePayload, { onlyEditPath: rel });

  let finishReason;
  let parsed = null;
  const structured = await GeminiService.generateStructuredJson(prompt, {
    modelName,
    maxOutputTokens: maxOut,
    priority: 2
  });
  if (DEBUG_EPUB_REPAIR && structured?.rawText != null) {
    let rawLog = String(structured.rawText);
    if (rawLog.length > REPAIR_RAW_LOG_MAX_CHARS) {
      rawLog = `${rawLog.slice(0, REPAIR_RAW_LOG_MAX_CHARS)}\n... [epubAiRepair: raw log truncated; set EPUB_REPAIR_RAW_LOG_MAX_CHARS]`;
    }
    console.log('[epubAiRepair] RAW AI:', rel, rawLog);
  }
  if (structured?.parsed && Array.isArray(structured.parsed.files)) {
    parsed = structured.parsed;
    finishReason = structured.finishReason;
  }
  if (!parsed || !Array.isArray(parsed.files)) {
    console.warn(`[epubAiRepair] structured JSON failed for ${rel}; trying text fallback`);
    const raw = await GeminiService.generateContentWithFinishReason(prompt, {
      modelName,
      maxOutputTokens: maxOut,
      priority: 2
    });
    finishReason = raw.finishReason ?? finishReason;
    if (DEBUG_EPUB_REPAIR && raw.text && String(raw.text).trim()) {
      let fb = String(raw.text);
      if (fb.length > REPAIR_RAW_LOG_MAX_CHARS) {
        fb = `${fb.slice(0, REPAIR_RAW_LOG_MAX_CHARS)}\n... [epubAiRepair: fallback raw truncated]`;
      }
      console.log('[epubAiRepair] RAW AI (fallback):', rel, fb);
    }
    if (raw.text && String(raw.text).trim()) {
      parsed = parseRepairJson(raw.text);
    }
  }

  if (!parsed || !Array.isArray(parsed.files)) {
    return {
      path: rel,
      ok: false,
      error: 'Model did not return valid JSON with a "files" array.',
      notes: null,
      files: [],
      finishReason
    };
  }

  return {
    path: rel,
    ok: true,
    error: null,
    notes: parsed.notes || null,
    files: parsed.files,
    finishReason
  };
}

/**
 * Parallel Gemini repairs: same chunking/cap as accessibility AI suggest.
 * @returns { mergedFiles, notesParts, fileResults, fileSuggestions, capped, skippedPaths }
 */
async function runParallelGeminiBatch(messagesBefore, payloads, options) {
  const modelName = options.modelName || process.env.GEMINI_EPUB_REPAIR_MODEL || process.env.GEMINI_MODEL;

  const payloadKeys = Object.keys(payloads);
  const orphanTarget = pickOrphanTarget(payloadKeys);
  const repairableKeys = payloadKeys.filter(
    (rel) => messagesForPath(messagesBefore, rel, orphanTarget).length > 0
  );

  if (repairableKeys.length === 0) {
    throw new Error(
      'No EPUBCheck messages map to loaded files. Check that report paths match files inside the EPUB.'
    );
  }
  repairDebug('orphanTarget=', orphanTarget, 'payloadKeys=', payloadKeys, 'repairableKeys=', repairableKeys);

  const pathOrder = collectPathsFromMessages(messagesBefore);
  const repairableSet = new Set(repairableKeys);
  const orderedRepairable = pathOrder.filter((p) => repairableSet.has(p));
  const extras = repairableKeys.filter((k) => !orderedRepairable.includes(k));
  const orderedAll = [...orderedRepairable, ...extras];

  const capped = orderedAll.length > MAX_FILES_AI_REPAIR;
  const cappedKeys = orderedAll.slice(0, MAX_FILES_AI_REPAIR);
  const skippedPaths = orderedAll.slice(MAX_FILES_AI_REPAIR);

  const mergedFiles = [];
  const notesParts = [];
  const fileSuggestions = [];

  const tasks = cappedKeys.map((rel) => async () => {
    const msgs = messagesForPath(messagesBefore, rel, orphanTarget).slice(0, REPAIR_MAX_MESSAGES_PER_FILE);
    const maxOut = maxOutputTokensForRepairFile(payloads[rel], rel);
    try {
      return await runGeminiRepairForPath(rel, msgs, payloads[rel], { modelName, maxOut });
    } catch (err) {
      return {
        path: rel,
        ok: false,
        error: err?.message || String(err),
        notes: null,
        files: []
      };
    }
  });

  const settled = await Promise.allSettled(tasks.map((t) => t()));
  const fileResults = [];

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const rel = cappedKeys[i];
    const originalContent = payloads[rel]?.content ?? '';

    if (s.status === 'rejected') {
      const errMsg = s.reason?.message || String(s.reason);
      fileResults.push({
        path: rel,
        ok: false,
        error: errMsg,
        notes: null,
        filesReturned: 0
      });
      fileSuggestions.push({
        path: rel,
        originalContent,
        proposedContent: '',
        notes: null,
        ok: false,
        error: errMsg,
        filesReturned: 0
      });
      continue;
    }

    const r = s.value;
    const files = Array.isArray(r.files) ? r.files : [];
    const proposedContent = pickProposedContentFromAiFiles(files, rel);
    if (DEBUG_EPUB_REPAIR && files.length) {
      repairDebug('path', rel, 'ai file paths:', files.map((f) => f?.path), 'proposedLen=', proposedContent?.length ?? 0);
    }

    const fr = r.finishReason;
    const apiHitLimit = fr === 'MAX_TOKENS';
    const opfStructurallyInvalid =
      !SKIP_OPF_VALIDATION &&
      /\.opf$/i.test(rel) &&
      Boolean(proposedContent) &&
      !isValidEpubPackageOpf(proposedContent);
    const heuristicIncomplete =
      Boolean(proposedContent) && looksLikeTruncatedFullFile(rel, proposedContent);
    // Do not trust finishReason STOP alone — models often return STOP with truncated JSON/XML mid-attribute.
    const truncated = apiHitLimit || opfStructurallyInvalid || heuristicIncomplete;
    const truncMsg = truncated
      ? apiHitLimit
        ? 'Model stopped at the max output token limit (set GEMINI_EPUB_REPAIR_MAX_OUTPUT or GEMINI_EPUB_REPAIR_MAX_OUTPUT_HARD_CAP higher on the server).'
        : opfStructurallyInvalid
          ? 'Proposed content.opf is not a complete package document (needs full metadata, manifest, spine; EPUB 3 also needs dcterms:modified). Edit the draft to match your book, or raise EPUB_REPAIR_MAX_OPF_INPUT_CHARS / EPUB_REPAIR_MAX_INPUT_CHARS and regenerate so the model sees the full OPF.'
          : 'Output may be incomplete (e.g. missing a closing tag). Re-run Generate AI Suggestions, or review the draft manually.'
      : null;

    if (r.ok && files.length && !truncated) {
      mergedFiles.push(...files);
    }
    if (r.notes) {
      notesParts.push(`${r.path}: ${r.notes}`);
    }
    fileResults.push({
      path: r.path,
      ok: r.ok && !truncated,
      error: r.error || truncMsg || undefined,
      notes: r.notes || null,
      filesReturned: files.length
    });
    fileSuggestions.push({
      path: rel,
      originalContent,
      proposedContent,
      notes: r.notes || null,
      ok: r.ok && !truncated,
      error: r.error || truncMsg,
      filesReturned: files.length
    });
  }

  return {
    mergedFiles,
    notesParts,
    fileResults,
    fileSuggestions,
    capped,
    skippedPaths
  };
}

/**
 * Suggest-only: parallel Gemini, no writes. For human-in-the-loop (same as accessibility ai/suggest).
 */
export async function runAiRepairSuggestionsOnly(epubBuffer, messagesBefore, options = {}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured; cannot run AI repair.');
  }

  const buf = Buffer.isBuffer(epubBuffer) ? epubBuffer : Buffer.from(epubBuffer);
  const workRoot = path.join(tmpdir(), `epub-repair-suggest-${randomUUID()}`);
  const extractDir = path.join(workRoot, 'extract');

  try {
    await fs.ensureDir(extractDir);
    await unpackEpubToDir(buf, extractDir);

    await resolveMessagePathsForEpub(extractDir, messagesBefore);
    if (DEBUG_EPUB_REPAIR) {
      repairDebug(
        'resolved message paths:',
        (messagesBefore || []).map((m) => ({
          id: m.ID || m.id,
          locs: (m.locations || []).map((l) => l.path)
        }))
      );
    }
    const pathsFromMsgs = collectPathsFromMessages(messagesBefore);
    const payloads = await loadFilePayloads(extractDir, pathsFromMsgs, {
      maxCharsPerFile: REPAIR_MAX_CHARS_PER_FILE,
      maxTotalChars: REPAIR_MAX_TOTAL_CHARS
    });
    repairDebug('loadFilePayloads keys:', Object.keys(payloads));

    if (Object.keys(payloads).length === 0) {
      throw new Error(
        'No readable text files found for repair. Ensure EPUBCheck messages include file paths, or try a different EPUB.'
      );
    }

    const batch = await runParallelGeminiBatch(messagesBefore, payloads, options);
    const notesMerged = batch.notesParts.length ? batch.notesParts.join(' | ') : null;

    return {
      fileSuggestions: batch.fileSuggestions,
      fileResults: batch.fileResults,
      capped: batch.capped,
      skippedPaths: batch.skippedPaths,
      notes: notesMerged
    };
  } finally {
    await fs.remove(workRoot).catch(() => {});
  }
}

/**
 * Apply user-approved full-file replacements, repackage, run EPUBCheck (like accessibility remediate).
 */
export async function applyApprovedEpubRepairs(epubBuffer, approvedFiles, options = {}) {
  const buf = Buffer.isBuffer(epubBuffer) ? epubBuffer : Buffer.from(epubBuffer);
  const workRoot = path.join(tmpdir(), `epub-repair-apply-${randomUUID()}`);
  const extractDir = path.join(workRoot, 'extract');

  const list = Array.isArray(approvedFiles) ? approvedFiles : [];
  const allowedPaths = new Set(
    list.map((f) => String(f?.path || '').replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean)
  );

  try {
    await fs.ensureDir(extractDir);
    await unpackEpubToDir(buf, extractDir);

    const merged = list
      .filter((f) => f?.path && typeof f.content === 'string')
      .map((f) => ({
        path: String(f.path).replace(/\\/g, '/').replace(/^\.\//, ''),
        content: f.content
      }));

    const written = await applyRepairFiles(extractDir, merged, allowedPaths);
    if (written.length === 0) {
      throw new Error('No approved file content was applied. Check paths and try again.');
    }

    const outBuf = await packageDirToEpubBuffer(extractDir);

    const tmpEpubPath = path.join(tmpdir(), `epubcheck-after-apply-${randomUUID()}.epub`);
    await fs.writeFile(tmpEpubPath, outBuf);
    let afterReport;
    try {
      afterReport = await runEpubcheck(tmpEpubPath, {
        includeWarnings: options.includeWarnings !== false,
        includeNotices: options.includeNotices === true
      });
    } finally {
      await fs.remove(tmpEpubPath).catch(() => {});
    }

    return {
      after: {
        valid: afterReport.valid,
        summary: afterReport.summary,
        messages: afterReport.report?.messages ?? []
      },
      written,
      epubBuffer: outBuf
    };
  } finally {
    await fs.remove(workRoot).catch(() => {});
  }
}

/**
 * Full pipeline: unpack → load payloads → Gemini (parallel per file, accessibility-style) → apply → package → EPUBCheck.
 * @returns {Promise<{
 *   before: { valid: boolean, summary: object, messages: array },
 *   after: { valid: boolean, summary: object, messages: array },
 *   notes: string|null,
 *   written: string[],
 *   epubBuffer: Buffer,
 *   fileResults: Array<{ path: string, ok: boolean, error?: string, notes?: string|null, filesReturned: number }>,
 *   capped: boolean,
 *   skippedPaths: string[],
 *   aiError?: string
 * }>}
 */
export async function runAiRepairPipeline(epubBuffer, messagesBefore, options = {}) {
  const buf = Buffer.isBuffer(epubBuffer) ? epubBuffer : Buffer.from(epubBuffer);
  const workRoot = path.join(tmpdir(), `epub-repair-${randomUUID()}`);
  const extractDir = path.join(workRoot, 'extract');
  const allowedPaths = new Set();

  try {
    await fs.ensureDir(extractDir);
    await unpackEpubToDir(buf, extractDir);

    await resolveMessagePathsForEpub(extractDir, messagesBefore);
    const pathsFromMsgs = collectPathsFromMessages(messagesBefore);
    const payloads = await loadFilePayloads(extractDir, pathsFromMsgs, {
      maxCharsPerFile: REPAIR_MAX_CHARS_PER_FILE,
      maxTotalChars: REPAIR_MAX_TOTAL_CHARS
    });
    const payloadKeys = Object.keys(payloads);
    payloadKeys.forEach((k) => allowedPaths.add(k));

    if (payloadKeys.length === 0) {
      throw new Error(
        'No readable text files found for repair. Ensure EPUBCheck messages include file paths, or try a different EPUB.'
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured; cannot run AI repair.');
    }

    const batch = await runParallelGeminiBatch(messagesBefore, payloads, options);
    const { mergedFiles, notesParts, fileResults, capped, skippedPaths } = batch;

    if (!mergedFiles.length) {
      throw new Error(
        'AI did not return any file updates. Try increasing GEMINI_EPUB_REPAIR_MAX_OUTPUT (default 131072), or set EPUB_REPAIR_MAX_INPUT_CHARS lower, then run again.'
      );
    }

    const written = await applyRepairFiles(extractDir, mergedFiles, allowedPaths);
    if (written.length === 0) {
      throw new Error('AI did not return any allowed file updates. Check model output format.');
    }

    const outBuf = await packageDirToEpubBuffer(extractDir);

    const tmpEpubPath = path.join(tmpdir(), `epubcheck-after-repair-${randomUUID()}.epub`);
    await fs.writeFile(tmpEpubPath, outBuf);
    let afterReport;
    try {
      afterReport = await runEpubcheck(tmpEpubPath, {
        includeWarnings: options.includeWarnings !== false,
        includeNotices: options.includeNotices === true
      });
    } finally {
      await fs.remove(tmpEpubPath).catch(() => {});
    }

    const beforeSummary = summarizeFromMessages(messagesBefore);
    const notesMerged = notesParts.length ? notesParts.join(' | ') : null;
    return {
      before: {
        valid: beforeSummary.valid,
        summary: beforeSummary.summary,
        messages: messagesBefore || []
      },
      after: {
        valid: afterReport.valid,
        summary: afterReport.summary,
        messages: afterReport.report?.messages ?? []
      },
      notes: notesMerged,
      written,
      epubBuffer: outBuf,
      fileResults,
      capped,
      skippedPaths,
      aiError: null
    };
  } finally {
    await fs.remove(workRoot).catch(() => {});
  }
}

function summarizeFromMessages(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  const fatals = msgs.filter((m) => m.severity === 'FATAL');
  const errors = msgs.filter((m) => m.severity === 'ERROR');
  const warnings = msgs.filter((m) => m.severity === 'WARNING');
  const infos = msgs.filter((m) => m.severity === 'INFO');
  return {
    valid: fatals.length === 0 && errors.length === 0,
    summary: {
      fatalCount: fatals.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length
    }
  };
}