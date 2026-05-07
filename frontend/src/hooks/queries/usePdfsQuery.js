/**
 * usePdfsQuery — React Query hook for the PDF list.
 *
 * Replaces the manual Redux fetchPdfs thunk + usePdfs hook.
 * Data is cached for 5 min (staleTime) and persisted to localStorage.
 *
 * @param {{ scope?: 'own'|'org', enabled?: boolean }} [options]
 * @returns {{ pdfs, isLoading, isFetching, error, refetch }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { pdfService } from '../../services/pdfService';

export function usePdfsQuery({ scope = 'org', enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.pdfs.list(scope),
    queryFn:  () => pdfService.getAllPdfs(scope === 'own' ? { scope: 'own' } : {}),
    enabled,
    // Override global staleTime for PDFs — they change less often
    staleTime: 5 * 60 * 1000,
  });

  /** Force a fresh fetch (e.g. after upload / delete). */
  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.pdfs.all() });

  return {
    pdfs:       query.data ?? [],
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error?.message ?? null,
    refetch,
  };
}
