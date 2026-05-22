export function jobIdOf(job) {
  return job?.id ?? job?.jobId;
}

export function durationSeconds(job) {
  const start = job?.createdAt ? new Date(job.createdAt).getTime() : NaN;
  const end = job?.completedAt ? new Date(job.completedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const sec = (end - start) / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 120) return `${Math.round(sec)}s`;
  return `${(sec / 60).toFixed(1)}m`;
}

export function formatJobStep(step) {
  if (!step) return null;
  return String(step)
    .replace(/STEP_\d+_/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function hasDisplayValue(value) {
  if (value == null) return false;
  const s = String(value).trim();
  return s !== '' && s !== '—';
}
