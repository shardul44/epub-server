/**
 * useConversions — thin wrapper around useConversionsQuery.
 * Returns only COMPLETED jobs. Preserves the legacy API surface.
 *
 * Pass `excludeEpubImports: true` on PDF-only workflow pages (Conversion Jobs,
 * FXL Editor) to hide direct-EPUB-import rows from conversion/kitaboo lists.
 *
 * Pass `includeEpubSyncSessions: true` on Audio Sync Studio to merge direct
 * EPUB imports (pdf_documents stubs) that have no conversion_jobs row.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConversionsQuery } from './queries/useConversionsQuery';
import { conversionService } from '../services/conversionService';
import { useListScope } from '../context/ListScopeContext';
import { listScopeQueryParams } from '../utils/listScope';
import { conversionJobListKey } from '../utils/conversionJobKey';

export function useConversions({
  autoFetch = true,
  excludeEpubImports = false,
  includeEpubSyncSessions = false,
} = {}) {
  const listScope = useListScope();
  const { jobs, isLoading, error, refresh } = useConversionsQuery({
    statusFilter: 'COMPLETED',
    enabled: autoFetch,
    excludeEpubImports,
  });

  const [epubSessions, setEpubSessions] = useState([]);
  const [epubLoading, setEpubLoading] = useState(false);
  const [epubError, setEpubError] = useState('');
  const [epubReloadTick, setEpubReloadTick] = useState(0);

  useEffect(() => {
    if (!autoFetch || !includeEpubSyncSessions) {
      setEpubSessions([]);
      setEpubLoading(false);
      return;
    }
    let cancelled = false;
    setEpubLoading(true);
    setEpubError('');
    conversionService
      .getEpubSyncSessions(listScopeQueryParams(listScope))
      .then((rows) => {
        if (!cancelled) setEpubSessions(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setEpubSessions([]);
          setEpubError(err?.message || 'Failed to load EPUB imports');
        }
      })
      .finally(() => {
        if (!cancelled) setEpubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoFetch, includeEpubSyncSessions, listScope, epubReloadTick]);

  const mergedJobs = useMemo(() => {
    if (!includeEpubSyncSessions) return jobs;
    const seen = new Set(jobs.map((j) => conversionJobListKey(j)));
    const extra = epubSessions.filter((j) => {
      const key = conversionJobListKey(j);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...extra, ...jobs].sort(
      (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0),
    );
  }, [jobs, epubSessions, includeEpubSyncSessions]);

  const refetch = useCallback(async () => {
    await refresh();
    if (includeEpubSyncSessions) {
      setEpubReloadTick((t) => t + 1);
    }
  }, [refresh, includeEpubSyncSessions]);

  return {
    jobs: mergedJobs,
    loading: isLoading || (includeEpubSyncSessions && epubLoading),
    error: error || epubError,
    refetch,
  };
}
