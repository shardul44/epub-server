/**
 * useConversions — thin wrapper around useConversionsQuery.
 * Returns only COMPLETED jobs. Preserves the legacy API surface.
 *
 * Pass `excludeEpubImports: true` on PDF-only workflow pages (Audio Sync
 * Studio, etc.) to hide direct-EPUB-import jobs from the list.
 */
import { useConversionsQuery } from './queries/useConversionsQuery';

export function useConversions({ autoFetch = true, excludeEpubImports = false } = {}) {
  const { jobs, isLoading, error, refresh } = useConversionsQuery({
    statusFilter: 'COMPLETED',
    enabled: autoFetch,
    excludeEpubImports,
  });
  return { jobs, loading: isLoading, error, refetch: refresh };
}
