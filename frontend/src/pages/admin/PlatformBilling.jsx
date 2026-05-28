import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import './PlatformBilling.css';

const BILLING_QUERY_KEY = ['admin', 'billing', 'overview'];

function planBadgeClass(planName) {
  const n = String(planName || '').toLowerCase();
  if (n.includes('advance')) return 'pbl-badge pbl-badge--purple';
  if (n.includes('full')) return 'pbl-badge pbl-badge--teal';
  if (n.includes('basic')) return 'pbl-badge pbl-badge--blue';
  return 'pbl-badge pbl-badge--neutral';
}

function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString() : '—';
}

function toIsoDateOnly(d) {
  if (d == null || d === '') return '';
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

/** YYYY-MM-DD for table display. */
function fmtDateShort(d) {
  const iso = toIsoDateOnly(d);
  return iso || '—';
}

function fmtRenewal(validUntil) {
  if (validUntil == null || validUntil === '') return 'No expiry';
  return fmtDateShort(validUntil);
}

function defaultUntilDate() {
  const x = new Date();
  x.setFullYear(x.getFullYear() + 1);
  return x.toISOString().slice(0, 10);
}

/** Deduplicate org rows if the API returns multiple subscription joins per org. */
function dedupeOrganizations(rows) {
  const map = new Map();
  for (const o of rows || []) {
    if (o && o.id != null && !map.has(o.id)) map.set(o.id, o);
  }
  return [...map.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function quotaRow(org) {
  const quota = org.pdfPageQuota;
  const used = Number(org.pdfPagesUsed) || 0;
  const unlimited = quota == null || quota === '';
  const qNum = unlimited ? null : Number(quota);
  const remaining =
    unlimited || !Number.isFinite(qNum) ? null : Math.max(0, qNum - used);
  let pct = null;
  if (!unlimited && Number.isFinite(qNum) && qNum > 0) {
    pct = Math.min(100, Math.round((used / qNum) * 1000) / 10);
  }
  return { unlimited, used, remaining, pct, qNum };
}

function seatLabel(limit) {
  if (limit == null || limit === '') {
    return <span className="pbl-infinity" title="Unlimited seats">∞</span>;
  }
  return <span className="pbl-num">{fmtNum(limit)}</span>;
}

export default function PlatformBilling() {
  const queryClient = useQueryClient();
  const [modalError, setModalError] = useState('');
  const [planModalError, setPlanModalError] = useState('');
  const [editOrg, setEditOrg] = useState(null);
  const [quotaInput, setQuotaInput] = useState('');
  const [planOrg, setPlanOrg] = useState(null);
  const [planId, setPlanId] = useState('');
  const [subValidFrom, setSubValidFrom] = useState('');
  const [subValidUntil, setSubValidUntil] = useState('');

  const billingQuery = useQuery({
    queryKey: BILLING_QUERY_KEY,
    queryFn: async () => {
      const [orgs, plans] = await Promise.all([
        adminService.getOrganizations(),
        adminService.getPlans(),
      ]);
      return { orgs, plans };
    },
    staleTime: 30 * 1000,
  });

  const rows = useMemo(
    () => dedupeOrganizations(billingQuery.data?.orgs ?? []),
    [billingQuery.data?.orgs],
  );
  const plans = Array.isArray(billingQuery.data?.plans) ? billingQuery.data.plans : [];

  const invalidateBilling = async () => {
    await queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'organizations', 'sidebar'] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => adminService.updateOrganization(id, body),
    onSuccess: async () => {
      setModalError('');
      setEditOrg(null);
      await invalidateBilling();
    },
    onError: (e) => {
      setModalError(e.response?.data?.error || e.message || 'Update failed');
    },
  });

  const subscriptionMutation = useMutation({
    mutationFn: ({ orgId, body }) => adminService.setSubscription(orgId, body),
    onSuccess: async () => {
      setPlanModalError('');
      setPlanOrg(null);
      await invalidateBilling();
    },
    onError: (e) => {
      setPlanModalError(e.response?.data?.error || e.message || 'Subscription update failed');
    },
  });

  const openEditQuota = (org) => {
    setPlanOrg(null);
    setPlanModalError('');
    setModalError('');
    setEditOrg(org);
    setQuotaInput(org.pdfPageQuota == null ? '' : String(org.pdfPageQuota));
  };

  const openManagePlan = (org) => {
    setEditOrg(null);
    setModalError('');
    setPlanModalError('');
    setPlanOrg(org);
    const today = new Date().toISOString().slice(0, 10);
    setPlanId(org.planId != null ? String(org.planId) : plans[0]?.id != null ? String(plans[0].id) : '');
    setSubValidFrom(toIsoDateOnly(org.validFrom) || today);
    setSubValidUntil(toIsoDateOnly(org.validUntil) || defaultUntilDate());
  };

  const closeQuotaModal = () => {
    if (updateMutation.isPending) return;
    setEditOrg(null);
    setModalError('');
  };

  const closePlanModal = () => {
    if (subscriptionMutation.isPending) return;
    setPlanOrg(null);
    setPlanModalError('');
  };

  const submitQuota = (e) => {
    e.preventDefault();
    if (!editOrg) return;
    setModalError('');
    const raw = String(quotaInput).trim();
    let pdfPageQuota;
    if (raw === '') {
      pdfPageQuota = null;
    } else {
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < 1) {
        setModalError('Enter a positive integer, or leave empty for unlimited quota.');
        return;
      }
      pdfPageQuota = n;
    }
    updateMutation.mutate({ id: editOrg.id, body: { pdfPageQuota } });
  };

  const submitPlan = (e) => {
    e.preventDefault();
    if (!planOrg) return;
    setPlanModalError('');
    if (!planId) {
      setPlanModalError('Select a plan.');
      return;
    }
    const vf = String(subValidFrom || '').trim().slice(0, 10);
    const vu = String(subValidUntil || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vf) || !/^\d{4}-\d{2}-\d{2}$/.test(vu)) {
      setPlanModalError('Valid from and valid until must be dates in YYYY-MM-DD format.');
      return;
    }
    if (vu < vf) {
      setPlanModalError('Valid until must be on or after valid from.');
      return;
    }
    subscriptionMutation.mutate({
      orgId: planOrg.id,
      body: {
        planId: parseInt(planId, 10),
        validFrom: vf,
        validUntil: vu,
        status: 'active',
      },
    });
  };

  if (billingQuery.isLoading) {
    return (
      <div className="pbl-root">
        <div className="pbl-inner pbl-loading">
          <div className="pbl-spinner" aria-hidden />
          Loading billing data…
        </div>
      </div>
    );
  }

  if (billingQuery.isError) {
    return (
      <div className="pbl-root">
        <div className="pbl-inner">
          <div className="pbl-err">{billingQuery.error?.message || 'Failed to load data.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pbl-root">
      <div className="pbl-inner">
        <header className="pbl-head">
          <h1 className="pbl-title">Billing &amp; quotas</h1>
          <p className="pbl-sub">Manage subscription billing cycles and page quota overrides.</p>
        </header>

        <section className="pbl-panel" aria-label="Quota overview">
          <h2 className="pbl-panel-title">Quota overview by organization</h2>
          <p className="pbl-panel-meta">
            All organizations with assigned plans, seat limits, subscription dates, and PDF page usage. Use{' '}
            <strong>Manage plan</strong> to change plan or renewal window, or <strong>Edit quota</strong> for page caps.
          </p>

          {rows.length === 0 ? (
            <div className="pbl-empty">No organizations found.</div>
          ) : (
            <div className="pbl-table-wrap">
              <table className="pbl-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Status</th>
                    <th>Seats</th>
                    <th>Plan</th>
                    <th>Valid from</th>
                    <th>Quota</th>
                    <th>Used</th>
                    <th>Remaining</th>
                    <th>Utilization</th>
                    <th>Renews</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((org) => {
                    const { unlimited, used, remaining, pct } = quotaRow(org);
                    return (
                      <tr key={org.id}>
                        <td>
                          <div className="pbl-org-name">{org.name || '—'}</div>
                          <div className="pbl-org-slug">{org.slug || '—'}</div>
                          <div className="pbl-org-id">ID {org.id}</div>
                        </td>
                        <td>
                          <span className={org.active ? 'pbl-status pbl-status--on' : 'pbl-status pbl-status--off'}>
                            {org.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>{seatLabel(org.memberSeatLimit)}</td>
                        <td>
                          <span className={planBadgeClass(org.planName)}>{org.planName || 'No plan'}</span>
                          {org.planId != null && (
                            <div className="pbl-plan-id">Plan #{org.planId}</div>
                          )}
                        </td>
                        <td className="pbl-num">{fmtDateShort(org.validFrom)}</td>
                        <td className="pbl-num">
                          {unlimited ? (
                            <span className="pbl-infinity" title="Unlimited">
                              ∞
                            </span>
                          ) : (
                            fmtNum(org.pdfPageQuota)
                          )}
                        </td>
                        <td className="pbl-num">{fmtNum(used)}</td>
                        <td className="pbl-num">
                          {unlimited ? (
                            <span className="pbl-infinity" title="Unlimited">
                              ∞
                            </span>
                          ) : (
                            fmtNum(remaining)
                          )}
                        </td>
                        <td>
                          {unlimited ? (
                            <span className="pbl-util-pct">—</span>
                          ) : (
                            <div className="pbl-util">
                              <div className="pbl-bar" aria-hidden>
                                <div className="pbl-bar-fill" style={{ width: `${pct ?? 0}%` }} />
                              </div>
                              <span className="pbl-util-pct">{pct != null ? `${pct}%` : '—'}</span>
                            </div>
                          )}
                        </td>
                        <td className="pbl-num">{fmtRenewal(org.validUntil)}</td>
                        <td>
                          <div className="pbl-actions">
                            <button
                              type="button"
                              className="pbl-btn pbl-btn--compact"
                              onClick={() => openManagePlan(org)}
                              disabled={plans.length === 0}
                              title={plans.length === 0 ? 'No plans defined' : undefined}
                            >
                              Manage plan
                            </button>
                            <button type="button" className="pbl-btn pbl-btn--compact" onClick={() => openEditQuota(org)}>
                              Edit quota
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editOrg && (
        <div
          className="pbl-modal-overlay"
          role="presentation"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closeQuotaModal();
          }}
        >
          <div className="pbl-modal" role="dialog" aria-labelledby="pbl-quota-title" aria-modal="true">
            <h3 id="pbl-quota-title">Edit page quota</h3>
            <p className="pbl-modal-meta">{editOrg.name}</p>

            {modalError ? <div className="pbl-err" style={{ marginBottom: 12 }}>{modalError}</div> : null}

            <form onSubmit={submitQuota}>
              <label className="pbl-modal-label" htmlFor="pbl-quota-input">
                PDF page quota
              </label>
              <input
                id="pbl-quota-input"
                className="pbl-modal-input"
                type="text"
                inputMode="numeric"
                value={quotaInput}
                onChange={(e) => setQuotaInput(e.target.value)}
                placeholder="Leave empty for unlimited"
                autoComplete="off"
              />
              <p className="pbl-modal-hint">
                Total pages allowed for this organization in the current period. Empty means no page cap.
              </p>
              <div className="pbl-modal-actions">
                <button type="button" className="pbl-btn" onClick={closeQuotaModal} disabled={updateMutation.isPending}>
                  Cancel
                </button>
                <button type="submit" className="pbl-btn pbl-btn--primary" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {planOrg && (
        <div
          className="pbl-modal-overlay"
          role="presentation"
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closePlanModal();
          }}
        >
          <div className="pbl-modal pbl-modal--wide" role="dialog" aria-labelledby="pbl-plan-title" aria-modal="true">
            <h3 id="pbl-plan-title">Manage plan &amp; subscription</h3>
            <p className="pbl-modal-meta">{planOrg.name}</p>

            {planModalError ? <div className="pbl-err" style={{ marginBottom: 12 }}>{planModalError}</div> : null}

            {plans.length === 0 ? (
              <p className="pbl-modal-hint">Create at least one plan under Plans &amp; features before assigning.</p>
            ) : (
              <form onSubmit={submitPlan}>
                <label className="pbl-modal-label" htmlFor="pbl-plan-select">
                  Plan
                </label>
                <select
                  id="pbl-plan-select"
                  className="pbl-modal-select"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  <option value="" disabled>
                    Select plan…
                  </option>
                  {plans.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <label className="pbl-modal-label" htmlFor="pbl-valid-from">
                  Valid from
                </label>
                <input
                  id="pbl-valid-from"
                  className="pbl-modal-input"
                  type="date"
                  value={subValidFrom}
                  onChange={(e) => setSubValidFrom(e.target.value)}
                />

                <label className="pbl-modal-label" htmlFor="pbl-valid-until">
                  Valid until
                </label>
                <input
                  id="pbl-valid-until"
                  className="pbl-modal-input"
                  type="date"
                  value={subValidUntil}
                  onChange={(e) => setSubValidUntil(e.target.value)}
                />

                <p className="pbl-modal-hint">
                  Changing dates may reset the organization&apos;s PDF page usage counter for the new period (per
                  server rules). Both dates are required.
                </p>

                <div className="pbl-modal-actions">
                  <button type="button" className="pbl-btn" onClick={closePlanModal} disabled={subscriptionMutation.isPending}>
                    Cancel
                  </button>
                  <button type="submit" className="pbl-btn pbl-btn--primary" disabled={subscriptionMutation.isPending}>
                    {subscriptionMutation.isPending ? 'Saving…' : 'Save subscription'}
                  </button>
                </div>
              </form>
            )}

            {plans.length === 0 ? (
              <div className="pbl-modal-actions">
                <button type="button" className="pbl-btn" onClick={closePlanModal}>
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
