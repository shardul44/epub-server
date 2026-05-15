/**
 * usePdfDetailQuery — single PDF by id (tenant enforced on GET /pdfs/:id).
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { pdfService } from '../../services/pdfService';

/**
 * @param {string|number|null|undefined} pdfId
 * @param {{ enabled?: boolean }} [options]
 */
export function usePdfDetailQuery(pdfId, { enabled = true } = {}) {
  const id = pdfId != null && pdfId !== '' ? Number(pdfId) : NaN;
  const valid = Number.isFinite(id) && id > 0;

  return useQuery({
    queryKey: queryKeys.pdfs.detail(valid ? id : 'invalid'),
    queryFn: () => pdfService.getPdfById(id),
    enabled: enabled && valid,
    staleTime: 30 * 1000,
    retry: (failureCount, err) => {
      const status = err?.response?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 1;
    },
  });
}
