/**
 * orgTeamSlice.js — Redux UI state for Org Team page.
 *
 * Server data (members, activities) lives in React Query (useOrgTeamQuery).
 * This slice owns only UI state:
 *   - search          — member search string
 *   - roleFilter      — 'all' | 'org_admin' | 'member'
 *   - activeModal     — null | 'editUser' | 'bulkInvite' | 'auditLog' | 'sso' | 'permissions'
 *   - editingMemberId — id of the member being edited
 *   - error           — last mutation error
 */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  search:          '',
  roleFilter:      'all',
  activeModal:     null,
  editingMemberId: null,
  error:           '',
};

const orgTeamSlice = createSlice({
  name: 'orgTeam',
  initialState,
  reducers: {
    setSearch(state, action)          { state.search          = action.payload; },
    setRoleFilter(state, action)      { state.roleFilter      = action.payload; },
    openModal(state, action)          { state.activeModal     = action.payload; },
    closeModal(state)                 { state.activeModal     = null; state.editingMemberId = null; },
    openEditModal(state, action)      { state.activeModal = 'editUser'; state.editingMemberId = action.payload; },
    setError(state, action)           { state.error           = action.payload; },
    clearError(state)                 { state.error           = ''; },
    resetOrgTeamUI()                  { return initialState; },
  },
});

export const {
  setSearch,
  setRoleFilter,
  openModal,
  closeModal,
  openEditModal,
  setError,
  clearError,
  resetOrgTeamUI,
} = orgTeamSlice.actions;

export const selectOTSearch          = (s) => s.orgTeam.search;
export const selectOTRoleFilter      = (s) => s.orgTeam.roleFilter;
export const selectOTActiveModal     = (s) => s.orgTeam.activeModal;
export const selectOTEditingMemberId = (s) => s.orgTeam.editingMemberId;
export const selectOTError           = (s) => s.orgTeam.error;

export default orgTeamSlice.reducer;
