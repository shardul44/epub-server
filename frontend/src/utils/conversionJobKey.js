/**
 * Stable keys for conversion + FXL jobs that may share the same numeric id.
 */

export function conversionJobListKey(job) {
  if (!job) return '';
  const id = job.id ?? job.jobId;
  if (id == null || id === '') return '';
  const type = job.jobType === 'FXL' ? 'FXL' : 'REFLOW';
  return `${type}-${id}`;
}

/** @returns {{ jobType: 'FXL'|'REFLOW'|null, jobId: string }|null} */
export function parseConversionJobListKey(key) {
  if (key == null || key === '') return null;
  const s = String(key);
  const m = s.match(/^(FXL|REFLOW)-(.+)$/);
  if (m) return { jobType: m[1], jobId: m[2] };
  return { jobType: null, jobId: s };
}

/**
 * Resolve a job from the merged list using a list key or legacy numeric id.
 * @param {object[]} jobs
 * @param {string|number|null} listKeyOrId
 * @param {'FXL'|'REFLOW'|null} [preferredType] disambiguates duplicate numeric ids
 */
export function findJobByListKey(jobs, listKeyOrId, preferredType = null) {
  if (!listKeyOrId || !Array.isArray(jobs)) return null;
  const key = String(listKeyOrId);
  const direct = jobs.find((j) => conversionJobListKey(j) === key);
  if (direct) return direct;

  const parsed = parseConversionJobListKey(key);
  const matches = jobs.filter((j) => String(j.id ?? j.jobId) === String(parsed.jobId));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const type = parsed.jobType ?? preferredType;
  if (type) {
    return (
      matches.find((j) => (j.jobType === 'FXL' ? 'FXL' : 'REFLOW') === type) ?? matches[0]
    );
  }
  return matches[0];
}

/** Job row represents an EPUB direct import (not a renderable PDF). */
export function isEpubSourceJob(job) {
  if (!job) return true;
  const name = (
    job.pdfFilename ||
    job.pdfName ||
    job.originalFileName ||
    job.fileName ||
    job.filename ||
    job.epubFilename ||
    ''
  ).toLowerCase();
  if (name.endsWith('.epub')) return true;
  if (name.includes('.epub')) return true; // catches `book.epub.something` edge cases
  if (/fxl_stub_\d+\.epub$/i.test(name)) return true;
  if (job.source === 'epub_direct_import') return true;
  if (job.sourceType === 'epub' || job.sourceType === 'EPUB') return true;
  if (job.fileType === 'epub' || job.fileType === 'EPUB') return true;
  return false;
}
