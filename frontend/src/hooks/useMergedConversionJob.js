import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConversionsQuery } from './queries/useConversionsQuery';
import { conversionService } from '../services/conversionService';
import { kitabooService } from '../services/kitabooService';
import { jobIdOf } from '../components/admin/conversionJobDisplay';

export { jobIdOf };

/**
 * Merge list-row job data with GET /conversions/:id or Kitaboo job detail.
 * @param {string|number|null} jobIdStr
 * @param {object|null} listJobOverride — job from card click (skips list scan when provided)
 */
export function useMergedConversionJob(jobIdStr, listJobOverride = null) {
  const { allJobs, isLoading: listLoading } = useConversionsQuery({ enabled: true });

  const listJob = useMemo(() => {
    if (listJobOverride) return listJobOverride;
    if (!jobIdStr) return null;
    return (Array.isArray(allJobs) ? allJobs : []).find(
      (j) => String(jobIdOf(j)) === String(jobIdStr),
    );
  }, [allJobs, jobIdStr, listJobOverride]);

  const isFxlFromList = String(listJob?.jobType || '').toUpperCase() === 'FXL';

  const detailQuery = useQuery({
    queryKey: ['admin', 'conversion-job-detail', jobIdStr, isFxlFromList ? 'fxl' : 'reflow'],
    queryFn: async () => {
      const id = Number(jobIdStr);
      if (!Number.isFinite(id)) return { job: null, source: null };

      if (isFxlFromList) {
        try {
          const fxl = await kitabooService.getJob(id);
          if (fxl) return { job: fxl, source: 'FXL' };
        } catch {
          /* 404 */
        }
        return { job: null, source: null };
      }

      const reflow = await conversionService.getConversionJob(id);
      if (reflow) return { job: reflow, source: 'REFLOW' };
      try {
        const fxl = await kitabooService.getJob(id);
        if (fxl) return { job: fxl, source: 'FXL' };
      } catch {
        /* 404 */
      }
      return { job: null, source: null };
    },
    enabled: Boolean(jobIdStr) && (!listLoading || Boolean(listJobOverride)),
    staleTime: 30 * 1000,
  });

  const merged = useMemo(() => {
    const d = detailQuery.data?.job;
    if (!listJob && !d) return null;
    return { ...(listJob || {}), ...(d || {}) };
  }, [listJob, detailQuery.data]);

  return {
    merged,
    listJob,
    detailQuery,
    source: detailQuery.data?.source,
    listLoading: listJobOverride ? false : listLoading,
  };
}

export function formatConversionWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
