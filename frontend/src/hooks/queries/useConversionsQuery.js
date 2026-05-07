/**
 * useConversionsQuery — THE single source of truth for all job/conversion data.
 *
 * ONE cache key: ['conversions', 'list']
 * ONE network request: GET /conversions (reflow) + GET /kitaboo/jobs (FXL)
 *
 * Every component that needs job data calls this hook and filters locally.
 * No component should ever call /conversions or /kitaboo/jobs directly.
 *
 * Smart polling:
 *   - Polls every 5 s while IN_PROGRESS / PENDING / PROCESSING jobs exist.
 *   - Stops automatically once all jobs reach a terminal state.
 *
 * @param {{ statusFilter?: string, enabled?: boolean }} [options]
 *   statusFilter – client-side filter applied to the shared cache.
 *                  Does NOT create a separate cache entry or network request.
 *
 * @returns {{ jobs, allJobs, isLoading, isFetching, error, refresh }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

/* ─── Active-job detection ────────────────────────────────────── */
const ACTIVE_STATUSES = new Set(['IN_PROGRESS', 'PENDING', 'PROCESSING']);

function hasActiveJobs(jobs) {
  return Array.isArray(jobs) && jobs.some(j => ACTIVE_STATUSES.has(j.status));
}

/* ─── Merge + deduplicate reflow and FXL jobs ─────────────────── */
function mergeJobs(reflowJobs, fxlJobs) {
  const reflow = (Array.isArray(reflowJobs) ? reflowJobs : []).map(j => ({
    ...j,
    jobType: j.jobType ?? 'REFLOW',
  }));
  const fxl = (Array.isArray(fxlJobs) ? fxlJobs : []).map(j => ({
    ...j,
    jobType: 'FXL',
    pdfDocumentId: j.pdfDocumentId ?? j.pdfId,
  }));

  // Deduplicate by composite key
  const seen = new Set();
  const merged = [...reflow, ...fxl].filter(j => {
    const key = `${j.jobType}-${j.id ?? j.jobId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: active first, then by recency
  const ORDER = { IN_PROGRESS: 0, PENDING: 1, PROCESSING: 2, COMPLETED: 3, FAILED: 4, CANCELLED: 5 };
  merged.sort((a, b) => {
    const d = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
    return d !== 0 ? d : new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
  });

  return merged;
}

/* ─── The single fetch function ───────────────────────────────── */
async function fetchAllJobs() {
  const [reflowRes, fxlRes] = await Promise.all([
    api.get('/conversions').then(r => r.data?.data ?? r.data ?? []).catch(() => []),
    api.get('/kitaboo/jobs').then(r => r.data?.data ?? r.data ?? []).catch(() => []),
  ]);
  return mergeJobs(reflowRes, fxlRes);
}

/* ─── Hook ────────────────────────────────────────────────────── */
export function useConversionsQuery({ statusFilter = 'all', enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.conversions.list(),   // ← always the same key
    queryFn:  fetchAllJobs,
    enabled,
    staleTime:            2 * 60 * 1000,      // 2 min
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       true,
    // Poll every 5 s only while active jobs exist; stop when all terminal
    refetchInterval: (q) => {
      const jobs = q.state.data;
      return hasActiveJobs(jobs) ? 5000 : false;
    },
  });

  const allJobs = query.data ?? [];

  // Client-side filter — zero extra requests
  const jobs = statusFilter === 'all'
    ? allJobs
    : allJobs.filter(j => j.status === statusFilter);

  // Invalidate the single shared key — all consumers update simultaneously
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.conversions.list() });

  return {
    jobs,        // filtered view
    allJobs,     // full unfiltered list (for dashboard, etc.)
    isLoading:   query.isLoading,
    isFetching:  query.isFetching,
    error:       query.error?.message ?? '',
    refresh,
  };
}
