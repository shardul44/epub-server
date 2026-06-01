import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useListScope } from '../../context/ListScopeContext';
import { useUsageQuery, usePlansQuery } from '../../hooks/queries/useUsageQuery';
import useAppDispatch from '../../hooks/useAppDispatch';
import useAppSelector from '../../hooks/useAppSelector';
import {
  selectShowUpgrade,
  selectShowAddOns,
  openUpgradeModal,
  closeUpgradeModal,
  openAddOnsModal,
  closeAddOnsModal,
} from '../../features/usage/usageSlice';
import {
  Video,
  Mic,
  RefreshCw,
  Database,
  Languages,
  Info,
  Clock,
  FileText,
  BarChart2,
  X,
  CheckCircle,
  Star,
  ShoppingCart,
  Zap,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { planRequestService } from '../../services/planRequestService';
import './usage.css';

/* ─── helpers ─────────────────────────────────────────────────── */
function pct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function fmtPages(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function barColor(percentage) {
  if (percentage >= 90) return '#dc2626';
  if (percentage >= 70) return '#f59e0b';
  return '#1a7a3c';
}

/* ─── UsageCard ───────────────────────────────────────────────── */
function UsageCard({ icon, label, unit, used, limit }) {
  const percentage = pct(used, limit);
  const remaining  = limit != null ? Math.max(0, limit - used) : null;
  const color      = barColor(percentage);

  return (
    <div className="usage-card">
      <div className="usage-card__header">
        <span className="usage-card__icon">{icon}</span>
        <span className="usage-card__label">{label}</span>
      </div>
      <div className="usage-card__numbers">
        <span className="usage-card__used">{fmtPages(used)}</span>
        <span className="usage-card__limit">
          {limit != null ? `/ ${fmtPages(limit)} ${unit}` : unit}
        </span>
      </div>
      <div className="usage-card__bar-track">
        <div
          className="usage-card__bar-fill"
          style={{ width: `${percentage}%`, background: color }}
        />
      </div>
      <div className="usage-card__footer">
        <span className="usage-card__pct" style={{ color }}>{percentage}% used</span>
        {remaining != null && (
          <span className="usage-card__remaining" style={{ color: '#1a7a3c' }}>
            {fmtPages(remaining)} {unit} left
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── PlanLimitItem ───────────────────────────────────────────── */
function PlanLimitItem({ icon, label, value }) {
  return (
    <div className="plan-limit-item">
      <span className="plan-limit-item__icon">{icon}</span>
      <div className="plan-limit-item__text">
        <span className="plan-limit-item__label">{label}</span>
        <span className="plan-limit-item__value">{value}</span>
      </div>
    </div>
  );
}

/* ─── UpgradeModal ────────────────────────────────────────────── */
function UpgradeModal({ currentPlanName, plans, loading, error, onClose, isMember, onRequestSent }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const requestUpgrade = async (plan) => {
    setSubmitError('');
    setSubmitSuccess('');
    setSubmitting(true);
    try {
      await planRequestService.submitUpgrade(plan.id);
      const msg = 'Your upgrade request was sent to the platform admin. You will be notified when it is reviewed.';
      setSubmitSuccess(msg);
      onRequestSent?.();
    } catch (e) {
      setSubmitError(planRequestErrorMessage(e, 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} role="dialog" aria-modal="true" aria-label="Upgrade plan">
      <div className="modal-box modal-box--upgrade">
        {/* header */}
        <div className="modal-header">
          <div className="modal-header__left">
            <Zap size={20} className="modal-header__icon" />
            <h2 className="modal-title">Upgrade Your Plan</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="modal-subtitle">
          You are currently on the <strong>{String(currentPlanName).toUpperCase()}</strong> plan.
          {isMember
            ? ' Select a plan below to send an upgrade request to the platform administrator.'
            : ' Select a plan below to request an upgrade from the platform administrator.'}
        </p>

        {submitSuccess && (
          <div className="modal-success" role="status">
            <CheckCircle2 size={18} />
            {submitSuccess}
          </div>
        )}
        {submitError && <div className="modal-error">{submitError}</div>}

        {loading && <div className="modal-loading">Loading plans…</div>}
        {error   && <div className="modal-error">{error}</div>}

        {!loading && !error && plans.length === 0 && (
          <div className="modal-empty">No plans available at this time. Please contact support.</div>
        )}

        {!loading && !error && plans.length > 0 && (
          <div className="modal-plans-grid">
            {plans.map((plan) => {
              const isCurrent = plan.name.toLowerCase() === String(currentPlanName).toLowerCase();
              return (
                <div
                  key={plan.id}
                  className={`plan-card${isCurrent ? ' plan-card--current' : ''}`}
                >
                  {isCurrent && (
                    <span className="plan-card__badge plan-card__badge--current">Current</span>
                  )}
                  <div className="plan-card__header">
                    <Star size={18} className="plan-card__icon" />
                    <h3 className="plan-card__name">{plan.name}</h3>
                  </div>
                  {plan.description && (
                    <p className="plan-card__desc">{plan.description}</p>
                  )}
                  <ul className="plan-card__features">
                    <li>
                      <CheckCircle size={14} />
                      {plan.seatLimit != null
                        ? `Up to ${plan.seatLimit} seats`
                        : 'Unlimited seats'}
                    </li>
                    <li>
                      <CheckCircle size={14} />
                      {plan.monthlyPageLimit != null
                        ? `${fmtPages(plan.monthlyPageLimit)} PDF pages / period`
                        : 'Unlimited PDF pages'}
                    </li>
                  </ul>
                  <button
                    type="button"
                    className={`plan-card__btn${isCurrent ? ' plan-card__btn--disabled' : ''}`}
                    disabled={isCurrent || submitting || !!submitSuccess}
                    onClick={() => {
                      if (!isCurrent) void requestUpgrade(plan);
                    }}
                  >
                    {isCurrent ? (
                      'Current Plan'
                    ) : submitting ? (
                      <>
                        <Loader2 size={14} className="usage-btn-spin" aria-hidden />
                        Sending…
                      </>
                    ) : (
                      `Request ${plan.name}`
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="modal-contact-note">
          Requests are reviewed by the platform administrator. Limits update after approval.
        </p>
      </div>
    </div>
  );
}

/* ─── AddOnsModal ─────────────────────────────────────────────── */
const ADD_ONS = [
  {
    id: 'pages-2000',
    icon: <FileText size={22} />,
    name: '2,000 Extra Pages',
    desc: 'Most popular base pack. Enter the exact page quantity you want to request.',
    tag: 'Pages',
    popular: true,
    inputLabel: 'Requested pages',
    inputPlaceholder: 'e.g. 3500',
  },
  {
    id: 'seats-5',
    icon: <Database size={22} />,
    name: '5 Extra Seats',
    desc: 'Most popular base pack. Enter the exact seat count you want to request.',
    tag: 'Seats',
    popular: true,
    inputLabel: 'Requested seats',
    inputPlaceholder: 'e.g. 8',
  },
];

function planRequestErrorMessage(e, fallback) {
  return (
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    fallback
  );
}

function AddOnsModal({ onClose, onRequestSent, canSubmit }) {
  const [selected, setSelected] = useState(null);
  const [quantities, setQuantities] = useState({
    'pages-2000': '2000',
    'seats-5': '5',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleRequest = async () => {
    if (!canSubmit) {
      setSubmitError(
        'Your account must belong to an organization before you can request add-ons.',
      );
      return;
    }
    if (!selected) {
      setSubmitError('Please select an add-on.');
      return;
    }
    const qtyRaw = quantities[selected];
    const qty = Number.parseInt(String(qtyRaw || '').trim(), 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setSubmitError('Please enter a valid quantity greater than 0.');
      return;
    }
    setSubmitError('');
    setSubmitSuccess('');
    setSubmitting(true);
    try {
      await planRequestService.submitAddon(selected, `Requested quantity: ${qty}`);
      setSubmitSuccess(
        'Your add-on request was sent to the platform admin. Limits will update after approval.',
      );
      onRequestSent?.();
    } catch (e) {
      setSubmitError(planRequestErrorMessage(e, 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} role="dialog" aria-modal="true" aria-label="Buy add-ons">
      <div className="modal-box modal-box--addons">
        {/* header */}
        <div className="modal-header">
          <div className="modal-header__left">
            <ShoppingCart size={20} className="modal-header__icon" />
            <h2 className="modal-title">Buy Add-Ons</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="modal-subtitle">
          Extend your current plan with additional resources. Your request goes to the platform
          administrator for approval.
        </p>

        {submitSuccess && (
          <div className="modal-success" role="status">
            <CheckCircle2 size={18} />
            {submitSuccess}
          </div>
        )}
        {submitError && <div className="modal-error">{submitError}</div>}

        <div className="addons-grid">
          {ADD_ONS.map((addon) => (
            <button
              key={addon.id}
              type="button"
              className={`addon-card${selected === addon.id ? ' addon-card--selected' : ''}`}
              onClick={() => setSelected(addon.id)}
            >
              {addon.popular && (
                <span className="addon-card__badge">Most Popular</span>
              )}
              <span className="addon-card__tag">{addon.tag}</span>
              <span className="addon-card__icon">{addon.icon}</span>
              <span className="addon-card__name">{addon.name}</span>
              <span className="addon-card__desc">{addon.desc}</span>
              {selected === addon.id && (
                <label className="addon-card__input-wrap">
                  <span className="addon-card__input-label">{addon.inputLabel}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="addon-card__input"
                    placeholder={addon.inputPlaceholder}
                    value={quantities[addon.id] ?? ''}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [addon.id]: e.target.value,
                      }))
                    }
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
              )}
              {selected === addon.id && (
                <CheckCircle size={18} className="addon-card__check" />
              )}
            </button>
          ))}
        </div>

        <div className="modal-footer">
          <p className="modal-contact-note">
            Approved add-ons are applied to your organization&apos;s quotas automatically.
          </p>
          <div className="modal-footer__actions">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              {submitSuccess ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              className="modal-btn modal-btn--primary"
              disabled={!selected || submitting || !!submitSuccess}
              onClick={() => void handleRequest()}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="usage-btn-spin" aria-hidden />
                  Sending…
                </>
              ) : (
                <>
                  <ShoppingCart size={14} />
                  Request Add-On
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── main component ──────────────────────────────────────────── */
export default function Usage() {
  const { user }   = useAuth();
  const listScope  = useListScope();
  const dispatch   = useAppDispatch();
  const isMember   = user?.role === 'member';
  const isOrgAdmin = user?.role === 'org_admin';
  const isOrgUser  = user?.role === 'member' || user?.role === 'org_admin';
  const hasOrg     = user?.organizationId != null && user?.organizationId !== '';
  const canUseUsage = isOrgUser && hasOrg;

  // ── Redux UI state ────────────────────────────────────────────
  const showUpgrade = useAppSelector(selectShowUpgrade);
  const showAddOns  = useAppSelector(selectShowAddOns);

  // ── React Query (server state) ────────────────────────────────
  const { license, isLoading: loading, error, refresh: refreshLicense } = useUsageQuery({
    enabled: canUseUsage,
  });
  const [myRequests, setMyRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const loadMyRequests = async () => {
    setRequestsLoading(true);
    try {
      const data = await planRequestService.listMine();
      setMyRequests(Array.isArray(data) ? data.slice(0, 5) : []);
    } catch (e) {
      console.warn('Could not load plan requests:', planRequestErrorMessage(e, ''));
      setMyRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  };

  useEffect(() => {
    if (!canUseUsage) return;
    void loadMyRequests();
  }, [canUseUsage]);
  // Plans are fetched lazily — only when the upgrade modal is open
  const { plans, isLoading: plansLoading, error: plansError } = usePlansQuery({
    enabled: showUpgrade && canUseUsage,
  });

  /* ── derived values ── */
  const pagesUsed  = license?.usage?.used   ?? 0;
  const pagesLimit = license?.usage?.limit  ?? null;
  const seatsUsed  = license?.seats?.used   ?? 0;
  const seatsLimit = license?.seats?.limit  ?? null;
  const validUntil = license?.validity?.validUntil ?? null;
  const planName   = user?.planName ?? user?.plan ?? 'Plus';

  /* ── resource cards ── */
  const resourceCards = [
    {
      icon: <Video size={20} />,
      label: 'PDF Pages',
      unit: 'pages',
      used: pagesUsed,
      limit: pagesLimit,
    },
    {
      icon: <RefreshCw size={20} />,
      label: 'Team seats',
      unit: 'seats',
      used: seatsUsed,
      limit: seatsLimit,
    },
  ];

  /* ── plan limits ── */
  const planLimits = [
    {
      icon: <Clock size={18} />,
      label: 'Max video length',
      value: '10 min',
    },
    {
      icon: <Database size={18} />,
      label: 'Max file size',
      value: '200 MB',
    },
    {
      icon: <FileText size={18} />,
      label: 'PDF page quota',
      value: pagesLimit != null ? `${fmtPages(pagesLimit)} pages` : 'Unlimited',
    },
    {
      icon: <Mic size={18} />,
      label: 'Voice-over minutes',
      value: '40 mins',
    },
    {
      icon: <RefreshCw size={18} />,
      label: 'Team seats',
      value: seatsLimit != null ? `${seatsUsed} / ${seatsLimit}` : `${seatsUsed} (unlimited)`,
    },
    {
      icon: <Languages size={18} />,
      label: 'Monthly scripts & translations',
      value: '15',
    },
  ];
  const visiblePlanLimits = isOrgAdmin
    ? planLimits.filter(
        (item) =>
          item.label !== 'Voice-over minutes' &&
          item.label !== 'Team seats' &&
          item.label !== 'Monthly scripts & translations',
      )
    : planLimits;

  return (
    <div className="usage-page">
      {/* ── top bar ── */}
      <div className="usage-topbar">
        <h2 className="usage-topbar__title">Usage</h2>
        <button className="usage-topbar__help">
          <Info size={16} />
          How Usage Works?
        </button>
      </div>

      {/* ── page body ── */}
      <div className="usage-body">
        <h1 className="usage-heading">Usage &amp; Limits</h1>
        <p className="usage-subheading">
          {listScope === 'own'
            ? 'View your organization plan and shared usage limits'
            : 'Track your organization\u2019s usage and subscription limits'}
        </p>

        {/* ── current plan banner ── */}
        <div className="usage-plan-banner">
          <div className="usage-plan-banner__left">
            <span className="usage-plan-banner__icon">
              <BarChart2 size={22} />
            </span>
            <div>
              <div className="usage-plan-banner__name">
                Current Plan{' '}
                <span className="usage-plan-banner__badge">
                  {String(planName).toUpperCase()}
                </span>
              </div>
              <div className="usage-plan-banner__hint">
                {isMember
                  ? 'Request a plan change — sent to the platform administrator for approval'
                  : 'Request upgrades from the platform administrator'}
              </div>
            </div>
          </div>
          <div className="usage-plan-banner__right">
            {validUntil && (
              <div className="usage-plan-banner__reset">
                <span className="usage-plan-banner__reset-label">Valid until</span>
                <span className="usage-plan-banner__reset-date">{fmtDate(validUntil)}</span>
              </div>
            )}
            {!isOrgAdmin && (
              <button className="usage-plan-banner__upgrade" onClick={() => dispatch(openUpgradeModal())}>
                Upgrade Plan
              </button>
            )}
          </div>
        </div>

        {/* ── loading / error ── */}
        {!canUseUsage && (
          <div className="usage-error" role="alert">
            {user?.role === 'platform_admin'
              ? 'Usage and add-on requests are for organization members and org admins. Open an organization account to use this page.'
              : 'No organization is assigned to your account. Contact your administrator before requesting add-ons or upgrades.'}
          </div>
        )}

        {canUseUsage && loading && <div className="usage-loading">Loading usage data…</div>}
        {canUseUsage && error && <div className="usage-error">{error}</div>}

        {canUseUsage && !loading && !error && (
          <>
            {/* ── resource usage ── */}
            <section className="usage-section">
              <h3 className="usage-section__title">Resource Usage</h3>
              <div className="usage-cards-grid">
                {resourceCards.map((card) => (
                  <UsageCard key={card.label} {...card} />
                ))}
              </div>
              <div className="usage-section-actions">
                <button
                  type="button"
                  className="usage-addons-btn"
                  onClick={() => dispatch(openAddOnsModal())}
                >
                  <ShoppingCart size={16} strokeWidth={2} aria-hidden />
                  Buy Add-Ons
                </button>
                <p className="usage-section-actions-hint">
                  Request extra pages, seats, or TTS minutes — approved by the platform administrator.
                </p>
              </div>
            </section>

            {/* ── plan limits ── */}
            <section className="usage-section">
              <h3 className="usage-section__title">Plan Limits</h3>
              <div className="usage-limits-grid">
                {visiblePlanLimits.map((item) => (
                  <PlanLimitItem key={item.label} {...item} />
                ))}
              </div>
            </section>

            {(myRequests.length > 0 || requestsLoading) && (
              <section className="usage-section">
                <h3 className="usage-section__title">Your requests</h3>
                {requestsLoading ? (
                  <p className="usage-requests-loading">Loading requests…</p>
                ) : (
                  <ul className="usage-requests-list">
                    {myRequests.map((r) => (
                      <li key={r.id} className={`usage-request-item usage-request-item--${r.status}`}>
                        <span className="usage-request-label">{r.requestLabel}</span>
                        <span className="usage-request-status">{r.status}</span>
                        <span className="usage-request-date">
                          {r.createdAt
                            ? new Date(r.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Upgrade modal ── */}
      {showUpgrade && (
        <UpgradeModal
          currentPlanName={planName}
          plans={plans}
          loading={plansLoading}
          error={plansError}
          isMember={isMember}
          onClose={() => dispatch(closeUpgradeModal())}
          onRequestSent={() => {
            void loadMyRequests();
          }}
        />
      )}

      {/* ── Add-Ons modal ── */}
      {showAddOns && (
        <AddOnsModal
          canSubmit={canUseUsage}
          onClose={() => dispatch(closeAddOnsModal())}
          onRequestSent={() => {
            void loadMyRequests();
            void refreshLicense();
          }}
        />
      )}
    </div>
  );
}
