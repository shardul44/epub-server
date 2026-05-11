/**
 * uiSlice.js — global UI state that must survive navigation.
 *
 * Owns:
 *   - sidebarCollapsed : whether the org-admin sidebar is collapsed
 *   - toast            : { id, type, message, open } for global toasts
 *
 * Per-page UI state stays in its own feature slice (mediaLibrary, orgTeam, etc.).
 * Server data stays in React Query.
 */
import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  toast: { id: null, type: 'info', message: '', open: false },
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSidebarCollapsed(state, action) {
      state.sidebarCollapsed = !!action.payload;
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setMobileSidebarOpen(state, action) {
      state.mobileSidebarOpen = !!action.payload;
    },
    showToast: {
      reducer(state, action) {
        state.toast = { ...action.payload, open: true };
      },
      prepare(payload) {
        const { type = 'info', message = '' } =
          typeof payload === 'string' ? { message: payload } : (payload || {});
        return { payload: { id: nanoid(), type, message } };
      },
    },
    hideToast(state) {
      state.toast.open = false;
    },
    resetUi() {
      return initialState;
    },
  },
});

export const {
  setSidebarCollapsed,
  toggleSidebar,
  setMobileSidebarOpen,
  showToast,
  hideToast,
  resetUi,
} = uiSlice.actions;

/* ─── Selectors ───────────────────────────────────────────────── */
export const selectSidebarCollapsed  = (s) => s.ui.sidebarCollapsed;
export const selectMobileSidebarOpen = (s) => s.ui.mobileSidebarOpen;
export const selectToast             = (s) => s.ui.toast;

export default uiSlice.reducer;
