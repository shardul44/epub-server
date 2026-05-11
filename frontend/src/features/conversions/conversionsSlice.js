/**
 * conversionsSlice.js
 *
 * Redux slice for Conversion Jobs UI state.
 *
 * RULE: Server data (job list) lives in React Query (useConversionsQuery).
 *       This slice owns only UI state that must survive navigation:
 *         - focusedJobId   — which job the banner is showing
 *         - viewMode       — 'card' | 'list'
 *         - statusFilter   — dropdown value
 *         - actionError    — last mutation error message
 *         - deleteModal    — open/loading state (not the job object — that's local)
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  /** ID of the job shown in the FocusedJobBanner. null = no banner. */
  focusedJobId: null,
  /** 'card' | 'list' */
  viewMode: 'card',
  /** Status filter applied client-side to the shared React Query cache. */
  statusFilter: 'all',
  /** Last error from a delete / stop / retry action. */
  actionError: '',
};

const conversionsSlice = createSlice({
  name: 'conversions',
  initialState,
  reducers: {
    setFocusedJobId(state, action) {
      state.focusedJobId = action.payload; // null clears the banner
    },
    setViewMode(state, action) {
      state.viewMode = action.payload;
    },
    setStatusFilter(state, action) {
      state.statusFilter = action.payload;
    },
    setActionError(state, action) {
      state.actionError = action.payload;
    },
    clearActionError(state) {
      state.actionError = '';
    },
    resetConversionsUI() {
      return initialState;
    },
  },
});

export const {
  setFocusedJobId,
  setViewMode,
  setStatusFilter,
  setActionError,
  clearActionError,
  resetConversionsUI,
} = conversionsSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectFocusedJobId   = (s) => s.conversions.focusedJobId;
export const selectViewMode       = (s) => s.conversions.viewMode;
export const selectStatusFilter   = (s) => s.conversions.statusFilter;
export const selectActionError    = (s) => s.conversions.actionError;

export default conversionsSlice.reducer;
