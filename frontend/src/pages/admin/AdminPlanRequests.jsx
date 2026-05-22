import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  X,
  ArrowUp,
  ShoppingCart,
  Loader2,
  Building2,
  MoreVertical,
  SlidersHorizontal,
  ChevronDown,
  CircleCheck,
  CircleX,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { planRequestService } from '../../services/planRequestService';
import { queryKeys } from '../../lib/queryKeys';
import './AdminPlanRequests.css';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isInCurrentMonth(iso) {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return t >= startOfMonth();
}

function requesterInitial(name, email) {
  const s = (name || email || '?').trim();
  return s.charAt(0).toUpperCase();
}

function targetTag(req) {
  if (req.requestType === 'upgrade') return req.planName || 'Plan upgrade';
  return req.addonKey || req.requestLabel;
}

export default function AdminPlanRequests() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [sort, setSort] = useState('newest');
  const [typeFilter, setTypeFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actingId, setActingId] = useState(null);
  const [noteById, setNoteById] = useState({});
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [actionError, setActionError] = useState('');

  const {
    data: allRequests = [],
    isLoading,
    error: loadErr,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'plan-requests', 'all'],
    queryFn: () => adminService.getPlanRequests({}),
    staleTime: 20 * 1000,
  });

  const { data: organizations = [] } = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const counts = useMemo(() => {
    const arr = Array.isArray(allRequests) ? allRequests : [];
    return {
      pending: arr.filter((r) => r.status === 'pending').length,
      approved: arr.filter((r) => r.status === 'approved').length,
      rejected: arr.filter((r) => r.status === 'rejected').length,
      all: arr.length,
    };
  }, [allRequests]);

  const stats = useMemo(() => {
    const arr = Array.isArray(allRequests) ? allRequests : [];
    const approvedMonth = arr.filter(
      (r) => r.status === 'approved' && isInCurrentMonth(r.reviewedAt || r.createdAt),
    ).length;
    const rejectedMonth = arr.filter(
      (r) => r.status === 'rejected' && isInCurrentMonth(r.reviewedAt || r.createdAt),
    ).length;
    const activeOrgs = (organizations || []).filter((o) => o.active !== false).length;
    return {
      pending: counts.pending,
      approvedMonth,
      rejectedMonth,
      orgCount: activeOrgs || organizations.length,
    };
  }, [allRequests, organizations, counts.pending]);

  const list = useMemo(() => {
    let arr = [...(Array.isArray(allRequests) ? allRequests : [])];
    if (filter !== 'all') arr = arr.filter((r) => r.status === filter);
    if (typeFilter === 'upgrade') arr = arr.filter((r) => r.requestType === 'upgrade');
    if (typeFilter === 'addon') arr = arr.filter((r) => r.requestType === 'addon');
    arr.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return sort === 'oldest' ? ta - tb : tb - ta;
    });
    return arr;
  }, [allRequests, filter, sort, typeFilter]);

  const invalidateCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'plan-requests'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.license() });
    queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
  };

  const handleApprove = async (req) => {
    setActingId(req.id);
    setActionError('');
    try {
      await planRequestService.approve(req.id, noteById[req.id] || '');
      invalidateCaches();
      await refetch();
    } catch (e) {
      setActionError(e.response?.data?.error || e.message);
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (req) => {
    setActingId(req.id);
    setActionError('');
    try {
      await planRequestService.reject(req.id, noteById[req.id] || '');
      invalidateCaches();
      await refetch();
    } catch (e) {
      setActionError(e.response?.data?.error || e.message);
    } finally {
      setActingId(null);
    }
  };

  const tabs = [
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'approved', label: 'Approved', count: counts.approved },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
    { key: 'all', label: 'All', count: counts.all },
  ];

  const error = actionError || (loadErr?.message ?? '');

  useEffect(() => {
    if (!menuOpenId && !filtersOpen) return undefined;
    const close = () => {
      setMenuOpenId(null);
      setFiltersOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpenId, filtersOpen]);

  return (
    <div className="apr-root">
      <header className="apr-head">
        <h1 className="apr-title">Plan requests</h1>
        <p className="apr-sub">
          Review upgrade and add-on requests from organization members. Approving applies the
          change to the organization&apos;s subscription and quotas.
        </p>
      </header>

      <div className="apr-toolbar">
        <div className="apr-tabs" role="tablist" aria-label="Request status filter">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter === t.key}
              className={`apr-tab${filter === t.key ? ' apr-tab--on' : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              <span className="apr-tab-count">({t.count})</span>
            </button>
          ))}
        </div>
        <div className="apr-toolbar-right">
          <label className="apr-sort">
            <span className="apr-sort-label">Sort by</span>
            <div className="apr-sort-wrap">
              <select
                className="apr-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort requests"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
              <ChevronDown size={16} className="apr-sort-chevron" aria-hidden />
            </div>
          </label>
          <div className="apr-filters-wrap" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`apr-filters-btn${filtersOpen ? ' apr-filters-btn--on' : ''}${typeFilter !== 'all' ? ' apr-filters-btn--active' : ''}`}
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={16} />
              Filters
            </button>
            {filtersOpen && (
              <div className="apr-filters-menu" role="menu">
                <p className="apr-filters-menu-title">Request type</p>
                {[
                  { key: 'all', label: 'All types' },
                  { key: 'upgrade', label: 'Upgrades only' },
                  { key: 'addon', label: 'Add-ons only' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={typeFilter === opt.key}
                    className={`apr-filters-option${typeFilter === opt.key ? ' apr-filters-option--on' : ''}`}
                    onClick={() => {
                      setTypeFilter(opt.key);
                      setFiltersOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="apr-stats">
        <div className="apr-stat-card">
          <span className="apr-stat-icon apr-stat-icon--amber" aria-hidden>
            <ShoppingCart size={20} />
          </span>
          <div className="apr-stat-body">
            <span className="apr-stat-label">Pending requests</span>
            <span className="apr-stat-value">{stats.pending}</span>
            <span className="apr-stat-hint">Awaiting your review</span>
          </div>
        </div>
        <div className="apr-stat-card">
          <span className="apr-stat-icon apr-stat-icon--green" aria-hidden>
            <CircleCheck size={20} />
          </span>
          <div className="apr-stat-body">
            <span className="apr-stat-label">Approved this month</span>
            <span className="apr-stat-value">{stats.approvedMonth}</span>
            <span className="apr-stat-hint apr-stat-hint--muted">Current calendar month</span>
          </div>
        </div>
        <div className="apr-stat-card">
          <span className="apr-stat-icon apr-stat-icon--red" aria-hidden>
            <CircleX size={20} />
          </span>
          <div className="apr-stat-body">
            <span className="apr-stat-label">Rejected this month</span>
            <span className="apr-stat-value">{stats.rejectedMonth}</span>
            <span className="apr-stat-hint apr-stat-hint--muted">Current calendar month</span>
          </div>
        </div>
        <div className="apr-stat-card">
          <span className="apr-stat-icon apr-stat-icon--blue" aria-hidden>
            <Building2 size={20} />
          </span>
          <div className="apr-stat-body">
            <span className="apr-stat-label">Total organizations</span>
            <span className="apr-stat-value">{stats.orgCount}</span>
            <span className="apr-stat-hint">Active on your platform</span>
          </div>
        </div>
      </div>

      {error && <div className="apr-err" role="alert">{error}</div>}

      {isLoading ? (
        <div className="apr-loading">
          <Loader2 size={22} className="apr-spin" aria-hidden />
          Loading requests…
        </div>
      ) : list.length === 0 ? (
        <div className="apr-empty">
          <p>No {filter === 'all' ? '' : `${filter} `}requests match your filters.</p>
        </div>
      ) : (
        <div className="apr-list">
          {list.map((req) => {
            const busy = actingId === req.id;
            const isPending = req.status === 'pending';
            const menuOpen = menuOpenId === req.id;

            return (
              <article key={req.id} className="apr-card">
                <div className="apr-card-head">
                  <div className="apr-card-head-left">
                    <span className={`apr-badge apr-badge--${req.status}`}>{req.status}</span>
                    <span className="apr-type-pill">
                      {req.requestType === 'upgrade' ? (
                        <>
                          <ArrowUp size={14} aria-hidden />
                          Upgrade
                        </>
                      ) : (
                        <>
                          <ShoppingCart size={14} aria-hidden />
                          Add-on
                        </>
                      )}
                    </span>
                  </div>
                  <div className="apr-card-head-right">
                    <time className="apr-card-date" dateTime={req.createdAt}>
                      {fmtDate(req.createdAt)}
                    </time>
                    <div className="apr-menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="apr-menu-btn"
                        aria-label="More actions"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpenId(menuOpen ? null : req.id)}
                      >
                        <MoreVertical size={18} />
                      </button>
                      {menuOpen && (
                        <div className="apr-menu-dropdown" role="menu">
                          {isPending && (
                            <>
                              <button
                                type="button"
                                role="menuitem"
                                className="apr-menu-item apr-menu-item--approve"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  void handleApprove(req);
                                }}
                              >
                                Approve &amp; apply
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="apr-menu-item apr-menu-item--reject"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  void handleReject(req);
                                }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className="apr-menu-item"
                            onClick={() => {
                              setMenuOpenId(null);
                              navigator.clipboard?.writeText(String(req.id));
                            }}
                          >
                            Copy request ID
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <h2 className="apr-card-title">{req.requestLabel}</h2>

                <div className="apr-info-grid">
                  <div className="apr-info-cell">
                    <span className="apr-info-label">Organization</span>
                    <span className="apr-info-value">
                      <Building2 size={16} className="apr-info-icon" aria-hidden />
                      {req.organizationName || `Org #${req.organizationId}`}
                    </span>
                  </div>
                  <div className="apr-info-cell">
                    <span className="apr-info-label">Requested by</span>
                    <span className="apr-info-value apr-info-value--user">
                      <span className="apr-avatar" aria-hidden>
                        {requesterInitial(req.requesterName, req.requesterEmail)}
                      </span>
                      <span className="apr-user-text">
                        <span className="apr-user-name">{req.requesterName || '—'}</span>
                        {req.requesterEmail && (
                          <span className="apr-user-email">{req.requesterEmail}</span>
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="apr-info-cell">
                    <span className="apr-info-label">
                      {req.requestType === 'upgrade' ? 'Target plan' : 'Add-on key'}
                    </span>
                    <span className="apr-tag">{targetTag(req)}</span>
                  </div>
                </div>

                {req.memberNote && (
                  <p className="apr-member-note">
                    <strong>Member note:</strong> {req.memberNote}
                  </p>
                )}
                {req.adminNote && !isPending && (
                  <p className="apr-admin-note">
                    <strong>Admin note:</strong> {req.adminNote}
                  </p>
                )}

                {isPending ? (
                  <div className="apr-card-foot">
                    <div className="apr-note-block">
                      <label className="apr-note-label" htmlFor={`note-${req.id}`}>
                        Admin note (optional)
                      </label>
                      <textarea
                        id={`note-${req.id}`}
                        className="apr-note-input"
                        rows={2}
                        placeholder="Visible after approve/reject"
                        value={noteById[req.id] || ''}
                        onChange={(e) =>
                          setNoteById((prev) => ({ ...prev, [req.id]: e.target.value }))
                        }
                      />
                    </div>
                    <div className="apr-actions">
                      <button
                        type="button"
                        className="apr-btn apr-btn--approve"
                        disabled={busy}
                        onClick={() => handleApprove(req)}
                      >
                        {busy ? (
                          <Loader2 size={16} className="apr-spin" aria-hidden />
                        ) : (
                          <Check size={16} strokeWidth={2.5} />
                        )}
                        Approve &amp; apply
                      </button>
                      <button
                        type="button"
                        className="apr-btn apr-btn--reject"
                        disabled={busy}
                        onClick={() => handleReject(req)}
                      >
                        <X size={16} strokeWidth={2.5} />
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  req.reviewedAt && (
                    <p className="apr-reviewed">
                      Reviewed {fmtDate(req.reviewedAt)}
                    </p>
                  )
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
