import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, UserCheck, AlertTriangle, UserPlus, Download, Pencil } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../context/AuthContext';
import './UsersManagement.css';

const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  ORG_ADMIN: 'org_admin',
  MEMBER: 'member',
};

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role) {
  if (role === ROLES.PLATFORM_ADMIN) return 'Platform Admin';
  if (role === ROLES.ORG_ADMIN) return 'Org Admin';
  return 'Member';
}

function rolePillClass(role) {
  if (role === ROLES.PLATFORM_ADMIN) return 'umgmt-pill umgmt-pill--platform';
  if (role === ROLES.ORG_ADMIN) return 'umgmt-pill umgmt-pill--org';
  return 'umgmt-pill umgmt-pill--member';
}

function statusPillClass(status) {
  if (status === 'suspended') return 'umgmt-pill umgmt-pill--suspended';
  if (status === 'pending_verification') return 'umgmt-pill umgmt-pill--pending';
  return 'umgmt-pill umgmt-pill--active';
}

function statusLabel(status) {
  if (status === 'suspended') return 'Suspended';
  if (status === 'pending_verification') return 'Pending';
  return 'Active';
}

function formatLastActive(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today ${timeStr}`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeCsvField(s) {
  const str = String(s ?? '');
  if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export default function UsersManagement() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [pageError, setPageError] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [modalError, setModalError] = useState('');

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState(ROLES.MEMBER);
  const [inviteOrgId, setInviteOrgId] = useState('');

  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState(ROLES.MEMBER);
  const [editOrgId, setEditOrgId] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => adminService.getAllUsers(),
    staleTime: 30 * 1000,
  });

  const orgsQuery = useQuery({
    queryKey: ['admin', 'organizations', 'users-page'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const users = Array.isArray(usersQuery.data) ? usersQuery.data : [];
  const organizations = Array.isArray(orgsQuery.data) ? orgsQuery.data : [];

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.status === 'active').length;
    const pending = users.filter((u) => u.status === 'pending_verification').length;
    return { total, active, pending };
  }, [users]);

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.appBootstrap() });
  };

  const createMutation = useMutation({
    mutationFn: (body) => adminService.createUser(body),
    onSuccess: async () => {
      setInviteOpen(false);
      resetInvite();
      setModalError('');
      await invalidateAll();
    },
    onError: (e) => {
      setModalError(e.response?.data?.error || e.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => adminService.updateUser(id, body),
    onSuccess: async () => {
      setEditUser(null);
      setModalError('');
      await invalidateAll();
    },
    onError: (e) => {
      setModalError(e.response?.data?.error || e.message);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => adminService.updateUserStatus(id, status),
    onSuccess: async () => {
      await invalidateAll();
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message);
    },
  });

  const resetInvite = () => {
    setInviteName('');
    setInviteEmail('');
    setInvitePassword('');
    setInviteRole(ROLES.MEMBER);
    setInviteOrgId(organizations[0]?.id != null ? String(organizations[0].id) : '');
  };

  const openInvite = () => {
    setModalError('');
    resetInvite();
    setInviteOpen(true);
  };

  const openEdit = (u) => {
    setModalError('');
    setEditName(u.name || '');
    setEditEmail(u.email || '');
    setEditRole(u.role || ROLES.MEMBER);
    setEditOrgId(u.organizationId != null ? String(u.organizationId) : '');
    setEditPassword('');
    setEditUser(u);
  };

  const submitInvite = (e) => {
    e.preventDefault();
    setModalError('');
    const body = {
      name: inviteName.trim(),
      email: inviteEmail.trim().toLowerCase(),
      password: invitePassword,
      role: inviteRole,
    };
    if (inviteRole !== ROLES.PLATFORM_ADMIN) {
      const oid = parseInt(inviteOrgId, 10);
      if (!inviteOrgId || Number.isNaN(oid)) {
        setModalError('Select an organization for this role.');
        return;
      }
      body.organizationId = oid;
    }
    createMutation.mutate(body);
  };

  const submitEdit = (e) => {
    e.preventDefault();
    if (!editUser) return;
    setModalError('');
    const body = {
      name: editName.trim(),
      email: editEmail.trim().toLowerCase(),
      role: editRole,
    };
    if (editPassword.trim()) body.password = editPassword;
    if (editRole === ROLES.PLATFORM_ADMIN) {
      body.organizationId = null;
    } else {
      const oid = parseInt(editOrgId, 10);
      if (!editOrgId || Number.isNaN(oid)) {
        setModalError('Select an organization for this role.');
        return;
      }
      body.organizationId = oid;
    }
    updateMutation.mutate({ id: editUser.id, body });
  };

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Role', 'Organization', 'Plan', 'Status', 'Last active'];
    const lines = [
      headers.map(escapeCsvField).join(','),
      ...users.map((u) =>
        [
          u.name,
          u.email,
          u.role,
          u.organizationName || '—',
          u.planName || '—',
          u.status || 'active',
          u.lastActive ? new Date(u.lastActive).toISOString() : '',
        ]
          .map(escapeCsvField)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSuspend = (u) => {
    setPageError('');
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    if (next === 'suspended' && currentUser?.id === u.id) {
      setPageError('You cannot suspend your own account.');
      return;
    }
    statusMutation.mutate({ id: u.id, status: next });
  };

  if (usersQuery.isLoading) {
    return (
      <div className="umgmt-root">
        <div className="umgmt-inner umgmt-loading">
          <div className="umgmt-spinner" aria-hidden />
          Loading users…
        </div>
      </div>
    );
  }

  if (usersQuery.isError) {
    return (
      <div className="umgmt-root">
        <div className="umgmt-inner">
          <div className="umgmt-alert">
            {usersQuery.error?.message || 'Failed to load users. Ensure the database migration for user status has been applied (see backend/database/migrations/013_users_status_last_active.sql).'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="umgmt-root">
      <div className="umgmt-inner">
        <header className="umgmt-head">
          <h1 className="umgmt-title">User Management</h1>
          <p className="umgmt-sub">View, edit, suspend or remove users across all organizations.</p>
        </header>

        {pageError && <div className="umgmt-alert">{pageError}</div>}

        <div className="umgmt-kpis">
          <div className="umgmt-kpi">
            <div className="umgmt-kpi-icon umgmt-kpi-icon--blue" aria-hidden>
              <Users size={22} />
            </div>
            <div>
              <div className="umgmt-kpi-label">Total users</div>
              <div className="umgmt-kpi-value">{stats.total}</div>
            </div>
          </div>
          <div className="umgmt-kpi">
            <div className="umgmt-kpi-icon umgmt-kpi-icon--green" aria-hidden>
              <UserCheck size={22} />
            </div>
            <div>
              <div className="umgmt-kpi-label">Active</div>
              <div className="umgmt-kpi-value">{stats.active}</div>
            </div>
          </div>
          <div className="umgmt-kpi">
            <div className="umgmt-kpi-icon umgmt-kpi-icon--amber" aria-hidden>
              <AlertTriangle size={22} />
            </div>
            <div>
              <div className="umgmt-kpi-label">Pending verification</div>
              <div className="umgmt-kpi-value">{stats.pending}</div>
            </div>
          </div>
        </div>

        <section className="umgmt-card" aria-labelledby="umgmt-all-users">
          <div className="umgmt-card-head">
            <h2 id="umgmt-all-users" className="umgmt-card-title">
              All Users
            </h2>
            <div className="umgmt-actions">
              <button type="button" className="umgmt-btn-primary" onClick={openInvite}>
                <UserPlus size={18} aria-hidden />
                Invite user
              </button>
              <button type="button" className="umgmt-btn-secondary" onClick={exportCsv} disabled={!users.length}>
                <Download size={18} aria-hidden />
                Export
              </button>
            </div>
          </div>
          <div className="umgmt-table-wrap">
            <table className="umgmt-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Last active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="umgmt-user-cell">
                        <div className="umgmt-avatar" aria-hidden>
                          {initials(u.name)}
                        </div>
                        <div className="umgmt-user-text">
                          <div className="umgmt-user-name">{u.name}</div>
                          <div className="umgmt-user-email">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={rolePillClass(u.role)}>{roleLabel(u.role)}</span>
                    </td>
                    <td>{u.organizationName || <span className="umgmt-muted">—</span>}</td>
                    <td>{u.planName || <span className="umgmt-muted">—</span>}</td>
                    <td>
                      <span className={statusPillClass(u.status)}>{statusLabel(u.status)}</span>
                    </td>
                    <td>{formatLastActive(u.lastActive)}</td>
                    <td>
                      <div className="umgmt-row-actions">
                        <button type="button" className="umgmt-icon-btn" onClick={() => openEdit(u)}>
                          <Pencil size={15} aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="umgmt-icon-btn umgmt-icon-btn--danger"
                          disabled={statusMutation.isPending || (currentUser?.id === u.id && u.status !== 'suspended')}
                          onClick={() => toggleSuspend(u)}
                        >
                          {u.status === 'suspended' ? 'Activate' : 'Suspend'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!users.length && (
              <div className="umgmt-loading" style={{ padding: 32 }}>
                No users found.
              </div>
            )}
          </div>
        </section>
      </div>

      {inviteOpen && (
        <div
          className="umgmt-modal-backdrop"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && !createMutation.isPending && setInviteOpen(false)}
        >
          <div className="umgmt-modal" role="dialog" aria-labelledby="umgmt-invite-title">
            <h3 id="umgmt-invite-title">Invite user</h3>
            <p className="umgmt-modal-desc">Create an account. Password must be at least 6 characters with letters and numbers.</p>
            {modalError && <div className="umgmt-modal-error">{modalError}</div>}
            <form onSubmit={submitInvite}>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-inv-name">
                  Name
                </label>
                <input
                  id="umgmt-inv-name"
                  className="umgmt-input"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-inv-email">
                  Email
                </label>
                <input
                  id="umgmt-inv-email"
                  className="umgmt-input"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-inv-pass">
                  Password
                </label>
                <input
                  id="umgmt-inv-pass"
                  className="umgmt-input"
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-inv-role">
                  Role
                </label>
                <select
                  id="umgmt-inv-role"
                  className="umgmt-select"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value={ROLES.MEMBER}>Member</option>
                  <option value={ROLES.ORG_ADMIN}>Org Admin</option>
                  <option value={ROLES.PLATFORM_ADMIN}>Platform Admin</option>
                </select>
              </div>
              {inviteRole !== ROLES.PLATFORM_ADMIN && (
                <div className="umgmt-field">
                  <label className="umgmt-label" htmlFor="umgmt-inv-org">
                    Organization
                  </label>
                  <select
                    id="umgmt-inv-org"
                    className="umgmt-select"
                    value={inviteOrgId}
                    onChange={(e) => setInviteOrgId(e.target.value)}
                    required
                  >
                    <option value="">Select organization…</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="umgmt-modal-actions">
                <button
                  type="button"
                  className="umgmt-btn-ghost"
                  onClick={() => !createMutation.isPending && setInviteOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="umgmt-btn-submit" disabled={createMutation.isPending}>
                  Create user
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editUser && (
        <div
          className="umgmt-modal-backdrop"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && !updateMutation.isPending && setEditUser(null)}
        >
          <div className="umgmt-modal" role="dialog" aria-labelledby="umgmt-edit-title">
            <h3 id="umgmt-edit-title">Edit user</h3>
            <p className="umgmt-modal-desc">Update profile and access. Leave password blank to keep the current password.</p>
            {modalError && <div className="umgmt-modal-error">{modalError}</div>}
            <form onSubmit={submitEdit}>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-ed-name">
                  Name
                </label>
                <input
                  id="umgmt-ed-name"
                  className="umgmt-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-ed-email">
                  Email
                </label>
                <input
                  id="umgmt-ed-email"
                  className="umgmt-input"
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-ed-role">
                  Role
                </label>
                <select
                  id="umgmt-ed-role"
                  className="umgmt-select"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  <option value={ROLES.MEMBER}>Member</option>
                  <option value={ROLES.ORG_ADMIN}>Org Admin</option>
                  <option value={ROLES.PLATFORM_ADMIN}>Platform Admin</option>
                </select>
              </div>
              {editRole !== ROLES.PLATFORM_ADMIN && (
                <div className="umgmt-field">
                  <label className="umgmt-label" htmlFor="umgmt-ed-org">
                    Organization
                  </label>
                  <select
                    id="umgmt-ed-org"
                    className="umgmt-select"
                    value={editOrgId}
                    onChange={(e) => setEditOrgId(e.target.value)}
                    required
                  >
                    <option value="">Select organization…</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="umgmt-field">
                <label className="umgmt-label" htmlFor="umgmt-ed-pass">
                  New password (optional)
                </label>
                <input
                  id="umgmt-ed-pass"
                  className="umgmt-input"
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <div className="umgmt-hint">Only fill if you want to reset the password.</div>
              </div>
              <div className="umgmt-modal-actions">
                <button
                  type="button"
                  className="umgmt-btn-ghost"
                  onClick={() => !updateMutation.isPending && setEditUser(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="umgmt-btn-submit" disabled={updateMutation.isPending}>
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
