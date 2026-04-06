/**
 * Inspect built EPUB XHTML for extra space issues.
 * Usage: node scripts/inspect-xhtml-spacing.js [path-to.epub]
 *   If no path given, uses first fxl_*.epub or first temp folder under backend/epub_output.
 *
 * Reports:
 * - Two or more consecutive spaces in text content
 * - Multiple &nbsp; in a row
 * - Optional: phrase "too." to see sentence-boundary context
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

function getEpubPath() {
  const arg = process.argv[2];
  if (arg) {
    const resolved = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    if (fs.existsSync(resolved)) return resolved;
  }
  const epubOutput = path.join(backendRoot, 'epub_output');
  if (!fs.existsSync(epubOutput)) return null;
  const names = fs.readdirSync(epubOutput);
  const fxlEpub = names.find(n => n.startsWith('fxl_') && n.endsWith('.epub'));
  if (fxlEpub) return path.join(epubOutput, fxlEpub);
  const fxlDir = names.find(n => n.startsWith('fxl_'));
  if (fxlDir) {
    const tempPath = path.join(epubOutput, fxlDir, 'temp');
    if (fs.existsSync(tempPath)) return tempPath;
  }
  const tempDir = names.find(n => n.startsWith('temp_'));
  if (tempDir) return path.join(epubOutput, tempDir);
  return null;
}

async function readXhtmlFromEpub(epubPath) {
  const buf = await fs.promises.readFile(epubPath);
  const zip = await JSZip.loadAsync(buf);
  const files = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    const lower = relPath.toLowerCase();
    if (lower.endsWith('.xhtml') && (relPath.includes('OEBPS') || relPath.includes('EPUB') || relPath.includes('OPS'))) {
      files.push(relPath);
    }
  });
  const out = {};
  for (const rel of files) {
    out[rel] = await zip.file(rel).async('string');
  }
  return out;
}

function readXhtmlFromDir(dirPath) {
  const oebps = path.join(dirPath, 'OEBPS');
  const epub = path.join(dirPath, 'EPUB');
  const base = fs.existsSync(oebps) ? oebps : (fs.existsSync(epub) ? epub : dirPath);
  const files = {};
  function walk(d) {
    if (!fs.existsSync(d)) return;
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith('.xhtml')) {
        const rel = path.relative(dirPath, full).replace(/\\/g, '/');
        files[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  }
  walk(base);
  return files;
}

// Only flag double space when it's in visible text (word/punct + 2+ spaces + word), not indentation/CSS
const DOUBLE_SPACE_IN_TEXT = /[\w.!?,;:'")\]]\s{2,}[\w.!?,;:'"(\[\]]/g;
const NBSP_MULTIPLE = /(&nbsp;){2,}/gi;
const PHRASE_TOO = /too\.\s*[^\s<]/;  // "too." followed by optional space and non-space (e.g. "They")

function inspectOne(name, content) {
  const lines = content.split(/\r?\n/);
  const issues = [];
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    let m;
    DOUBLE_SPACE_IN_TEXT.lastIndex = 0;
    while ((m = DOUBLE_SPACE_IN_TEXT.exec(line)) !== null) {
      const start = Math.max(0, m.index - 15);
      const end = Math.min(line.length, m.index + m[0].length + 25);
      issues.push({ type: 'double-space', lineNum, snippet: line.slice(start, end).replace(/\s/g, '·') });
    }
    NBSP_MULTIPLE.lastIndex = 0;
    while ((m = NBSP_MULTIPLE.exec(line)) !== null) {
      const start = Math.max(0, m.index - 15);
      const end = Math.min(line.length, m.index + m[0].length + 15);
      issues.push({ type: 'multiple-nbsp', lineNum, snippet: line.slice(start, end) });
    }
    if (PHRASE_TOO.test(line)) {
      const idx = line.search(PHRASE_TOO);
      const start = Math.max(0, idx - 15);
      const end = Math.min(line.length, idx + 35);
      issues.push({ type: 'phrase-too', lineNum, snippet: line.slice(start, end).replace(/\s/g, '·') });
    }
  });
  return issues;
}

async function main() {
  const epubPath = getEpubPath();
  if (!epubPath) {
    console.error('No EPUB path. Usage: node scripts/inspect-xhtml-spacing.js [path-to.epub]');
    process.exit(1);
  }

  console.log('Source:', epubPath);
  let xhtmlFiles = {};
  const stat = await fs.promises.stat(epubPath);
  if (stat.isDirectory()) {
    xhtmlFiles = readXhtmlFromDir(epubPath);
  } else {
    xhtmlFiles = await readXhtmlFromEpub(epubPath);
  }

  const pageNames = Object.keys(xhtmlFiles).filter(k => /page.*\.xhtml$/i.test(k) && !/nav\.xhtml/i.test(k)).sort();
  if (pageNames.length === 0) {
    console.log('No page XHTML files found.');
    return;
  }

  console.log('Page XHTML files:', pageNames.length);
  let totalIssues = 0;
  for (const name of pageNames) {
    const content = xhtmlFiles[name];
    const issues = inspectOne(name, content);
    if (issues.length === 0) continue;
    totalIssues += issues.length;
    console.log('\n---', name, '---');
    for (const u of issues) {
      console.log(`  [${u.type}] Line ${u.lineNum}: ...${u.snippet}...`);
    }
  }

  if (totalIssues === 0) {
    console.log('\nNo double spaces or multiple &nbsp; found in page XHTML. Extra gap may be from layout/CSS.');
  } else {
    console.log('\nTotal issues:', totalIssues);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
