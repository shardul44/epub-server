/**
 * useOrgTeamActions — encapsulates all org team member mutations.
 *
 * Extracts create / edit / delete / role-change / resend-invite logic
 * from OrgTeam.jsx so the page component only handles rendering.
 *
 * Uses:
 *   - useOrgTeamQuery.refresh() to invalidate the shared cache after mutations
 *   - Redux dispatch for modal state (openEditModal, closeModal)
 *   - orgTeamService for all API calls
 */

import { useCallback } from 'react';
import { orgTeamService } from '../services/orgTeamService';
import { useOrgTeamQuery } from './queries/useOrgTeamQuery';
import useAppDispatch from './useAppDispatch';
import {
  openEditModal,
  closeModal,
} from '../features/orgTeam/orgTeamSlice';

export function useOrgTeamActions({ onSuccess, onError } = {}) {
  const dispatch    = useAppDispatch();
  const { refresh } = useOrgTeamQuery({ enabled: false }); // don't auto-fetch here

  /* ── Edit user ── */
  const handleEditUser = useCallback((member) => {
    dispatch(openEditModal(member.id));
  }, [dispatch]);

  /* ── Save user edits ── */
  const handleSaveUser = useCallback(async (memberId, body) => {
    await orgTeamService.updateUser(memberId, body);
    dispatch(closeModal());
    await refresh();
    onSuccess?.('User updated successfully');
  }, [dispatch, refresh, onSuccess]);

  /* ── Change role ── */
  const handleChangeRole = useCallback(async (member, newRole) => {
    try {
      await orgTeamService.updateUserRole(member.id, newRole);
      await refresh();
      onSuccess?.(`Role updated to ${newRole}`);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to change role');
    }
  }, [refresh, onSuccess, onError]);

  /* ── Delete / remove member ── */
  const handleDeleteMember = useCallback(async (member) => {
    try {
      await orgTeamService.deleteUser(member.id);
      await refresh();
      onSuccess?.('Member removed');
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to remove member');
    }
  }, [refresh, onSuccess, onError]);

  /* ── Resend invite ── */
  const handleResendInvite = useCallback(async (member) => {
    try {
      await orgTeamService.resendInvite(member.id);
      onSuccess?.(`Invite re-sent to ${member.email}`);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to resend invite');
    }
  }, [onSuccess, onError]);

  /* ── Create user ── */
  const handleCreateUser = useCallback(async (userData) => {
    await orgTeamService.createUser(userData);
    await refresh();
    onSuccess?.('User created successfully');
  }, [refresh, onSuccess]);

  return {
    handleEditUser,
    handleSaveUser,
    handleChangeRole,
    handleDeleteMember,
    handleResendInvite,
    handleCreateUser,
  };
}
