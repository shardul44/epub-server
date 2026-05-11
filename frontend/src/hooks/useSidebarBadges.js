/**
 * useSidebarBadges — reactive sidebar badge counts.
 *
 * Reads PDF + conversion counts directly from the React Query cache via
 * `useQuery` with the SAME key the page-level hooks use, so:
 *   - No extra network requests (the cache is already populated).
 *   - Updates reactively when the cache changes — no manual subscribe.
 *   - No local useState mirrors that can drift out of sync.
 *
 * Replaces the previous Layout.jsx pattern of:
 *     useState + queryClient.getQueryCache().subscribe + queueMicrotask
 * which had a race window and required eslint-disable comments.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

// React Query requires queryFn to never resolve `undefined`
const noopFetch = () => Promise.resolve([]);

/**
 * @returns {{ pdfCount: number, conversionCount: number }}
 */
export function useSidebarBadges() {
  // We do NOT pass a queryFn that fetches — `enabled: false` prevents any
  // network call. We just subscribe to whatever the page-level hook puts
  // in this cache key. If nothing is there, count is 0.
  const pdfsQuery = useQuery({
    queryKey: queryKeys.pdfs.list(),
    queryFn: noopFetch,
    enabled: false,
    staleTime: Infinity,
    notifyOnChangeProps: ['data'],
  });

  const conversionsQuery = useQuery({
    queryKey: queryKeys.conversions.list(),
    queryFn: noopFetch,
    enabled: false,
    staleTime: Infinity,
    notifyOnChangeProps: ['data'],
  });

  const pdfCount        = Array.isArray(pdfsQuery.data)        ? pdfsQuery.data.length        : 0;
  const conversionCount = Array.isArray(conversionsQuery.data) ? conversionsQuery.data.length : 0;

  return { pdfCount, conversionCount };
}

export default useSidebarBadges;
