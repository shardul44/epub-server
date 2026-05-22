import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Bell, CircleHelp, ArrowUp, ShoppingCart, Inbox } from 'lucide-react';
import { adminService } from '../services/adminService';
import './PlatformAdminHeader.css';

function fmtTimeAgo(d) {
  if (!d) return '';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const sec = Math.floor((Date.now() - t.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Sticky top bar for platform administrators — title, global search field,
 * and utility actions.
 */
export default function PlatformAdminHeader() {
  const [query, setQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const notifWrapRef = useRef(null);

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['admin', 'plan-requests', 'pending-count'],
    queryFn: () => adminService.getPlanRequestsPendingCount(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  });

  const {
    data: notifications = [],
    isLoading: notifLoading,
    refetch: refetchNotifs,
  } = useQuery({
    queryKey: ['admin', 'plan-requests', 'header-notifications'],
    queryFn: async () => {
      const pending = await adminService.getPlanRequests({ status: 'pending' });
      const list = Array.isArray(pending) ? pending : [];
      if (list.length >= 8) return list.slice(0, 8);
      const all = await adminService.getPlanRequests({});
      const recent = (Array.isArray(all) ? all : []).filter((r) => r.status !== 'pending');
      const seen = new Set(list.map((r) => r.id));
      for (const r of recent) {
        if (list.length >= 8) break;
        if (!seen.has(r.id)) list.push(r);
      }
      return list.slice(0, 8);
    },
    enabled: notifOpen,
    staleTime: 15 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!notifOpen) return undefined;
    const onDoc = (e) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [notifOpen]);

  const toggleNotifs = () => {
    setNotifOpen((o) => {
      if (!o) void refetchNotifs();
      return !o;
    });
  };

  const badge = pendingCount > 0 ? (pendingCount > 99 ? '99+' : String(pendingCount)) : null;

  return (
    <header className="pah" role="banner">
      <div className="pah-left">
        <h1 className="pah-title">
          <span className="pah-title-strong">Platform</span>
          <span className="pah-title-accent"> Admin</span>
        </h1>
      </div>

      <div className="pah-right">
        <label className="pah-search" htmlFor="pah-global-search">
          <span className="pah-search-icon" aria-hidden>
            <Search size={18} strokeWidth={2} />
          </span>
          <input
            id="pah-global-search"
            className="pah-search-input"
            type="search"
            placeholder="Search users, orgs, plans…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="pah-notif-wrap" ref={notifWrapRef}>
          <button
            type="button"
            className={`pah-icon-btn${notifOpen ? ' pah-icon-btn--active' : ''}`}
            aria-label={badge ? `Notifications, ${badge} pending` : 'Notifications'}
            title="Notifications"
            aria-expanded={notifOpen}
            aria-haspopup="true"
            onClick={toggleNotifs}
          >
            <Bell size={20} strokeWidth={2} />
            {badge && <span className="pah-notif-badge">{badge}</span>}
          </button>

          {notifOpen && (
            <div className="pah-notif-panel" role="dialog" aria-label="Recent notifications">
              <div className="pah-notif-head">
                <h2 className="pah-notif-title">Notifications</h2>
                {pendingCount > 0 && (
                  <span className="pah-notif-pending-pill">{pendingCount} pending</span>
                )}
              </div>

              {notifLoading ? (
                <p className="pah-notif-empty">Loading…</p>
              ) : notifications.length === 0 ? (
                <p className="pah-notif-empty">No plan or quota requests yet.</p>
              ) : (
                <ul className="pah-notif-list">
                  {notifications.map((req) => (
                    <li key={req.id}>
                      <Link
                        to="/admin/plan-requests"
                        className="pah-notif-item"
                        onClick={() => setNotifOpen(false)}
                      >
                        <span
                          className={`pah-notif-item-icon${
                            req.requestType === 'addon' ? ' pah-notif-item-icon--addon' : ''
                          }`}
                          aria-hidden
                        >
                          {req.requestType === 'addon' ? (
                            <ShoppingCart size={16} />
                          ) : (
                            <ArrowUp size={16} />
                          )}
                        </span>
                        <span className="pah-notif-item-body">
                          <span className="pah-notif-item-label">{req.requestLabel}</span>
                          <span className="pah-notif-item-meta">
                            {req.organizationName || `Org #${req.organizationId}`}
                            {req.requesterName ? ` · ${req.requesterName}` : ''}
                          </span>
                          <span className="pah-notif-item-desc">
                            {req.requestType === 'upgrade'
                              ? 'Plan upgrade request'
                              : 'Quota add-on request'}
                          </span>
                        </span>
                        <span className="pah-notif-item-right">
                          <span className={`pah-notif-status pah-notif-status--${req.status}`}>
                            {req.status}
                          </span>
                          <span className="pah-notif-time">{fmtTimeAgo(req.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pah-notif-foot">
                <Link
                  to="/admin/plan-requests"
                  className="pah-notif-view-all"
                  onClick={() => setNotifOpen(false)}
                >
                  <Inbox size={15} aria-hidden />
                  View all plan requests
                </Link>
              </div>
            </div>
          )}
        </div>

        <button type="button" className="pah-icon-btn" aria-label="Help" title="Help">
          <CircleHelp size={20} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
