/**
 * Dev-only logging for conversion job fetches.
 * Enable in production with: localStorage.setItem('debug:conversions', '1')
 */

const DEV = import.meta.env.DEV;

export function isConversionsFetchLogEnabled() {
  if (DEV) return true;
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('debug:conversions') === '1';
  } catch {
    return false;
  }
}

/**
 * @param {{ source: string, scope?: string, kind?: 'fetch'|'invalidate'|'poll' }} entry
 */
export function logConversionsFetch(entry) {
  if (!isConversionsFetchLogEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug('[conversions]', {
    ...entry,
    at: new Date().toISOString(),
  });
}
