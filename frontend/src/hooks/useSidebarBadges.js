/**
 * useSidebarBadges — reactive sidebar badge counts (scoped per role).
 *
 * Reuses the same React Query keys as usePdfsQuery / useConversionsQuery but does
 * NOT register a noop queryFn (that would overwrite the list with [] on refetch).
 */
import { usePdfsQuery } from './queries/usePdfsQuery';
import { useConversionsQuery } from './queries/useConversionsQuery';

/**
 * @returns {{ pdfCount: number, conversionCount: number }}
 */
export function useSidebarBadges() {
  const { pdfs } = usePdfsQuery({ enabled: false });
  const { allJobs } = useConversionsQuery({ enabled: false });

  return {
    pdfCount: pdfs.length,
    conversionCount: allJobs.length,
  };
}

export default useSidebarBadges;
