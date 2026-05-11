/**
 * mediaLibrarySlice.js
 *
 * Redux slice for Media Library UI state.
 *
 * Server data (asset list) lives in React Query (useMediaAssetsQuery).
 * This slice owns only UI state that should survive navigation:
 *   - viewMode    — 'grid' | 'list'
 *   - activeTab   — 'All' | 'Images' | 'Videos' | 'Audio' | 'GIFs'
 *   - search      — search string
 *   - sort        — sort key
 *   - showUpload  — whether the upload panel is expanded
 */

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  viewMode:   'grid',
  activeTab:  'All',
  search:     '',
  sort:       'newest',
  showUpload: false,
  uploadError: '',
};

const mediaLibrarySlice = createSlice({
  name: 'mediaLibrary',
  initialState,
  reducers: {
    setViewMode(state, action)   { state.viewMode   = action.payload; },
    setActiveTab(state, action)  { state.activeTab  = action.payload; },
    setSearch(state, action)     { state.search     = action.payload; },
    setSort(state, action)       { state.sort       = action.payload; },
    setShowUpload(state, action) { state.showUpload = action.payload; },
    toggleUpload(state)          { state.showUpload = !state.showUpload; },
    setUploadError(state, action){ state.uploadError = action.payload; },
    clearUploadError(state)      { state.uploadError = ''; },
    resetMediaLibraryUI()        { return initialState; },
  },
});

export const {
  setViewMode,
  setActiveTab,
  setSearch,
  setSort,
  setShowUpload,
  toggleUpload,
  setUploadError,
  clearUploadError,
  resetMediaLibraryUI,
} = mediaLibrarySlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectMLViewMode    = (s) => s.mediaLibrary.viewMode;
export const selectMLActiveTab   = (s) => s.mediaLibrary.activeTab;
export const selectMLSearch      = (s) => s.mediaLibrary.search;
export const selectMLSort        = (s) => s.mediaLibrary.sort;
export const selectMLShowUpload  = (s) => s.mediaLibrary.showUpload;
export const selectMLUploadError = (s) => s.mediaLibrary.uploadError;

export default mediaLibrarySlice.reducer;
