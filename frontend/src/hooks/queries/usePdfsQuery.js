/**
 * usePdfsQuery — React Query hook for the PDF list.
 *
 * PDFs are intentionally NOT persisted to localStorage (see queryClient.js).
 * This prevents deleted/stale PDFs from reappearing on page reload.
 *
 * staleTime: 5 s — short grace window so an optimistic cache seed written by
 * PdfUpload is not immediately overwritten by the mount-fetch on PdfList.
 * After 5 s the data is stale and the next mount/refetch hits the server.
 *
 * @param {{ scope?: 'own'|'org', enabled?: boolean }} [options]
 * @returns {{ pdfs, isLoading, isFetching, error, refetch, addPdf, removePdf }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { queryKeys } from '../../lib/queryKeys';
import { pdfService } from '../../services/pdfService';

export function usePdfsQuery({ scope = 'org', enabled = true } = {}) {
  const queryClient = useQueryClient();

  // Track IDs deleted in this session so they are filtered out of every
  // server response — even if the background refetch races back before the
  // DB cascade has finished and still includes the deleted row.
  // Using a ref (not state) so mutations don't trigger extra re-renders.
  const deletedIdsRef = useRef(new Set());

  const query = useQuery({
    queryKey: queryKeys.pdfs.list(),
    queryFn:  async () => {
      const data = await pdfService.getAllPdfs(scope === 'own' ? { scope: 'own' } : {});
      // React Query requires queryFn to never return `undefined`
      const safeData = data ?? [];
      // Strip any IDs that were deleted in this session before caching
      if (deletedIdsRef.current.size === 0) return safeData;
      return Array.isArray(safeData)
        ? safeData.filter((p) => !deletedIdsRef.current.has(p.id))
        : safeData;
    },
    enabled,
    staleTime: 5_000,
  });

  /**
   * Optimistically prepend a newly uploaded PDF to the cache so the card
   * appears immediately after upload without waiting for the refetch.
   */
  const addPdf = (newPdf) => {
    if (!newPdf?.id) return;
    console.log('[usePdfsQuery] addPdf — id:', newPdf.id);

    queryClient.setQueryData(queryKeys.pdfs.list(), (prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.some((p) => p.id === newPdf.id)) return list;
      const next = [newPdf, ...list];
      console.log('[usePdfsQuery] cache updated — added id', newPdf.id, '| total:', next.length);
      return next;
    });

    // Delay the background refetch so the seeded cache has time to render
    // before the server response arrives.
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pdfs.all() });
    }, 3_000);
  };

  /**
   * Immediately remove a deleted PDF from the in-memory cache so the card
   * disappears without waiting for the background refetch.
   *
   * The ID is also added to deletedIdsRef so that if the background refetch
   * races back with the deleted row still in it (server propagation lag),
   * the queryFn strips it before it ever reaches the cache.
   *
   * Also purges related conversion jobs from the shared conversions cache so
   * stale ConversionCards don't render and trigger 404 API calls.
   */
  const removePdf = (pdfId) => {
    console.log('[usePdfsQuery] removePdf — pdfId:', pdfId);

    // 1. Record the deletion so every future server response is filtered.
    deletedIdsRef.current.add(pdfId);

    // 2. Optimistic update — filter the item out of the current cache immediately.
    queryClient.setQueryData(queryKeys.pdfs.list(), (prev) => {
      if (!Array.isArray(prev)) return prev;
      const next = prev.filter((p) => p.id !== pdfId);
      console.log('[usePdfsQuery] cache updated — removed id', pdfId, '| remaining:', next.length);
      return next;
    });

    // 3. Remove the detail cache entry if present.
    queryClient.removeQueries({ queryKey: queryKeys.pdfs.detail(pdfId) });

    // 4. Purge related conversion jobs from the shared conversions cache.
    //    The backend deletes conversion_jobs rows on PDF deletion, but the
    //    frontend cache still holds them — causing stale cards to render and
    //    fire GET /conversions/<id> requests that return 404.
    queryClient.setQueryData(queryKeys.conversions.list(), (prev) => {
      if (!Array.isArray(prev)) return prev;
      const next = prev.filter(
        (job) => (job.pdfDocumentId ?? job.pdfId) !== pdfId,
      );
      console.log(
        '[usePdfsQuery] conversions cache updated — removed jobs for pdfId',
        pdfId,
        '| remaining:',
        next.length,
      );
      return next;
    });

    // 5. Background refetch to confirm deletion and sync any other changes.
    //    Delayed so the optimistic update renders first. The deletedIdsRef
    //    guard in queryFn ensures the deleted ID is stripped even if the
    //    server response still includes it.
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pdfs.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversions.list() });
      console.log('[usePdfsQuery] background refetch queued');
    }, 500);
  };

  /** Force an immediate fresh fetch. */
  const refetch = () => query.refetch();

  return {
    pdfs:       query.data ?? [],
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error?.message ?? null,
    refetch,
    addPdf,
    removePdf,
  };
}
