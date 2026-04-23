import React, { useEffect, useState } from 'react';
import { adminService } from '../../services/adminService';
import '../Login.css';

export default function AdminOrganizations() {
  const [list, setList] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
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

  const load = async () => {
    setError('');
    try {
      const [orgs, pls] = await Promise.all([adminService.getOrganizations(), adminService.getPlans()]);
      setList(orgs);
      setPlans(pls);
      if (pls.length && !planId) setPlanId(String(pls[0].id));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const seat = parseInt(String(memberSeatLimit).trim(), 10);
      const pages = parseInt(String(pdfPageQuota).trim(), 10);
      if (Number.isNaN(seat) || seat < 1) {
        setError('Seat limit is required and must be a positive integer');
        return;
      }
      if (Number.isNaN(pages) || pages < 1) {
        setError('PDF page quota is required and must be a positive integer');
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
        validUntil: vu
      };
      await adminService.createOrganization(payload);
      setName('');
      setSlug('');
      setMemberSeatLimit('');
      setPdfPageQuota('');
      setValidFrom('');
      setValidUntil('');
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const toggleActive = async (org) => {
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
        role: 'org_admin'
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

  const fmtDate = (d) => {
    if (d == null || d === '') return '—';
    const s = typeof d === 'string' ? d : String(d);
    return s.slice(0, 10);
  };

  return (
    <div className="container" style={{ maxWidth: 1100, padding: '24px' }}>
      <h1 style={{ marginBottom: 8 }}>Organizations</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Create clients (tenants), assign a plan, set valid from / valid until, seat limit, and total PDF page quota
        for that period (usage resets when subscription dates change).
      </p>
      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={create} style={{ marginBottom: 32, padding: 16, border: '1px solid #e0e0e0', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>New organization</h3>
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Slug (optional)</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from name" />
        </div>
        <div className="form-group">
          <label>Plan *</label>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Valid from *</label>
          <input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          <small style={{ color: '#666' }}>Subscription start (YYYY-MM-DD).</small>
        </div>
        <div className="form-group">
          <label>Valid until *</label>
          <input type="date" required value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <small style={{ color: '#666' }}>Subscription end date (must be on or after valid from).</small>
        </div>
        <div className="form-group">
          <label>Seat limit (licenses) *</label>
          <input
            type="number"
            min={1}
            required
            value={memberSeatLimit}
            onChange={(e) => setMemberSeatLimit(e.target.value)}
            placeholder="e.g. 10"
          />
          <small style={{ color: '#666' }}>
            Counts <strong>member</strong> and <strong>org admin</strong> users in the organization.
          </small>
        </div>
        <div className="form-group">
          <label>PDF page quota *</label>
          <input
            type="number"
            min={1}
            required
            value={pdfPageQuota}
            onChange={(e) => setPdfPageQuota(e.target.value)}
            placeholder="e.g. 5000"
          />
          <small style={{ color: '#666' }}>
            Total PDF pages this org may upload during the subscription period. When exhausted, uploads are blocked
            until the quota is increased or subscription dates are renewed (usage resets when dates change).
          </small>
        </div>
        <button type="submit" className="btn btn-primary">
          Create
        </button>
      </form>

      <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Slug</th>
            <th style={{ padding: 8 }}>Plan</th>
            <th style={{ padding: 8 }}>Valid from</th>
            <th style={{ padding: 8 }}>Valid until</th>
            <th style={{ padding: 8 }}>Seats</th>
            <th style={{ padding: 8 }}>Page quota</th>
            <th style={{ padding: 8 }}>Used</th>
            <th style={{ padding: 8 }}>Active</th>
            <th style={{ padding: 8 }} />
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <React.Fragment key={o.id}>
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{o.name}</td>
                <td style={{ padding: 8 }}>{o.slug}</td>
                <td style={{ padding: 8 }}>{o.planName || '—'}</td>
                <td style={{ padding: 8 }}>{fmtDate(o.validFrom)}</td>
                <td style={{ padding: 8 }}>{fmtDate(o.validUntil)}</td>
                <td style={{ padding: 8 }}>{o.memberSeatLimit != null ? o.memberSeatLimit : '—'}</td>
                <td style={{ padding: 8 }}>{o.pdfPageQuota != null ? o.pdfPageQuota : '—'}</td>
                <td style={{ padding: 8 }}>{o.pdfPagesUsed != null ? o.pdfPagesUsed : '—'}</td>
                <td style={{ padding: 8 }}>{o.active ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8, display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => toggleActive(o)}>
                    Toggle active
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => openManageUsers(o.id)}>
                    {manageOrgId === o.id ? 'Close users' : 'Manage users'}
                  </button>
                </td>
              </tr>
              {manageOrgId === o.id && (
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td colSpan={10} style={{ padding: 12, background: '#fafafa' }}>
                    <div style={{ marginBottom: 10, fontWeight: 600 }}>Create Org Admin</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                      <input
                        className="form-control"
                        placeholder="Name"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                      />
                      <input
                        className="form-control"
                        placeholder="Email"
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                      />
                      <input
                        className="form-control"
                        placeholder="Password"
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                      />
                      <button type="button" className="btn btn-primary" onClick={() => createOrgAdmin(o.id)}>
                        Create Org Admin
                      </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: '#555' }}>
                      Existing org admins: {orgAdmins.length ? orgAdmins.map((u) => u.email).join(', ') : 'none'}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
