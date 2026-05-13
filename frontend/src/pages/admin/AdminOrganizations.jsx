import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { adminService } from '../../services/adminService';
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

  const [manageOrgId, setManageOrgId] = useState(null);
  const [orgAdmins, setOrgAdmins] = useState([]);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

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
    try {
      await adminService.updateOrganization(org.id, { active: !org.active });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const openManageUsers = async (orgId) => {
    if (manageOrgId === orgId) {
      setManageOrgId(null);
      setOrgAdmins([]);
      return;
    }
    setError('');
    setManageOrgId(orgId);
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    try {
      const users = await adminService.getOrgUsers(orgId);
      setOrgAdmins((users || []).filter((u) => u.role === 'org_admin'));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setOrgAdmins([]);
    }
  };

  const createOrgAdmin = async (orgId) => {
    setError('');
    const email = adminEmail.trim().toLowerCase();
    if (!adminName.trim()) {
      setError('Org admin name is required');
      return;
    }
    if (!email) {
      setError('Org admin email is required');
      return;
    }
    if (!adminPassword || adminPassword.length < 6) {
      setError('Org admin password must be at least 6 characters');
      return;
    }
    try {
      await adminService.createOrgUser(orgId, {
        name: adminName.trim(),
        email,
        password: adminPassword,
        role: 'org_admin',
      });
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      const users = await adminService.getOrgUsers(orgId);
      setOrgAdmins((users || []).filter((u) => u.role === 'org_admin'));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
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
                  <React.Fragment key={o.id}>
                    <tr>
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
                      <td>
                        <span className={`aorg-badge ${o.active ? 'aorg-badge--yes' : 'aorg-badge--no'}`}>
                          {o.active ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <div className="aorg-actions">
                          <button type="button" className="aorg-btn-ghost" onClick={() => toggleActive(o)}>
                            Toggle
                          </button>
                          <button type="button" className="aorg-btn-ghost" onClick={() => openManageUsers(o.id)}>
                            <Users size={16} aria-hidden />
                            Users
                          </button>
                        </div>
                      </td>
                    </tr>
                    {manageOrgId === o.id && (
                      <tr>
                        <td colSpan={10}>
                          <div className="aorg-users-panel">
                            <h4>Create org admin</h4>
                            <div className="aorg-users-grid">
                              <div className="aorg-field">
                                <label className="aorg-label" htmlFor={`aorg-admin-name-${o.id}`}>
                                  Name
                                </label>
                                <input
                                  id={`aorg-admin-name-${o.id}`}
                                  className="aorg-input"
                                  placeholder="Name"
                                  value={adminName}
                                  onChange={(e) => setAdminName(e.target.value)}
                                />
                              </div>
                              <div className="aorg-field">
                                <label className="aorg-label" htmlFor={`aorg-admin-email-${o.id}`}>
                                  Email
                                </label>
                                <input
                                  id={`aorg-admin-email-${o.id}`}
                                  className="aorg-input"
                                  type="email"
                                  placeholder="Email"
                                  value={adminEmail}
                                  onChange={(e) => setAdminEmail(e.target.value)}
                                />
                              </div>
                              <div className="aorg-field">
                                <label className="aorg-label" htmlFor={`aorg-admin-pass-${o.id}`}>
                                  Password
                                </label>
                                <input
                                  id={`aorg-admin-pass-${o.id}`}
                                  className="aorg-input"
                                  type="password"
                                  placeholder="Password"
                                  value={adminPassword}
                                  onChange={(e) => setAdminPassword(e.target.value)}
                                />
                              </div>
                              <button
                                type="button"
                                className="aorg-btn-primary-sm"
                                onClick={() => createOrgAdmin(o.id)}
                              >
                                Create org admin
                              </button>
                            </div>
                            <div className="aorg-admin-list">
                              Existing org admins:{' '}
                              {orgAdmins.length ? orgAdmins.map((u) => u.email).join(', ') : 'none'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
      </div>
    </div>
  );
}
