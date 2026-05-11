/**
 * useConversionActions — encapsulates all conversion job mutations.
 *
 * Extracts delete / stop / retry / openEditor logic from ConversionJobs.jsx
 * so the page component only handles rendering.
 *
 * Uses:
 *   - Redux dispatch for UI state (actionError, focusedJobId)
 *   - useConversionsQuery.refresh() to invalidate the shared cache after mutations
 *   - useWorkflowNavigation for type-safe routing
 */

import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { conversionApi, apiClient } from '../api';
import { useConversionsQuery } from './queries/useConversionsQuery';
import useAppDispatch from './useAppDispatch';
import {
  setActionError,
  clearActionError,
  setFocusedJobId,
} from '../features/conversions/conversionsSlice';
import {
  useWorkflowNavigation,
  isFixedLayout as _isFixedLayout,
  resolveConversionType as _resolveConversionType,
} from './useWorkflowNavigation';

/* ─── Re-export helpers so existing imports keep working ─────── */
export const resolveJobType   = _resolveConversionType;
export const isFixedLayout    = _isFixedLayout;

/* ─── Constants ───────────────────────────────────────────────── */
const MAX_RETRIES = 3;

/* ─── Hook ────────────────────────────────────────────────────── */
export function useConversionActions() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { jobs, refresh } = useConversionsQuery();
  const { goToEditor, goToAudioSync, goToDownload } = useWorkflowNavigation();

  // Stable ref so confirmDelete always reads the latest deleteModal state
  // without needing it as a dependency (avoids stale closure issues).
  const deleteJobRef = useRef(null);

  /* ── Delete ── */
  const prepareDelete = useCallback((job) => {
    deleteJobRef.current = job;
  }, []);

  const confirmDelete = useCallback(async () => {
    const job = deleteJobRef.current;
    if (!job) return;
    const jobId = job.id ?? job.jobId;
    try {
      dispatch(clearActionError());
      if (job.jobType === 'FXL') {
        try {
          await apiClient.delete(`/kitaboo/jobs/${jobId}`);
        } catch (err) {
          // 404 means already removed — treat as success
          if (err.response?.status !== 404) throw err;
        }
      } else {
        await conversionApi.deleteConversionJob(jobId);
      }
      // Clear focused job if it was the deleted one
      dispatch(setFocusedJobId(null));
      refresh();
    } catch (err) {
      dispatch(setActionError(err.message || 'Failed to delete job'));
    }
  }, [dispatch, refresh]);

  /* ── Stop ── */
  const handleStop = useCallback(async (jobId) => {
    try {
      dispatch(clearActionError());
      await conversionApi.stopConversion(jobId);
      refresh();
    } catch (err) {
      dispatch(setActionError(err.message || 'Failed to stop job'));
    }
  }, [dispatch, refresh]);

  /* ── Retry ── */
  const handleRetry = useCallback(async (jobId) => {
    const job = jobs.find(j => String(j.id ?? j.jobId) === String(jobId));
    const jobType = resolveJobType(job);
    if (jobType === 'FXL') {
      // FXL jobs have no retry endpoint — send user to PDFs to start fresh
      navigate('/pdfs');
      return;
    }
    try {
      dispatch(clearActionError());
      await conversionApi.retryConversion(jobId);
      refresh();
    } catch (err) {
      dispatch(setActionError(err.message || 'Failed to retry job'));
    }
  }, [jobs, dispatch, refresh, navigate]);

  /* ── Open editor — uses workflow navigation for correct routing ── */
  const handleOpenEditor = useCallback((job) => {
    if (!job) return;
    goToEditor(job);
  }, [goToEditor]);

  /* ── Navigate from focused job banner ── */
  const handleFocusNavigate = useCallback((path, job) => {
    if (!job) return;

    // Editor step
    if (path === '/conversions/fxl-editor' || path === '/conversions/image-editor') {
      goToEditor(job);
      return;
    }

    // Audio sync step — route by type
    if (path === '/conversions/audio-sync') {
      goToAudioSync(job);
      return;
    }

    // Download step
    if (path === '/conversions/download') {
      goToDownload(job);
      return;
    }

    // Fallback — generic navigation with jobId in state
    navigate(path, { state: { jobId: job.id ?? job.jobId } });
  }, [navigate, goToEditor, goToAudioSync, goToDownload]);

  return {
    prepareDelete,
    confirmDelete,
    deleteJobRef,
    handleStop,
    handleRetry,
    handleOpenEditor,
    handleFocusNavigate,
    MAX_RETRIES,
  };
}
