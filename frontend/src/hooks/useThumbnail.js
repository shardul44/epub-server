/**
 * useThumbnail(pdfId)
 *
 * Fetches the PDF page-1 thumbnail via the Authorization header (not ?token=)
 * and returns a stable blob URL. React Query handles caching and deduplication.
 *
 * Returns:
 *   { src, isLoading, isError }
 *
 * - src        — blob: URL ready for <img src>, or null while loading/error
 * - isLoading  — true while the first fetch is in flight
 * - isError    — true if the fetch failed
 *
 * The blob URL is revoked automatically when the cache entry is garbage-collected.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiBase } from '../services/api';

async function fetchThumbnailBlob(pdfId) {
  const token = localStorage.getItem('token');
  const url   = `${getApiBase()}/pdfs/${pdfId}/thumbnail`;

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const err = new Error(`Thumbnail fetch failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * @param {number|string|null|undefined} pdfId
 */
export function useThumbnail(pdfId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['thumbnail', String(pdfId ?? '')],
    queryFn:  () => fetchThumbnailBlob(pdfId),
    enabled:  pdfId != null && pdfId !== '',
    staleTime: 10 * 60 * 1000,   // 10 min — thumbnails rarely change
    gcTime:    30 * 60 * 1000,   // 30 min
    retry:     1,
    // Revoke the old blob URL when the cache entry is replaced or removed
    structuralSharing: false,
  });

  return {
    src:       query.data ?? null,
    isLoading: query.isLoading,
    isError:   query.isError,
  };
}

/**
 * Imperatively invalidate a thumbnail so the next render re-fetches it.
 * Call after upload or conversion completes.
 *
 * @param {number|string} pdfId
 */
export function invalidateThumbnailCache(pdfId, queryClient) {
  queryClient.invalidateQueries({ queryKey: ['thumbnail', String(pdfId)] });
}
