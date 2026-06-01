import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Users, Trash2, X } from 'lucide-react';
import { adminService } from '../../services/adminService';
import ConfirmModal from '../../components/Loadingmodal';
import useAppDispatch from '../../hooks/useAppDispatch';
import { showToast } from '../../slices/uiSlice';
import './AdminOrganizations.css';

function planBadgeClass(planName) {
  const n = String(planName || '').toLowerCase();
  if (n.includes('advance')) return 'aorg-badge aorg-badge--purple';
  if (n.includes('full')) return 'aorg-badge aorg-badge--teal';
  if (n.includes('basic')) return 'aorg-badge aorg-badge--blue';
  return 'aorg-badge aorg-badge--neutral';
}

function fmtDate(d) {
  if (d == null || d === '') return '—';
  const s = typeof d === 'string' ? d : String(d);
  return s.slice(0, 10);
}

function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : '—';
}

export default function AdminOrganizations() {
  const dispatch = useAppDispatch();
  const [list, setList] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const firstFetch = useRef(true);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [planId, setPlanId] = useState('');
  const [memberSeatLimit, setMemberSeatLimit] = useState('');
  const [pdfPageQuota, setPdfPageQuota] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const [usersModalOrg, setUsersModalOrg] = useState(null);
  const [usersModalError, setUsersModalError] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [orgAdmins, setOrgAdmins] = useState([]);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    if (firstFetch.current) setInitialLoad(true);
    try {
      const [orgs, pls, ps] = await Promise.all([
        adminService.getOrganizations(),
        adminService.getPlans(),
        adminService.getPlatformSettings().catch(() => null),
      ]);
      setList(orgs);
      setPlans(pls);
      setPlanId((prev) => {
        if (prev) return prev;
        const def = ps?.defaultPlanId;
        if (def != null && pls.some((p) => Number(p.id) === Number(def))) {
          return String(def);
        }
        return pls.length ? String(pls[0].id) : '';
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      if (firstFetch.current) {
        firstFetch.current = false;
        setInitialLoad(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const seat = parseInt(String(memberSeatLimit).trim(), 10);
      const pages = parseInt(String(pdfPageQuota).trim(), 10);
      if (Number.isNaN(seat) || seat < 1) {
        setError('Seat limit is required and must be a positive integer');
        return;
      }
      if (Number.isNaN(pages) || pages < 1) {
        setError('PDF page quota is required and must be a positive integer (API does not allow blank on create).');
        return;
      }
      if (!validFrom || !String(validFrom).trim()) {
        setError('Valid from date is required');
        return;
      }
      if (!validUntil || !String(validUntil).trim()) {
        setError('Valid until date is required');
        return;
      }
      const vf = String(validFrom).trim().slice(0, 10);
      const vu = String(validUntil).trim().slice(0, 10);
      if (vu < vf) {
        setError('Valid until must be on or after valid from');
        return;
      }
      const payload = {
        name,
        slug: slug || undefined,
        planId: planId ? parseInt(planId, 10) : undefined,
        memberSeatLimit: seat,
        pdfPageQuota: pages,
        validFrom: vf,
        validUntil: vu,
      };
      await adminService.createOrganization(payload);
      setName('');
      setSlug('');
      setMemberSeatLimit('');
      setPdfPageQuota('');
      setValidFrom('');
      setValidUntil('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (org) => {
    setError('');
    const nextActive = !org.active;
    try {
      const updated = await adminService.updateOrganization(org.id, { active: nextActive });
      await load();
      const usersDeactivated = updated?.usersDeactivated;
      dispatch(
        showToast({
          type: 'success',
          message: nextActive
            ? `${org.name} is now active.`
            : usersDeactivated
              ? `${org.name} has been deactivated. ${usersDeactivated} user${usersDeactivated === 1 ? '' : 's'} deactivated.`
              : `${org.name} has been deactivated.`,
        }),
      );
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setError(msg);
      dispatch(showToast({ type: 'error', message: msg || 'Failed to update organization status.' }));
    }
  };

  const closeUsersModal = () => {
    setUsersModalOrg(null);
    setOrgAdmins([]);
    setUsersModalError('');
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
  };

  const openManageUsers = async (org) => {
    setUsersModalError('');
    setUsersModalOrg(org);
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    setUsersLoading(true);
    try {
      const users = await adminService.getOrgUsers(org.id);
      setOrgAdmins((users || []).filter((u) => u.role === 'org_admin'));
    } catch (e) {
      setUsersModalError(e.response?.data?.error || e.message);
      setOrgAdmins([]);
    } finally {
      setUsersLoading(false);
    }
  };

  const requestDelete = (org) => {
    setError('');
    setDeleteTarget(org);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    setDeleting(true);
    try {
      await adminService.deleteOrganization(deleteTarget.id);
      if (usersModalOrg?.id === deleteTarget.id) {
        closeUsersModal();
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const createOrgAdmin = async () => {
    if (!usersModalOrg) return;
    setUsersModalError('');
    const email = adminEmail.trim().toLowerCase();
    if (!adminName.trim()) {
      setUsersModalError('Org admin name is required');
      return;
    }
    if (!email) {
      setUsersModalError('Org admin email is required');
      return;
    }
    if (!adminPassword || adminPassword.length < 6) {
      setUsersModalError('Org admin password must be at least 6 characters');
      return;
    }
    try {
      await adminService.createOrgUser(usersModalOrg.id, {
        name: adminName.trim(),
        email,
        password: adminPassword,
        role: 'org_admin',
      });
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      const users = await adminService.getOrgUsers(usersModalOrg.id);
      setOrgAdmins((users || []).filter((u) => u.role === 'org_admin'));
    } catch (e) {
      setUsersModalError(e.response?.data?.error || e.message);
    }
  };

  if (initialLoad) {
    return (
      <div className="aorg-root">
        <div className="aorg-inner aorg-loading">
          <div className="aorg-spinner" aria-hidden />
          Loading organizations…
        </div>
      </div>
    );
  }

  return (
    <div className="aorg-root">
      <div className="aorg-inner">
        <header className="aorg-head">
          <h1 className="aorg-title">Organizations</h1>
          <p className="aorg-sub">
            Create clients (tenants), assign plans, set seat limits and PDF page quotas.
          </p>
        </header>

        {error && <div className="aorg-alert">{error}</div>}

        <section className="aorg-card" aria-labelledby="aorg-new-title">
          <div className="aorg-card-head">
            <h2 id="aorg-new-title">New Organization</h2>
            <button
              type="submit"
              form="aorg-create-form"
              className="aorg-btn-create"
              disabled={submitting}
            >
              + Create
            </button>
          </div>
          <form id="aorg-create-form" className="aorg-form" onSubmit={create}>
            <div className="aorg-grid">
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-name">
                  Organization name<span className="aorg-req">*</span>
                </label>
                <input
                  id="aorg-name"
                  className="aorg-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  required
                  autoComplete="organization"
                />
              </div>
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-slug">
                  Slug (optional)
                </label>
                <input
                  id="aorg-slug"
                  className="aorg-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto from name"
                  autoComplete="off"
                />
              </div>
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-plan">
                  Plan<span className="aorg-req">*</span>
                </label>
                <select
                  id="aorg-plan"
                  className="aorg-select"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  required
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-seats">
                  Seat limit (licenses)<span className="aorg-req">*</span>
                </label>
                <input
                  id="aorg-seats"
                  className="aorg-input"
                  type="number"
                  min={1}
                  value={memberSeatLimit}
                  onChange={(e) => setMemberSeatLimit(e.target.value)}
                  placeholder="e.g. 10"
                  required
                />
                <span className="aorg-hint">Counts member and org admin seats.</span>
              </div>
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-from">
                  Valid from<span className="aorg-req">*</span>
                </label>
                <div className="aorg-date-wrap">
                  <input
                    id="aorg-from"
                    className="aorg-input"
                    type="date"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    required
                  />
                </div>
                <span className="aorg-hint">Subscription start (YYYY-MM-DD).</span>
              </div>
              <div className="aorg-field">
                <label className="aorg-label" htmlFor="aorg-until">
                  Valid until<span className="aorg-req">*</span>
                </label>
                <div className="aorg-date-wrap">
                  <input
                    id="aorg-until"
                    className="aorg-input"
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    required
                  />
                </div>
                <span className="aorg-hint">Must be on or after valid from.</span>
              </div>
              <div className="aorg-field aorg-field--full">
                <label className="aorg-label" htmlFor="aorg-quota">
                  PDF page quota<span className="aorg-req">*</span>
                </label>
                <input
                  id="aorg-quota"
                  className="aorg-input"
                  type="number"
                  min={1}
                  value={pdfPageQuota}
                  onChange={(e) => setPdfPageQuota(e.target.value)}
                  placeholder="e.g. 5000"
                  required
                />
                <span className="aorg-hint">
                  Total pages allowed for the subscription period. Create requires a positive number; unlimited-style
                  quotas can be adjusted later via organization update APIs where supported.
                </span>
              </div>
            </div>
          </form>
        </section>

        <section className="aorg-card" aria-labelledby="aorg-list-title">
          <div className="aorg-card-head">
            <div className="aorg-table-head">
              <h2 id="aorg-list-title">All Organizations</h2>
              <span className="aorg-count-badge">{list.length} total</span>
            </div>
          </div>
          <div className="aorg-table-wrap">
            <table className="aorg-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Plan</th>
                  <th>Valid from</th>
                  <th>Valid until</th>
                  <th>Seats</th>
                  <th>Quota</th>
                  <th>Used</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td className="aorg-name">{o.name}</td>
                    <td className="aorg-slug">{o.slug || '—'}</td>
                    <td>
                      <span className={planBadgeClass(o.planName)}>{o.planName || '—'}</span>
                    </td>
                    <td>{fmtDate(o.validFrom)}</td>
                    <td>{fmtDate(o.validUntil)}</td>
                    <td>{fmtNum(o.memberSeatLimit)}</td>
                    <td>
                      {o.pdfPageQuota == null || o.pdfPageQuota === ''
                        ? 'Unlimited'
                        : fmtNum(o.pdfPageQuota)}
                    </td>
                    <td>{fmtNum(o.pdfPagesUsed)}</td>
                    <td className="aorg-active-cell">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={o.active}
                        aria-label={o.active ? 'Deactivate organization' : 'Activate organization'}
                        className={`aorg-switch ${o.active ? 'aorg-switch--on' : ''}`}
                        onClick={() => toggleActive(o)}
                      >
                        <span className="aorg-switch-thumb" aria-hidden />
                      </button>
                    </td>
                    <td>
                      <div className="aorg-actions">
                        <button type="button" className="aorg-btn-ghost" onClick={() => openManageUsers(o)}>
                          <Users size={16} aria-hidden />
                          Users
                        </button>
                        <button
                          type="button"
                          className="aorg-btn-delete"
                          disabled={deleting}
                          onClick={() => requestDelete(o)}
                        >
                          <Trash2 size={16} aria-hidden />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <div className="aorg-loading" style={{ padding: 32 }}>
                No organizations yet. Create one above.
              </div>
            )}
          </div>
        </section>

        {usersModalOrg && (
          <div
            className="aorg-modal-backdrop"
            role="presentation"
            onClick={(e) => e.target === e.currentTarget && closeUsersModal()}
          >
            <div
              className="aorg-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="aorg-users-modal-title"
            >
              <div className="aorg-modal-head">
                <div>
                  <h3 id="aorg-users-modal-title">Organization users</h3>
                  <p className="aorg-modal-meta">{usersModalOrg.name}</p>
                </div>
                <button
                  type="button"
                  className="aorg-modal-close"
                  onClick={closeUsersModal}
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              {usersModalError && <div className="aorg-modal-error">{usersModalError}</div>}

              {usersLoading ? (
                <div className="aorg-modal-loading">
                  <div className="aorg-spinner" aria-hidden />
                  Loading users…
                </div>
              ) : (
                <>
                  <h4 className="aorg-modal-section-title">Create org admin</h4>
                  <div className="aorg-modal-form">
                    <div className="aorg-field">
                      <label className="aorg-label" htmlFor="aorg-admin-name">
                        Name
                      </label>
                      <input
                        id="aorg-admin-name"
                        className="aorg-input"
                        placeholder="Name"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                      />
                    </div>
                    <div className="aorg-field">
                      <label className="aorg-label" htmlFor="aorg-admin-email">
                        Email
                      </label>
                      <input
                        id="aorg-admin-email"
                        className="aorg-input"
                        type="email"
                        placeholder="Email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                      />
                    </div>
                    <div className="aorg-field">
                      <label className="aorg-label" htmlFor="aorg-admin-pass">
                        Password
                      </label>
                      <input
                        id="aorg-admin-pass"
                        className="aorg-input"
                        type="password"
                        placeholder="Password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                      />
                    </div>
                    <button type="button" className="aorg-btn-primary-sm" onClick={createOrgAdmin}>
                      Create org admin
                    </button>
                  </div>
                  <div className="aorg-admin-list">
                    Existing org admins:{' '}
                    {orgAdmins.length ? orgAdmins.map((u) => u.email).join(', ') : 'none'}
                  </div>
                </>
              )}

      
            </div>
          </div>
        )}

        <ConfirmModal
          isOpen={Boolean(deleteTarget)}
          onClose={() => !deleting && setDeleteTarget(null)}
          onConfirm={confirmDelete}
          title="Delete organization"
          subtitle="This action cannot be undone."
          message={
            deleteTarget
              ? `Permanently delete "${deleteTarget.name}"? All users and data for this organization will be removed.`
              : ''
          }
          confirmLabel="Delete organization"
          variant="danger"
          loading={deleting}
        />
      </div>
    </div>
  );
}
