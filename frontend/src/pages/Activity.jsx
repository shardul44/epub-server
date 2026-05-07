import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  ChevronDown,
  Download,
  FileUp,
  Search,
  Users,
} from 'lucide-react';
import { useAppBootstrap } from '../hooks/queries/useAppBootstrap';
import { useAuth } from '../context/AuthContext';
import './Activity.css';

const PAGE_SIZE = 10;

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isPdfUpload(action) {
  if (!action || typeof action !== 'string') return false;
  const a = action.toLowerCase();
  return a === 'pdf:upload' || (a.includes('pdf') && a.includes('upload'));
}

function escapeCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(','));
  return [header, ...lines].join('\r\n');
}

export default function Activity() {
  const { user } = useAuth();
  const { activities, isLoading: loading, error: bootstrapError } = useAppBootstrap();
  const rows = activities;
  const error = bootstrapError ?? '';
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const title =
    user?.role === 'platform_admin'
      ? 'Activity (all organizations)'
      : user?.role === 'org_admin'
        ? 'Activity (your organization)'
        : 'Your activity';

  const subtitle =
    user?.role === 'member'
      ? 'Actions you performed in this application.'
      : user?.role === 'org_admin'
        ? 'Actions by users in your organization.'
        : 'Actions across tenants (platform administrator view).';

  const actionOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      if (r.action) set.add(r.action);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const dateOptions = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const k = dayKey(r.createdAt);
      if (!k) return;
      if (!map.has(k)) map.set(k, r.createdAt);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, sampleIso]) => ({ key, label: formatDayLabel(sampleIso) }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (dateFilter && dayKey(r.createdAt) !== dateFilter) return false;
      if (!q) return true;
      const hay = [
        r.summary,
        r.action,
        r.actorEmail,
        r.actorName,
        r.organizationName,
        String(r.userId ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, actionFilter, dateFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, actionFilter, dateFilter]);

  const stats = useMemo(() => {
    const total = filteredRows.length;
    const pdfUploads = filteredRows.filter((r) => isPdfUpload(r.action)).length;
    const actors = new Set();
    filteredRows.forEach((r) => {
      const id = r.actorEmail || r.actorName || r.userId;
      if (id != null && id !== '') actors.add(String(id));
    });
    const activeUsers =
      total === 0 ? 0 : user?.role === 'member' ? 1 : actors.size;
    return { total, pdfUploads, activeUsers };
  }, [filteredRows, user?.role]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page, totalPages]);

  const pageNumbers = useMemo(() => {
    const n = totalPages;
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const p = safePage;
    const out = new Set([1, n, p, p - 1, p + 1]);
    const sorted = [...out].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
    const res = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) res.push('…');
      res.push(sorted[i]);
    }
    return res;
  }, [totalPages, safePage]);

  const exportCsv = useCallback(() => {
    const cols = [
      { label: 'When', value: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString() : '') },
      { label: 'Action', value: (r) => r.action ?? '' },
      { label: 'Summary', value: (r) => r.summary ?? '' },
    ];
    if (user?.role !== 'member') cols.push({ label: 'User', value: (r) => r.actorEmail || r.actorName || r.userId || '' });
    if (user?.role === 'platform_admin')
      cols.push({ label: 'Organization', value: (r) => r.organizationName || r.organizationId || '' });
    const csv = buildCsv(filteredRows, cols);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }, [filteredRows, user?.role]);

  if (loading) {
    return (
      <div className="act-root">
        <div className="act-loading">
          <div className="act-spinner" aria-hidden />
          Loading activity…
        </div>
      </div>
    );
  }

  const startIdx = filteredRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(safePage * PAGE_SIZE, filteredRows.length);

  return (
    <div className="act-root">
      <div className="act-inner">
        <header className="act-header">
          <h1 className="act-title">{title}</h1>
          <p className="act-subtitle">{subtitle}</p>
        </header>

        {error && <div className="act-error">{error}</div>}

        <section className="act-stats" aria-label="Summary statistics">
          <div className="act-stat">
            <div className="act-stat-icon" aria-hidden>
              <ActivityIcon size={22} strokeWidth={2} />
            </div>
            <div className="act-stat-body">
              <div className="act-stat-value">{stats.total}</div>
              <div className="act-stat-label">Total events</div>
            </div>
          </div>
          <div className="act-stat">
            <div className="act-stat-icon" aria-hidden>
              <FileUp size={22} strokeWidth={2} />
            </div>
            <div className="act-stat-body">
              <div className="act-stat-value">{stats.pdfUploads}</div>
              <div className="act-stat-label">PDF uploads</div>
            </div>
          </div>
          <div className="act-stat">
            <div className="act-stat-icon" aria-hidden>
              <Users size={22} strokeWidth={2} />
            </div>
            <div className="act-stat-body">
              <div className="act-stat-value">{stats.activeUsers}</div>
              <div className="act-stat-label">Active users</div>
            </div>
          </div>
        </section>

        <div className="act-toolbar">
          <div className="act-search-wrap">
            <Search className="act-search-icon" size={18} aria-hidden />
            <input
              className="act-search"
              type="search"
              placeholder="Search by file name or user…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search activity"
            />
          </div>
          <div className="act-filters">
            <select
              className="act-select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="act-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter by date"
            >
              <option value="">All dates</option>
              {dateOptions.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <div className="act-export-wrap" ref={exportRef}>
              <button
                type="button"
                className="act-export-btn"
                onClick={() => setExportOpen((o) => !o)}
                aria-expanded={exportOpen}
                aria-haspopup="menu"
              >
                Export CSV
                <ChevronDown size={16} aria-hidden />
              </button>
              {exportOpen && (
                <div className="act-export-menu" role="menu">
                  <button type="button" className="act-export-item" role="menuitem" onClick={exportCsv}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Download size={16} aria-hidden />
                      Download filtered ({filteredRows.length})
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="act-card-table">
          <div className="act-table-scroll">
            <table className="act-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Summary</th>
                  {user?.role !== 'member' && <th>User</th>}
                  {user?.role === 'platform_admin' && <th>Organization</th>}
                </tr>
              </thead>
              <tbody>
                {pageSlice.map((r) => (
                  <tr key={r.id}>
                    <td className="act-when">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      <span className="act-badge">{r.action || '—'}</span>
                    </td>
                    <td className="act-summary">{r.summary || '—'}</td>
                    {user?.role !== 'member' && (
                      <td className="act-user">{r.actorEmail || r.actorName || r.userId || '—'}</td>
                    )}
                    {user?.role === 'platform_admin' && (
                      <td className="act-user">{r.organizationName || r.organizationId || '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!filteredRows.length && !error && (
            <div className="act-empty">
              {rows.length === 0
                ? 'No activity yet.'
                : 'No activity matches your filters.'}
            </div>
          )}

          {!!filteredRows.length && (
            <footer className="act-footer">
              <span>
                Showing {startIdx}–{endIdx} of {filteredRows.length}
              </span>
              <nav className="act-pagination" aria-label="Pagination">
                <button
                  type="button"
                  className="act-page-link"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                {pageNumbers.map((item, i) =>
                  item === '…' ? (
                    <span key={`e-${i}`} style={{ padding: '0 4px', color: '#9ca3af' }}>
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={`act-page-num${item === safePage ? ' act-page-num--active' : ''}`}
                      onClick={() => setPage(item)}
                      aria-current={item === safePage ? 'page' : undefined}
                    >
                      {item}
                    </button>
                  )
                )}
                <button
                  type="button"
                  className="act-page-link"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </button>
              </nav>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
