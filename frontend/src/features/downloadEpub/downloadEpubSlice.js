/**
 * downloadEpubSlice.js — Redux UI state for Download EPUB page.
 *
 * Server data (jobs) lives in React Query (useConversionsQuery).
 * This slice owns only UI state:
 *   - selectedJobId — which job is shown in the ready card
 *   - error         — last download error
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  selectedJobId: null,
  error:         '',
};

const downloadEpubSlice = createSlice({
  name: 'downloadEpub',
  initialState,
  reducers: {
    setSelectedJobId(state, action) { state.selectedJobId = action.payload; },
    setError(state, action)         { state.error         = action.payload; },
    clearError(state)               { state.error         = ''; },
    resetDownloadEpubUI()           { return initialState; },
  },
});

export const {
  setSelectedJobId,
  setError,
  clearError,
  resetDownloadEpubUI,
} = downloadEpubSlice.actions;

export const selectDESelectedJobId = (s) => s.downloadEpub.selectedJobId;
export const selectDEError         = (s) => s.downloadEpub.error;

export default downloadEpubSlice.reducer;
