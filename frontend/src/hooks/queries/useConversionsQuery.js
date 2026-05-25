/**
 * useConversionsQuery — single source of truth for conversion + FXL job lists.
 *
 * Scope from useListScope(): members always request `scope=own`; org admins use org-wide lists.
 * Cache key: ['conversions', scope]
 */

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';
import { useListScope } from '../../context/ListScopeContext';
import { listScopeQueryParams } from '../../utils/listScope';
import { isEpubSourceJob } from '../../utils/conversionJobKey';

const ACTIVE_STATUSES = new Set(['IN_PROGRESS', 'PENDING', 'PROCESSING']);

function hasActiveJobs(jobs) {
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
 */
export async function fetchAllJobs(scope = 'org') {
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
} = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const listKey = queryKeys.conversions.list(scope);

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => fetchAllJobs(scope),
    enabled,
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData,
    refetchInterval: (q) => {
      const jobs = q.state.data;
      return hasActiveJobs(jobs) ? 3000 : false;
    },
    refetchIntervalInBackground: true,
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

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.conversions.all() });

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
