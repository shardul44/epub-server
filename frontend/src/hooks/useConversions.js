/**
 * useConversions — thin wrapper around useConversionsQuery.
 * Returns only COMPLETED jobs. Preserves the legacy API surface.
 */
import { useConversionsQuery } from './queries/useConversionsQuery';

export function useConversions({ autoFetch = true } = {}) {
  const { jobs, isLoading, error, refresh } = useConversionsQuery({
    statusFilter: 'COMPLETED',
    enabled: autoFetch,
  });
  return { jobs, loading: isLoading, error, refetch: refresh };
}
