import { queryKeys } from './queryKeys';

/**
 * Insert or replace a PDF in the scoped list cache (instant UI update).
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {'own'|'org'} scope
 * @param {object} pdf
 */
export function upsertPdfInListCache(queryClient, scope, pdf) {
  if (!pdf?.id) return;
  const listKey = queryKeys.pdfs.list(scope);
  queryClient.setQueryData(listKey, (prev) => {
    const list = Array.isArray(prev) ? prev : [];
    const idStr = String(pdf.id);
    const rest = list.filter((p) => p?.id != null && String(p.id) !== idStr);
    return [pdf, ...rest];
  });
}

/**
 * Remove a PDF from every cached list (all scopes).
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string|number} pdfId
 */
export function removePdfFromListCaches(queryClient, pdfId, scope = 'org') {
  const idStr = String(pdfId);
  const scopes = scope ? [scope] : ['own', 'org'];
  for (const s of scopes) {
    queryClient.setQueryData(queryKeys.pdfs.list(s), (prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p) => p?.id != null && String(p.id) !== idStr);
    });
  }
  queryClient.removeQueries({ queryKey: queryKeys.pdfs.detail(pdfId) });
}

/**
 * Refetch PDF lists from the server after mutations (upload/delete).
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export async function syncPdfListCaches(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.pdfs.all(),
    refetchType: 'active',
  });
}

/**
 * Invalidate PDF + related job caches.
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export async function syncPdfAndJobCaches(queryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.pdfs.all(), refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.conversions.all(), refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.kitabooJobs.all(), refetchType: 'active' }),
  ]);
}
