/**
 * store.js — central Redux Toolkit store.
 *
 * Reducers are imported from the slices barrel (`@/slices`) so adding a
 * new slice only requires:
 *   1. Drop the slice file in `slices/`
 *   2. Re-export it from `slices/index.js`
 *   3. Add it to the reducer map below
 *
 * Convention:
 *   - Server data → React Query (lives in cache, not Redux)
 *   - Per-page UI state → its own slice (mediaLibrary, orgTeam, …)
 *   - Cross-cutting UI (toasts, sidebar) → uiSlice
 *   - Authentication → authSlice (with thunks)
 *   - Active conversion workflow → conversionWorkflowSlice
 */
import { configureStore } from '@reduxjs/toolkit';
import {
  authReducer,
  dashboardReducer,
  epubReducer,
  pdfsReducer,
  conversionsReducer,
  mediaLibraryReducer,
  orgTeamReducer,
  usageReducer,
  audioSyncReducer,
  downloadEpubReducer,
  conversionWorkflowReducer,
  uiReducer,
} from '../slices';

const store = configureStore({
  reducer: {
    // ── Core ──────────────────────────────────────────────────────
    auth:               authReducer,
    dashboard:          dashboardReducer,
    epub:               epubReducer,
    pdfs:               pdfsReducer,

    // ── Per-page UI state (server data lives in React Query) ──────
    conversions:        conversionsReducer,
    mediaLibrary:       mediaLibraryReducer,
    orgTeam:            orgTeamReducer,
    usage:              usageReducer,
    audioSync:          audioSyncReducer,
    downloadEpub:       downloadEpubReducer,

    // ── Active workflow (pdfId, jobId, conversionType, layoutType) ─
    conversionWorkflow: conversionWorkflowReducer,

    // ── Global UI (sidebar collapsed, toasts, modal stack) ────────
    ui:                 uiReducer,
  },
  // Redux DevTools is enabled automatically in development.
  // Thunk middleware is included by default via configureStore.
  devTools: import.meta.env.DEV,
});

export default store;
