/**
 * usePdfs — single source of truth for the PDF list.
 *
 * Now backed by React Query (replaces the Redux fetchPdfs thunk).
 * The same return shape is preserved so all existing consumers work unchanged.
 *
 * @param {{ autoFetch?: boolean, scope?: 'own'|'org' }} [options]
 * @returns {{ pdfs, loading, error, refetch, addPdf, removePdf }}
 */

import { usePdfsQuery } from './queries/usePdfsQuery';

function usePdfs({ autoFetch = true, scope = 'org' } = {}) {
  const { pdfs, isLoading, error, refetch, addPdf, removePdf } = usePdfsQuery({
    scope,
    enabled: autoFetch,
  });

  return {
    pdfs,
    loading: isLoading,
    error,
    refetch,
    addPdf,
    removePdf,
  };
}

export default usePdfs;
