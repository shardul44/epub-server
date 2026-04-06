import { createRequire } from 'module';
import { execSync, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);

function getJarPath() {
  const pkgPath = require.resolve('epubchecker/package.json');
  const pkgDir = path.dirname(pkgPath);
  const { epubcheckVersion } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return path.join(pkgDir, 'vendors', `epubcheck-${epubcheckVersion}`, 'epubcheck.jar');
}

export function isJavaAvailable() {
  try {
    execSync('java -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function summarizeReport(report) {
  const messages = Array.isArray(report?.messages) ? report.messages : [];
  const fatals = messages.filter((m) => m.severity === 'FATAL');
  const errors = messages.filter((m) => m.severity === 'ERROR');
  const warnings = messages.filter((m) => m.severity === 'WARNING');
  const infos = messages.filter((m) => m.severity === 'INFO');
  const valid = fatals.length === 0 && errors.length === 0;
  return {
    valid,
    summary: {
      fatalCount: fatals.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length
    }
  };
}

/**
 * Match epubchecker npm filtering for warnings / infos (INFO = notices).
 */
function filterReportMessages(report, options) {
  const out = { ...report, messages: [...(report.messages || [])] };
  out.messages = out.messages.filter((msg) => {
    if (!options.includeWarnings && msg.severity === 'WARNING') return false;
    if (!options.includeNotices && msg.severity === 'INFO') return false;
    return true;
  });
  return out;
}

function sortMessages(report) {
  const order = { FATAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  report.messages = [...(report.messages || [])].sort((a, b) => {
    const da = order[a.severity] ?? 99;
    const db = order[b.severity] ?? 99;
    return da - db;
  });
  return report;
}

/**
 * Run W3C EPUBCheck on a file or expanded EPUB directory (direct `java -jar`, reliable on Windows).
 */
export async function runEpubcheck(epubPath, options = {}) {
  if (!epubPath || !fs.existsSync(epubPath)) {
    throw new Error('EPUB path is missing or does not exist');
  }
  if (!isJavaAvailable()) {
    throw new Error(
      'Java (JRE) is required for EPUBCheck. Install Java and ensure `java` is on PATH.'
    );
  }

  const jarPath = getJarPath();
  if (!fs.existsSync(jarPath)) {
    throw new Error(
      'EPUBCheck JAR is missing. Reinstall dependency: npm install epubchecker (postinstall downloads the JAR).'
    );
  }

  const resolved = path.resolve(epubPath);
  const isDir = fs.statSync(resolved).isDirectory();
  const jsonPath = path.join(tmpdir(), `epubcheck-${randomUUID()}.json`);

  const args = ['-jar', jarPath, '--json', jsonPath];
  if (options.locale) {
    args.push('--locale', options.locale);
  }
  if (isDir) {
    args.push('-m', 'exp');
  }
  args.push(resolved);

  let stderrCombined = '';
  try {
    await execFile('java', args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true
    });
  } catch (err) {
    stderrCombined = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    // Exit code 1 is normal when the EPUB has errors; JSON is still written.
  }

  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      stderrCombined ||
        'EPUBCheck did not write a JSON report. Use a .epub file or an expanded EPUB folder, or check that the file is readable.'
    );
  }

  let report;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    report = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse EPUBCheck JSON: ${e.message}`);
  } finally {
    fs.unlink(jsonPath, () => {});
  }

  report = filterReportMessages(report, {
    includeWarnings: options.includeWarnings !== false,
    includeNotices: options.includeNotices === true
  });
  report = sortMessages(report);

  const { valid, summary } = summarizeReport(report);

  return {
    valid,
    summary,
    report,
    engine: 'W3C EPUBCheck',
    note: 'Conformance checking uses W3C EPUBCheck.'
  };
}
