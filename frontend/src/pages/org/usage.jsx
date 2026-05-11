import { useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
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
  ArrowUp,
  Clock,
  FileText,
  BarChart2,
  X,
  CheckCircle,
  Star,
  ShoppingCart,
  Zap,
} from 'lucide-react';
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
function UpgradeModal({ currentPlanName, plans, loading, error, onClose }) {
  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
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
          Choose a plan below to unlock more capacity.
        </p>

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
                    className={`plan-card__btn${isCurrent ? ' plan-card__btn--disabled' : ''}`}
                    disabled={isCurrent}
                    onClick={() => {
                      if (!isCurrent) {
                        window.open(
                          `mailto:support@kodeit.digital?subject=Upgrade request: ${plan.name} plan`,
                          '_blank'
                        );
                      }
                    }}
                  >
                    {isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="modal-contact-note">
          To upgrade, contact us at{' '}
          <a href="mailto:support@kodeit.digital">support@kodeit.digital</a> or reach out to your
          account manager.
        </p>
      </div>
    </div>
  );
}

/* ─── AddOnsModal ─────────────────────────────────────────────── */
const ADD_ONS = [
  {
    id: 'pages-500',
    icon: <FileText size={22} />,
    name: '500 Extra Pages',
    desc: 'Add 500 PDF pages to your current subscription period.',
    tag: 'Pages',
  },
  {
    id: 'pages-2000',
    icon: <FileText size={22} />,
    name: '2,000 Extra Pages',
    desc: 'Best value — add 2,000 PDF pages to your current subscription period.',
    tag: 'Pages',
    popular: true,
  },
  {
    id: 'seats-5',
    icon: <Database size={22} />,
    name: '5 Extra Seats',
    desc: 'Add 5 member seats to your organization.',
    tag: 'Seats',
  },
  {
    id: 'tts-60',
    icon: <Mic size={22} />,
    name: '60 TTS Minutes',
    desc: 'Add 60 minutes of text-to-speech generation.',
    tag: 'TTS',
  },
];

function AddOnsModal({ onClose }) {
  const [selected, setSelected] = useState(null);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleRequest = () => {
    if (!selected) return;
    const addon = ADD_ONS.find((a) => a.id === selected);
    window.open(
      `mailto:support@kodeit.digital?subject=Add-On Request: ${addon?.name}`,
      '_blank'
    );
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
          Extend your current plan with additional resources without changing your subscription.
        </p>

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
                <CheckCircle size={18} className="addon-card__check" />
              )}
            </button>
          ))}
        </div>

        <div className="modal-footer">
          <p className="modal-contact-note">
            Pricing is available on request.{' '}
            <a href="mailto:support@kodeit.digital">Contact us</a> to get a quote.
          </p>
          <div className="modal-footer__actions">
            <button className="modal-btn modal-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="modal-btn modal-btn--primary"
              disabled={!selected}
              onClick={handleRequest}
            >
              <ShoppingCart size={14} />
              Request Add-On
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
  const dispatch   = useAppDispatch();

  // ── Redux UI state ────────────────────────────────────────────
  const showUpgrade = useAppSelector(selectShowUpgrade);
  const showAddOns  = useAppSelector(selectShowAddOns);

  // ── React Query (server state) ────────────────────────────────
  const { license, isLoading: loading, error } = useUsageQuery();
  // Plans are fetched lazily — only when the upgrade modal is open
  const { plans, isLoading: plansLoading, error: plansError } = usePlansQuery({ enabled: showUpgrade });

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
      icon: <Mic size={20} />,
      label: 'Voice-Over Generation',
      unit: 'mins',
      used: 0,
      limit: null,
    },
    {
      icon: <RefreshCw size={20} />,
      label: 'Renders',
      unit: 'renders',
      used: 0,
      limit: null,
    },
    {
      icon: <Database size={20} />,
      label: 'Storage',
      unit: 'GB',
      used: 0,
      limit: null,
    },
    {
      icon: <Languages size={20} />,
      label: 'Scripts & Translations',
      unit: 'generations',
      used: 0,
      limit: null,
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
          Track your organization&apos;s usage and subscription limits
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
                Upgrade to unlock more capacity
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
            <button className="usage-plan-banner__upgrade" onClick={() => dispatch(openUpgradeModal())}>
              <ArrowUp size={14} />
              Upgrade Plan
            </button>
          </div>
        </div>

        {/* ── loading / error ── */}
        {loading && <div className="usage-loading">Loading usage data…</div>}
        {error   && <div className="usage-error">{error}</div>}

        {!loading && !error && (
          <>
            {/* ── resource usage ── */}
            <section className="usage-section">
              <h3 className="usage-section__title">Resource Usage</h3>
              <div className="usage-cards-grid">
                {resourceCards.map((card) => (
                  <UsageCard key={card.label} {...card} />
                ))}
              </div>
              <button className="usage-addons-btn" onClick={() => dispatch(openAddOnsModal())}>
                <ShoppingCart size={15} />
                Buy Add-Ons
              </button>
            </section>

            {/* ── plan limits ── */}
            <section className="usage-section">
              <h3 className="usage-section__title">Plan Limits</h3>
              <div className="usage-limits-grid">
                {planLimits.map((item) => (
                  <PlanLimitItem key={item.label} {...item} />
                ))}
              </div>
            </section>
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
          onClose={() => dispatch(closeUpgradeModal())}
        />
      )}

      {/* ── Add-Ons modal ── */}
      {showAddOns && (
        <AddOnsModal onClose={() => dispatch(closeAddOnsModal())} />
      )}
    </div>
  );
}
