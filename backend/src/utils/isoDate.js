/** Normalize DB/API values to YYYY-MM-DD or null (never throws). */
export function normIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
