/**
 * slices/index.js — barrel re-export for every Redux slice.
 *
 * Prefer:
 *   import { selectUser, loginUser, setFocusedJobId } from '@/slices';
 *
 * Legacy imports from `features/<name>/<name>Slice` continue to work.
 *
 * The actual reducer files still live under `features/` so we don't have
 * to touch the 100+ existing import sites in this refactor pass. This
 * barrel gives going-forward code a single, clean import path.
 */

// ── Core ──────────────────────────────────────────────────────
export * from '../features/auth/authSlice';
export * from '../features/dashboard/dashboardSlice';
export * from '../features/epub/epubSlice';
export * from '../features/pdfs/pdfsSlice';

// ── Org/page UI slices ───────────────────────────────────────
export * from '../features/conversions/conversionsSlice';
export * from '../features/mediaLibrary/mediaLibrarySlice';
export * from '../features/orgTeam/orgTeamSlice';
export * from '../features/usage/usageSlice';
export * from '../features/audioSync/audioSyncSlice';
export * from '../features/downloadEpub/downloadEpubSlice';

// ── Active-workflow slice ────────────────────────────────────
export * from '../features/conversionWorkflow/conversionWorkflowSlice';

// ── Global UI slice (new) ────────────────────────────────────
export * from './uiSlice';

/* ─── Default reducer exports — used by the store ─────────── */
export { default as authReducer }               from '../features/auth/authSlice';
export { default as dashboardReducer }          from '../features/dashboard/dashboardSlice';
export { default as epubReducer }               from '../features/epub/epubSlice';
export { default as pdfsReducer }               from '../features/pdfs/pdfsSlice';
export { default as conversionsReducer }        from '../features/conversions/conversionsSlice';
export { default as mediaLibraryReducer }       from '../features/mediaLibrary/mediaLibrarySlice';
export { default as orgTeamReducer }            from '../features/orgTeam/orgTeamSlice';
export { default as usageReducer }              from '../features/usage/usageSlice';
export { default as audioSyncReducer }          from '../features/audioSync/audioSyncSlice';
export { default as downloadEpubReducer }       from '../features/downloadEpub/downloadEpubSlice';
export { default as conversionWorkflowReducer } from '../features/conversionWorkflow/conversionWorkflowSlice';
export { default as uiReducer }                 from './uiSlice';
