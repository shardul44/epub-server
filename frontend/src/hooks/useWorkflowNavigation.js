/**
 * useWorkflowNavigation — reusable hook for navigating between workflow steps.
 *
 * Centralises all routing logic so every page uses the same paths.
 * Always uses jobId (never pdfId) for editor/audio-sync/download routes.
 *
 * Route map:
 *   FXL  editor  → /conversions/fxl-editor/:jobId
 *   REFLOW editor → /conversions/image-editor/:jobId
 *   FXL  audio    → /fxl-sync-studio/:jobId (canonical; /audio-sync/fxl/:id redirects)
 *   REFLOW audio  → /sync-studio/:jobId (canonical; /audio-sync/reflow/:id redirects)
 *   download     → /conversions/download/:jobId
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setWorkflow } from '../features/conversionWorkflow/conversionWorkflowSlice';
import { setSelectedJobId as setDownloadJobId } from '../features/downloadEpub/downloadEpubSlice';
import { setSelectedJobId as setAudioJobId }    from '../features/audioSync/audioSyncSlice';

/* ─── Pure helpers (no hooks — safe to import anywhere) ──────── */

/** Normalise job type to 'FXL' | 'REFLOW' */
export function resolveConversionType(job) {
  if (!job) return null;
  const t = job.jobType ?? job.type;
  if (t === 'FXL') return 'FXL';
  if (t === 'REFLOW' || t === 'REFLOWABLE') return 'REFLOW';
  const lt = job.layoutType ?? job.pdf?.layoutType;
  if (lt === 'FIXED_LAYOUT') return 'FXL';
  return 'REFLOW';
}

/** Returns true when the job is Fixed Layout (FXL). */
export function isFixedLayout(job) {
  return resolveConversionType(job) === 'FXL';
}

/** Build the correct editor path for a job. */
export function editorPath(job) {
  const jobId = job?.id ?? job?.jobId;
  return isFixedLayout(job)
    ? `/conversions/fxl-editor/${jobId}`
    : `/conversions/image-editor/${jobId}`;
}

/** Build the correct audio-sync path for a job. */
export function audioSyncPath(job) {
  const jobId = job?.id ?? job?.jobId;
  if (jobId == null || jobId === '') return '/conversions/audio-sync';
  return isFixedLayout(job)
    ? `/fxl-sync-studio/${jobId}`
    : `/sync-studio/${jobId}`;
}

/** Build the download path for a job. */
export function downloadPath(jobId) {
  return `/conversions/download/${jobId}`;
}

/* ─── Hook ────────────────────────────────────────────────────── */

export function useWorkflowNavigation() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  /**
   * Navigate to the correct editor for a job.
   * Also syncs the workflow state in Redux.
   */
  const goToEditor = useCallback((job) => {
    if (!job) return;
    const jobId = job.id ?? job.jobId;
    const pdfId = job.pdfDocumentId ?? job.pdfId;
    const conversionType = resolveConversionType(job);
    const layoutType = job.layoutType ?? (conversionType === 'FXL' ? 'FIXED_LAYOUT' : 'REFLOWABLE');

    dispatch(setWorkflow({ pdfId, jobId, conversionType, layoutType }));
    navigate(editorPath(job));
  }, [navigate, dispatch]);

  /**
   * Sync Redux workflow + audio picker state for a job (no navigation).
   * Call from a `<Link onClick>` before the router follows `to`, or ahead of `goToAudioSync`.
   */
  const primeAudioSyncWorkflow = useCallback((job) => {
    if (!job) return;
    const jobId = job.id ?? job.jobId;
    const pdfId = job.pdfDocumentId ?? job.pdfId;
    const conversionType = resolveConversionType(job);
    const layoutType = job.layoutType ?? (conversionType === 'FXL' ? 'FIXED_LAYOUT' : 'REFLOWABLE');

    dispatch(setWorkflow({ pdfId, jobId, conversionType, layoutType }));
    dispatch(setAudioJobId(String(jobId)));
  }, [dispatch]);

  /**
   * Navigate to the correct in-browser sync studio for a job.
   * Also syncs the audio sync Redux state.
   */
  const goToAudioSync = useCallback((job) => {
    if (!job) return;
    primeAudioSyncWorkflow(job);
    navigate(audioSyncPath(job));
  }, [navigate, primeAudioSyncWorkflow]);

  /**
   * Navigate to the Download EPUB page for a job.
   * Also syncs the download Redux state.
   */
  const goToDownload = useCallback((job) => {
    if (!job) return;
    const jobId = job.id ?? job.jobId;
    const pdfId = job.pdfDocumentId ?? job.pdfId;
    const conversionType = resolveConversionType(job);
    const layoutType = job.layoutType ?? (conversionType === 'FXL' ? 'FIXED_LAYOUT' : 'REFLOWABLE');

    dispatch(setWorkflow({ pdfId, jobId, conversionType, layoutType }));
    dispatch(setDownloadJobId(String(jobId)));
    navigate(downloadPath(jobId));
  }, [navigate, dispatch]);

  /**
   * Navigate to Conversion Jobs page.
   */
  const goToConversions = useCallback(() => {
    navigate('/conversions');
  }, [navigate]);

  return {
    goToEditor,
    goToAudioSync,
    primeAudioSyncWorkflow,
    goToDownload,
    goToConversions,
    // Expose helpers for inline use
    editorPath,
    audioSyncPath,
    downloadPath,
    isFixedLayout,
    resolveConversionType,
  };
}
