/**
 * usePdfsQuery — React Query hook for the PDF list.
 *
 * Scope is derived from useListScope() (member → own, org_admin → org) unless
 * overridden. Cache keys include scope so member/org lists never collide.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { pdfService } from '../../services/pdfService';
import { useListScope } from '../../context/ListScopeContext';
import { listScopeQueryParams } from '../../utils/listScope';
import {
  removePdfFromListCaches,
  syncPdfAndJobCaches,
  upsertPdfInListCache,
} from '../../lib/syncPdfCaches';

/**
 * @param {{ scope?: 'own'|'org', enabled?: boolean }} [options]
 */
export function usePdfsQuery({ scope: scopeOverride, enabled = true } = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const pdfListKey = queryKeys.pdfs.list(scope);
  const convListKey = queryKeys.conversions.list(scope);

  const query = useQuery({
    queryKey: pdfListKey,
    queryFn: async () => {
      const data = await pdfService.getAllPdfs(listScopeQueryParams(scope));
      return Array.isArray(data) ? data : [];
    },
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });

  const addPdf = (newPdf) => {
    if (!newPdf?.id) return;
    upsertPdfInListCache(queryClient, scope, newPdf);
    void syncPdfAndJobCaches(queryClient);
  };

  const removePdf = (pdfId) => {
    removePdfFromListCaches(queryClient, pdfId, scope);
    queryClient.setQueryData(convListKey, (prev) => {
      if (!Array.isArray(prev)) return prev;
      const pid = String(pdfId);
      return prev.filter((job) => {
        const jPdf = job.pdfDocumentId ?? job.pdfId;
        if (jPdf == null || jPdf === '') return true;
        return String(jPdf) !== pid;
      });
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (pdfId) => pdfService.deletePdf(pdfId),

    onMutate: async (pdfId) => {
      if (import.meta.env.DEV) console.log('[usePdfsQuery] delete — optimistic remove', pdfId);
      await queryClient.cancelQueries({ queryKey: queryKeys.pdfs.all() });
      await queryClient.cancelQueries({ queryKey: queryKeys.conversions.all() });

      const previousPdfs = queryClient.getQueryData(pdfListKey);
      const previousConversions = queryClient.getQueryData(convListKey);

      removePdfFromListCaches(queryClient, pdfId, scope);
      queryClient.setQueryData(convListKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        const pid = String(pdfId);
        return prev.filter((job) => {
          const jPdf = job.pdfDocumentId ?? job.pdfId;
          if (jPdf == null || jPdf === '') return true;
          return String(jPdf) !== pid;
        });
      });

      return { previousPdfs, previousConversions, pdfId };
    },

    onError: (_err, pdfId, context) => {
      if (context?.previousPdfs !== undefined) {
        queryClient.setQueryData(pdfListKey, context.previousPdfs);
      }
      if (context?.previousConversions !== undefined) {
        queryClient.setQueryData(convListKey, context.previousConversions);
      }
    },

    onSettled: async (_data, error, pdfId) => {
      if (import.meta.env.DEV) {
        console.log('[usePdfsQuery] delete settled', { pdfId, ok: !error });
      }
      if (!error) {
        await queryClient.refetchQueries({ queryKey: pdfListKey, exact: true });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.conversions.all(),
          refetchType: 'active',
        });
      }
    },
  });

  const refetch = () => query.refetch();

  return {
    pdfs: query.data ?? [],
    scope,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refetch,
    addPdf,
    removePdf,
    deleteMutation,
  };
}
