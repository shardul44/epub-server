/**
 * useJobPolling — thin wrapper around useConversionsQuery.
 * Preserves the legacy { jobs, loading, error, refresh } API surface.
 */
import { useConversionsQuery } from './queries/useConversionsQuery';

export function useJobPolling(statusFilter = 'all') {
  const { jobs, isLoading, error, refresh } = useConversionsQuery({ statusFilter });
  return { jobs, loading: isLoading, error, refresh };
}
