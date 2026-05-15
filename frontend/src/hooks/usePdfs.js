/**
 * usePdfs — PDF list hook (React Query). Scope follows signed-in role via useListScope().
 *
 * @param {{ autoFetch?: boolean, scope?: 'own'|'org' }} [options]
 */
import { usePdfsQuery } from './queries/usePdfsQuery';

function usePdfs({ autoFetch = true, scope } = {}) {
  const { pdfs, isLoading, error, refetch, addPdf, removePdf, deleteMutation } = usePdfsQuery({
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
    deleteMutation,
  };
}

export default usePdfs;
