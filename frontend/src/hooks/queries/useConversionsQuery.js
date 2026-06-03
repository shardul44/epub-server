/**
 * useConversionsQuery — read-only access to the shared conversion + FXL job list cache.
 *
 * Polling is owned exclusively by ConversionsJobsPoller (mounted in RootLayout).
 * Do not add refetchInterval here — multiple observers would amplify network traffic.
 *
 * Scope from useListScope(): members use `scope=own`; org/platform admins use org-wide lists.
 * Cache key: ['conversions', scope]
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';
import { useListScope } from '../../context/ListScopeContext';
import { listScopeQueryParams } from '../../utils/listScope';
import { isEpubSourceJob } from '../../utils/conversionJobKey';
import { logConversionsFetch } from '../../lib/conversionsFetchLog';

export const CONVERSIONS_STALE_TIME_MS = 20 * 1000;
export const CONVERSIONS_POLL_INTERVAL_MS = 5000;

const ACTIVE_STATUSES = new Set(['IN_PROGRESS', 'PENDING', 'PROCESSING']);

export function hasActiveJobs(jobs) {
  return Array.isArray(jobs) && jobs.some((j) => ACTIVE_STATUSES.has(j.status));
}

function mergeJobs(reflowJobs, fxlJobs) {
  const reflow = (Array.isArray(reflowJobs) ? reflowJobs : [])
    .filter(Boolean)
    .map((j) => ({
      ...j,
      jobType: j.jobType ?? 'REFLOW',
    }));
  const fxl = (Array.isArray(fxlJobs) ? fxlJobs : [])
    .filter(Boolean)
    .map((j) => ({
      ...j,
      jobType: 'FXL',
      pdfDocumentId: j.pdfDocumentId ?? j.pdfId,
    }));

  const seen = new Set();
  const merged = [...reflow, ...fxl].filter((j) => {
    if (!j) return false;
    const key = `${j.jobType}-${j.id ?? j.jobId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const ORDER = { IN_PROGRESS: 0, PENDING: 1, PROCESSING: 2, COMPLETED: 3, FAILED: 4, CANCELLED: 5 };
  merged.sort((a, b) => {
    const d = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
    return d !== 0 ? d : new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
  });

  return merged;
}

/**
 * @param {import('../../utils/listScope').ListScope} scope
 * @param {{ source?: string, kind?: 'fetch'|'invalidate'|'poll' }} [meta]
 */
export async function fetchAllJobs(scope = 'org', meta = {}) {
  const source = meta.source ?? 'fetchAllJobs';
  const kind = meta.kind ?? 'fetch';
  logConversionsFetch({ source, scope, kind });

  const params = listScopeQueryParams(scope);
  const [reflowRes, fxlRes] = await Promise.all([
    api.get('/conversions', { params }).then((r) => r.data?.data ?? r.data ?? []).catch(() => []),
    api.get('/kitaboo/jobs', { params }).then((r) => r.data?.data ?? r.data ?? []).catch(() => []),
  ]);
  return mergeJobs(reflowRes, fxlRes);
}

/**
 * @param {{
 *   statusFilter?: string,
 *   enabled?: boolean,
 *   scope?: 'own'|'org',
 *   excludeEpubImports?: boolean,
 *   debugLabel?: string,
 * }} [options]
 *
 * `excludeEpubImports` filters out direct-EPUB-import jobs (where the source
 * is a .epub upload, not a PDF). Pass true on PDF-only workflow pages
 * (Conversion Jobs, FXL Editor, Audio Sync Studio, Download EPUB) so the
 * lists, counts, and badges only reflect PDF→EPUB conversions. The raw cache
 * is left intact so the EPUB Sync page can still resolve its uploaded EPUBs
 * back to their conversion jobs.
 */
export function useConversionsQuery({
  statusFilter = 'all',
  enabled = true,
  scope: scopeOverride,
  excludeEpubImports = false,
  debugLabel,
} = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const listKey = queryKeys.conversions.list(scope);
  const fetchSource = debugLabel ?? 'useConversionsQuery';

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => fetchAllJobs(scope, { source: fetchSource, kind: 'fetch' }),
    enabled,
    staleTime: CONVERSIONS_STALE_TIME_MS,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    placeholderData: (previousData) => previousData,
  });

  const rawJobs = query.data ?? [];

  const allJobs = useMemo(
    () => (excludeEpubImports ? rawJobs.filter((j) => !isEpubSourceJob(j)) : rawJobs),
    [rawJobs, excludeEpubImports],
  );

  const jobs = useMemo(
    () => (statusFilter === 'all' ? allJobs : allJobs.filter((j) => j.status === statusFilter)),
    [allJobs, statusFilter],
  );

  const refresh = useCallback(
    (invalidateSource = debugLabel ?? 'refresh') => {
      logConversionsFetch({ source: invalidateSource, scope, kind: 'invalidate' });
      return queryClient.invalidateQueries({ queryKey: queryKeys.conversions.all() });
    },
    [queryClient, scope, debugLabel],
  );

  return {
    jobs,
    allJobs,
    scope,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isFetching: query.isFetching,
    error: query.error?.message ?? '',
    refresh,
  };
}
