/**
 * useConversionStatus — safe polling hook for a single conversion job.
 *
 * Uses GET /conversion-status/:id which ALWAYS returns JSON (never 404).
 * Response shape:
 *   { exists: false }                                    — job was deleted
 *   { exists: true, status: 'PENDING'|..., data: {...} } — job found
 *
 * Polling rules:
 *   - Does NOT call the API if jobId is null/undefined.
 *   - Polls every 4 s while status is PENDING | PROCESSING | IN_PROGRESS.
 *   - Stops automatically when exists === false OR status is COMPLETED | FAILED.
 *   - Cleans up on unmount (React Query handles this automatically).
 *
 * Usage:
 *   const { status, exists, data, isLoading } = useConversionStatus(jobId);
 *
 * After deleting a job:
 *   setJobId(null);
 *   queryClient.removeQueries({ queryKey: queryKeys.conversions.status(jobId) });
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

const ACTIVE_STATUSES = new Set(['PENDING', 'PROCESSING', 'IN_PROGRESS']);
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

async function fetchConversionStatus(jobId) {
  const res = await api.get(`/conversion-status/${jobId}`);
  return res.data ?? { exists: false };
}

/**
 * @param {number|string|null|undefined} jobId
 * @param {{ onCompleted?: () => void, onDeleted?: () => void }} [callbacks]
 */
export function useConversionStatus(jobId, { onCompleted, onDeleted } = {}) {
  const isEnabled = jobId != null && jobId !== '';

  const query = useQuery({
    queryKey: queryKeys.conversions.status(jobId),
    queryFn:  () => fetchConversionStatus(jobId),
    enabled:  isEnabled,

    staleTime:            0,              // always re-fetch on interval
    refetchOnWindowFocus: false,
    refetchOnReconnect:   true,
    retry:                1,

    // Smart polling: stop when job is done or deleted
    refetchInterval: (q) => {
      const result = q.state.data;
      if (!result) return false;
      if (!result.exists) return false;                          // job deleted → stop
      if (TERMINAL_STATUSES.has(result.status)) return false;   // done → stop
      if (ACTIVE_STATUSES.has(result.status)) return 4000;      // active → poll every 4 s
      return false;
    },

    // Fire callbacks when status changes
    select: (result) => {
      if (!result.exists && onDeleted) {
        // Use setTimeout to avoid calling during render
        setTimeout(onDeleted, 0);
      }
      if (result.exists && result.status === 'COMPLETED' && onCompleted) {
        setTimeout(onCompleted, 0);
      }
      return result;
    },
  });

  const result = query.data ?? { exists: isEnabled ? undefined : false };

  return {
    exists:     result.exists,
    status:     result.exists ? result.status : null,
    data:       result.exists ? result.data   : null,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error?.message ?? null,
    isActive:   result.exists && ACTIVE_STATUSES.has(result.status),
    isTerminal: result.exists && TERMINAL_STATUSES.has(result.status),
  };
}
