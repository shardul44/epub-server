import { queryKeys } from '../lib/queryKeys';
import { conversionService } from '../services/conversionService';
import { fetchAllJobs } from '../hooks/queries/useConversionsQuery';

function parseIntermediate(job) {
  try {
    const raw = job?.intermediateData ?? job?.intermediate_data;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Whether a job / PDF row should open FXL Sync Studio (not reflow Sync Studio). */
export function isSyncStudioFxl(job, pdf = null) {
  if (job?.jobType === 'FXL') return true;
  if (pdf?.layoutType === 'FIXED_LAYOUT') return true;
  const meta = parseIntermediate(job);
  if (meta?.layout === 'fxl') return true;
  return false;
}

function pickJobForPdf(jobs, pdfDocumentId) {
  if (!Array.isArray(jobs) || pdfDocumentId == null) return null;
  const idStr = String(pdfDocumentId);
  const matches = jobs.filter(
    (j) => j && String(j.pdfDocumentId ?? j.pdfId) === idStr,
  );
  if (matches.length === 0) return null;

  const rank = (j) => {
    if (j.status === 'COMPLETED') return 0;
    if (j.status === 'IN_PROGRESS' || j.status === 'PROCESSING') return 1;
    if (j.status === 'PENDING') return 2;
    return 3;
  };

  return [...matches].sort((a, b) => {
    const rd = rank(a) - rank(b);
    if (rd !== 0) return rd;
    return new Date(b.createdAt ?? b.updatedAt ?? 0) - new Date(a.createdAt ?? a.updatedAt ?? 0);
  })[0];
}

function findInJobs(jobs, pdfDocumentId) {
  const direct = pickJobForPdf(jobs, pdfDocumentId);
  if (direct) return direct;
  return null;
}

/**
 * Resolve the conversion job for an imported EPUB (pdf library stub row).
 * Uses React Query cache when warm, then GET /conversions/pdf/:id, then full job list fetch.
 *
 * @param {object} pdf - PDF document row (epub import stub)
 * @param {{ queryClient?: import('@tanstack/react-query').QueryClient, listScope?: string }} [opts]
 * @returns {Promise<{ job: object, isFxl: boolean } | null>}
 */
export async function resolveSyncStudioJobForPdf(pdf, { queryClient, listScope } = {}) {
  if (!pdf?.id) return null;
  const pdfId = pdf.id;

  if (queryClient && listScope) {
    const cached = queryClient.getQueryData(queryKeys.conversions.list(listScope));
    const fromCache = findInJobs(cached, pdfId);
    if (fromCache) {
      return { job: fromCache, isFxl: isSyncStudioFxl(fromCache, pdf) };
    }
  }

  try {
    const byPdf = await conversionService.getConversionsByPdf(pdfId);
    const job = findInJobs(byPdf, pdfId);
    if (job) {
      if (queryClient && listScope) {
        queryClient.setQueryData(queryKeys.conversions.list(listScope), (prev = []) => {
          const list = Array.isArray(prev) ? prev : [];
          const key = String(job.id ?? job.jobId);
          const next = list.filter((j) => String(j.id ?? j.jobId) !== key);
          return [{ ...job, jobType: isSyncStudioFxl(job, pdf) ? 'FXL' : 'REFLOW' }, ...next];
        });
      }
      return { job, isFxl: isSyncStudioFxl(job, pdf) };
    }
  } catch {
    /* fall through */
  }

  // Fallback: if the DB row exists but conversion_job rows are missing,
  // ask the backend to recreate/ensure the sync job mapping.
  // This avoids the false UI message "No sync job found..." for direct EPUB imports.
  let ensuredOk = false;
  let ensureErr = null;
  try {
    const requestedMode =
      pdf?.layoutType === 'FIXED_LAYOUT' ? 'fxl' : 'reflowable';

    console.log('[SyncStudio] Ensuring EPUB sync job', {
      pdfDocumentId: pdfId,
      requestedMode,
    });

    const ensureRes = await conversionService.ensureEpubSyncJob(pdfId, { mode: requestedMode });
    console.log('[SyncStudio] ensureEpubSyncJob response', {
      pdfDocumentId: pdfId,
      type: typeof ensureRes,
      jobId: ensureRes?.jobId ?? ensureRes?.job?.id ?? ensureRes?.id ?? null,
      kind: ensureRes?.kind ?? null,
    });
    ensuredOk = true;
  } catch (err) {
    ensureErr = err;
    console.warn('[SyncStudio] ensureEpubSyncJob failed', {
      pdfDocumentId: pdfId,
      message: err?.response?.data?.error || err?.response?.data?.message || err?.message || err,
    });
  }

  if (ensuredOk) {
    try {
      const byPdfAfter = await conversionService.getConversionsByPdf(pdfId);
      const jobAfter = findInJobs(byPdfAfter, pdfId);
      if (jobAfter) {
        return { job: jobAfter, isFxl: isSyncStudioFxl(jobAfter, pdf) };
      }
    } catch (err) {
      console.warn('[SyncStudio] getConversionsByPdf after ensure failed', {
        pdfDocumentId: pdfId,
        message: err?.response?.data?.error || err?.response?.data?.message || err?.message || err,
      });
    }
  }

  if (queryClient && listScope) {
    try {
      const all = await fetchAllJobs(listScope);
      queryClient.setQueryData(queryKeys.conversions.list(listScope), all);
      const job = findInJobs(all, pdfId);
      if (job) {
        return { job, isFxl: isSyncStudioFxl(job, pdf) };
      }
    } catch {
      /* ignore */
    }
  }

  if (ensureErr) throw ensureErr;
  return null;
}
