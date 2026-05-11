/**
 * conversionWorkflowSlice.js
 *
 * Single source of truth for the active PDF → EPUB conversion workflow.
 *
 * Stores the IDs and type information that must survive navigation between
 * the four workflow steps:
 *   1. Upload PDF
 *   2. FXL Editor / Image Editor
 *   3. Audio Sync Studio
 *   4. Download EPUB
 *
 * RULE: Server data (job details, progress) lives in React Query.
 *       This slice owns only the "which job am I working on" state.
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** ID of the uploaded PDF document */
  pdfId: null,
  /** ID of the active conversion job */
  jobId: null,
  /**
   * 'FXL' | 'REFLOW' | null
   * Derived from layoutType on upload; confirmed from job data once available.
   */
  conversionType: null,
  /**
   * 'FIXED_LAYOUT' | 'REFLOWABLE' | null
   * Raw layoutType value from the PDF document.
   */
  layoutType: null,
  /**
   * Job status mirror — kept in sync by useConversionStatus polling.
   * 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null
   */
  status: null,
  /** 0–100 progress percentage */
  progress: 0,
  /** Path to the generated EPUB file once available */
  epubPath: null,
};

const conversionWorkflowSlice = createSlice({
  name: 'conversionWorkflow',
  initialState,
  reducers: {
    /** Called after a successful PDF upload + conversion start */
    setWorkflow(state, action) {
      const { pdfId, jobId, conversionType, layoutType } = action.payload;
      state.pdfId          = pdfId          ?? state.pdfId;
      state.jobId          = jobId          ?? state.jobId;
      state.conversionType = conversionType ?? state.conversionType;
      state.layoutType     = layoutType     ?? state.layoutType;
      state.status         = 'PENDING';
      state.progress       = 0;
      state.epubPath       = null;
    },
    /** Update just the jobId (e.g. after conversion start returns a job) */
    setWorkflowJobId(state, action) {
      state.jobId = action.payload;
    },
    /** Sync status + progress from polling */
    setWorkflowStatus(state, action) {
      const { status, progress, epubPath } = action.payload;
      if (status   !== undefined) state.status   = status;
      if (progress !== undefined) state.progress = progress;
      if (epubPath !== undefined) state.epubPath = epubPath;
    },
    /** Reset when starting a brand-new workflow */
    resetWorkflow() {
      return initialState;
    },
  },
});

export const {
  setWorkflow,
  setWorkflowJobId,
  setWorkflowStatus,
  resetWorkflow,
} = conversionWorkflowSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectWorkflowPdfId          = (s) => s.conversionWorkflow.pdfId;
export const selectWorkflowJobId          = (s) => s.conversionWorkflow.jobId;
export const selectWorkflowConversionType = (s) => s.conversionWorkflow.conversionType;
export const selectWorkflowLayoutType     = (s) => s.conversionWorkflow.layoutType;
export const selectWorkflowStatus         = (s) => s.conversionWorkflow.status;
export const selectWorkflowProgress       = (s) => s.conversionWorkflow.progress;
export const selectWorkflowEpubPath       = (s) => s.conversionWorkflow.epubPath;
export const selectIsFixedLayoutWorkflow  = (s) =>
  s.conversionWorkflow.conversionType === 'FXL' ||
  s.conversionWorkflow.layoutType === 'FIXED_LAYOUT';

export default conversionWorkflowSlice.reducer;
