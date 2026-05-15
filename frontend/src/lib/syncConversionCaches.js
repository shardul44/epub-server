import { queryKeys } from './queryKeys';

/**
 * Normalize job id fields for cache keys.
 * @param {object} job
 */
function jobKey(job) {
  const id = job?.id ?? job?.jobId;
  return id != null && id !== '' ? String(id) : '';
}

/**
 * Insert or update a conversion/FXL job in the scoped list cache (instant UI).
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {'own'|'org'} scope
 * @param {object} job
 */
export function upsertConversionJobInCache(queryClient, scope, job) {
  const key = jobKey(job);
  if (!key) return;

  const listKey = queryKeys.conversions.list(scope);
  queryClient.setQueryData(listKey, (prev) => {
    const list = Array.isArray(prev) ? prev : [];
    const rest = list.filter((j) => jobKey(j) !== key);
    const normalized = {
      ...job,
      id: job.id ?? job.jobId,
      jobId: job.jobId ?? job.id,
      jobType: job.jobType ?? (job.pdfId || job.pdfDocumentId ? 'FXL' : 'REFLOW'),
      pdfDocumentId: job.pdfDocumentId ?? job.pdfId,
      pdfId: job.pdfId ?? job.pdfDocumentId,
      progressPercentage: job.progressPercentage ?? job.progress ?? 0,
      createdAt: job.createdAt ?? new Date().toISOString(),
      updatedAt: job.updatedAt ?? new Date().toISOString(),
    };
    return [normalized, ...rest];
  });
}

/**
 * Build a cache job object from Kitaboo start response (202).
 * @param {object} data
 * @param {object} [ctx]
 */
export function jobFromKitabooStart(data, ctx = {}) {
  const jobId = data?.jobId ?? data?.id;
  if (!jobId) return null;
  return {
    id: jobId,
    jobId,
    jobType: 'FXL',
    status: data.status ?? 'IN_PROGRESS',
    progressPercentage: data.progressPercentage ?? 0,
    currentStep: data.currentStep ?? 'Starting…',
    pdfDocumentId: data.pdfId ?? ctx.pdfId,
    pdfId: data.pdfId ?? ctx.pdfId,
    pdfFilename: ctx.filename ?? ctx.originalFileName ?? '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build a cache job object from reflow start response (201).
 * @param {object} data
 * @param {object} [ctx]
 */
export function jobFromReflowStart(data, ctx = {}) {
  const jobId = data?.jobId ?? data?.id ?? data?.conversionJobId;
  if (!jobId) return null;
  const pdfId = data.pdfDocumentId ?? data.pdfId ?? ctx.pdfId;
  return {
    id: jobId,
    jobId,
    jobType: 'REFLOW',
    status: data.status ?? 'PENDING',
    progressPercentage: data.progressPercentage ?? 0,
    currentStep: data.currentStep ?? 'Starting…',
    pdfDocumentId: pdfId,
    pdfId,
    pdfFilename: ctx.filename ?? ctx.originalFileName ?? '',
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Refetch conversion lists without wiping optimistic in-flight jobs before the server lists them.
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export async function syncConversionListCaches(queryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.conversions.all(),
    refetchType: 'active',
  });
}
