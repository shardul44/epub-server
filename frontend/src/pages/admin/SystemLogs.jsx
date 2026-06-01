import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Search,
  SlidersHorizontal,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Copy,
  ArrowUpDown,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import './SystemLogs.css';

const LEVELS = [
  { value: 'all', label: 'All levels' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARN', label: 'Warn' },
  { value: 'ERROR', label: 'Error' },
];

const TIME_RANGES = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

function formatTableTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatStatusTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function levelTone(level) {
  const u = String(level || 'INFO').toUpperCase();
  if (u === 'WARN') return 'warn';
  if (u === 'ERROR') return 'error';
  return 'info';
}

function normalizeLog(log) {
  const orgFromMsg = log.message?.match(/\(org:\s*([^)]+)\)/i);
  const event =
    log.event ||
    String(log.category || 'event')
      .replace(/\./g, '_')
      .toUpperCase();
  let title = log.title || log.message || 'Event';
  let detail = log.detail || '';
  if (!log.title && log.message) {
    const m = String(log.message);
    const uploadMatch = m.match(/^(Uploaded\s+[^.]+(?:\.pdf)?)/i);
    if (uploadMatch) {
      title = uploadMatch[1].trim();
      detail = m.slice(uploadMatch[0].length).replace(/^[\s·-]+/, '') || 'Recorded successfully';
    } else if (m.includes(' - ')) {
      const [t, ...rest] = m.split(' - ');
      title = t.trim();
      detail = rest.join(' - ').trim();
    }
  }
  return {
    ...log,
    event,
    title,
    detail: detail || '—',
    organizationName: log.organizationName || orgFromMsg?.[1]?.trim() || null,
  };
}

function inTimeRange(ts, range) {
  if (range === 'all') return true;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  const ms =
    range === '24h' ? 86400000 : range === '7d' ? 7 * 86400000 : 30 * 86400000;
  return t >= now - ms;
}

function buildPlainLine(log) {
  return `[${formatTableTime(log.ts)}] ${log.level} ${log.event} - ${log.title}${log.detail && log.detail !== '—' ? ` (${log.detail})` : ''}`;
}

function LevelBadge({ level }) {
  const tone = levelTone(level);
  return (
    <span className={`slog-level slog-level--${tone}`}>
      <span className="slog-level-dot" aria-hidden />
      {String(level || 'INFO').toUpperCase()}
    </span>
  );
}

function RowMenu({ log, onCopy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="slog-row-menu" ref={ref}>
      <button
        type="button"
        className="slog-row-menu-btn"
        aria-label="Row actions"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="slog-row-menu-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCopy(log);
            }}
          >
            <Copy size={14} />
            Copy log line
          </button>
        </div>
      )}
    </div>
  );
}

export default function SystemLogs() {
  const [level, setLevel] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef(null);

  const queryParams = useMemo(() => {
    const p = { limit: 500 };
    if (level && level !== 'all') p.level = level;
    return p;
  }, [level]);

  const logsQuery = useQuery({
    queryKey: ['admin', 'system-logs', queryParams],
    queryFn: () => adminService.getSystemLogs(queryParams),
    staleTime: 0,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.hidden ? false : 10000,
  });

  const rawLogs = useMemo(
    () => (logsQuery.data?.logs ?? []).map(normalizeLog),
    [logsQuery.data?.logs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rawLogs.filter((log) => inTimeRange(log.ts, timeRange));
    if (q) {
      list = list.filter((log) => {
        const hay = [
          log.event,
          log.title,
          log.detail,
          log.message,
          log.level,
          log.organizationName,
          log.ipAddress,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    list = [...list].sort((a, b) => {
      const ta = new Date(a.ts).getTime();
      const tb = new Date(b.ts).getTime();
      return sortDir === 'asc' ? ta - tb : tb - ta;
    });
    return list;
  }, [rawLogs, search, timeRange, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [search, level, timeRange, rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const close = (e) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filtersOpen]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, safePage, rowsPerPage]);

  const downloadTxt = useCallback(() => {
    const body = filtered.map(buildPlainLine).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `system-logs-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const copyLine = useCallback(async (log) => {
    try {
      await navigator.clipboard.writeText(buildPlainLine(log));
    } catch {
      /* ignore */
    }
  }, []);

  const generatedAt = logsQuery.data?.generatedAt
    ? new Date(logsQuery.data.generatedAt)
    : new Date();

  const showingFrom = filtered.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1;
  const showingTo = Math.min(safePage * rowsPerPage, filtered.length);

  if (logsQuery.isLoading && !logsQuery.data) {
    return (
      <div className="slog-root">
        <div className="slog-inner slog-loading">
          <div className="slog-spinner" aria-hidden />
          Loading system logs…
        </div>
      </div>
    );
  }

  return (
    <div className="slog-root">
      <div className="slog-inner">
        <header className="slog-page-head">
          <div>
            <h1 className="slog-title">System Logs</h1>
            <p className="slog-sub">Real-time platform event logs for debugging and auditing.</p>
          </div>
          <div className="slog-page-actions">
            <span className="slog-live-pill" title="Polling every 10 seconds">
              <span className="slog-live-dot" aria-hidden />
              Live
            </span>
            <label className="slog-select-wrap">
              <span className="visually-hidden">Filter by level</span>
              <select
                className="slog-select"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {LEVELS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="slog-select-chevron" aria-hidden />
            </label>
            <label className="slog-select-wrap slog-select-wrap--calendar">
              <Calendar size={15} className="slog-select-icon" aria-hidden />
              <select
                className="slog-select slog-select--with-icon"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                aria-label="Time range"
              >
                {TIME_RANGES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="slog-select-chevron" aria-hidden />
            </label>
            <button
              type="button"
              className="slog-btn-download"
              onClick={downloadTxt}
              disabled={filtered.length === 0}
            >
              <Download size={16} strokeWidth={2} aria-hidden />
              Download
            </button>
          </div>
        </header>

        {logsQuery.isError ? (
          <div className="slog-err">{logsQuery.error?.message || 'Failed to load system logs.'}</div>
        ) : null}

        <section className="slog-card" aria-label="Log entries">
          <header className="slog-card-header">
            <div className="slog-card-header-left">
              <h2 className="slog-card-title">
                Log Entries
                <span className="slog-count-badge">{filtered.length}</span>
              </h2>
              <p className="slog-card-caption">Real-time event feed</p>
            </div>
            <div className="slog-card-tools">
              <div className="slog-search-wrap">
                <Search size={16} className="slog-search-icon" aria-hidden />
                <input
                  type="search"
                  className="slog-search"
                  placeholder="Search logs…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search logs"
                />
              </div>
              <div className="slog-filters-wrap" ref={filtersRef}>
                <button
                  type="button"
                  className={`slog-filters-btn${filtersOpen ? ' slog-filters-btn--on' : ''}`}
                  onClick={() => setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen}
                >
                  <SlidersHorizontal size={16} />
                  Filters
                </button>
                {filtersOpen && (
                  <div className="slog-filters-menu" role="menu">
                    <p className="slog-filters-menu-title">Sort</p>
                    <button
                      type="button"
                      className={`slog-filters-option${sortDir === 'desc' ? ' slog-filters-option--on' : ''}`}
                      onClick={() => {
                        setSortDir('desc');
                        setFiltersOpen(false);
                      }}
                    >
                      Newest first
                    </button>
                    <button
                      type="button"
                      className={`slog-filters-option${sortDir === 'asc' ? ' slog-filters-option--on' : ''}`}
                      onClick={() => {
                        setSortDir('asc');
                        setFiltersOpen(false);
                      }}
                    >
                      Oldest first
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="slog-refresh-btn"
                onClick={() => logsQuery.refetch()}
                disabled={logsQuery.isFetching}
                aria-label="Refresh logs"
                title="Refresh"
              >
                <RefreshCw
                  size={18}
                  className={logsQuery.isFetching ? 'slog-spin-icon' : ''}
                />
              </button>
            </div>
          </header>

          <div className="slog-table-wrap">
            <table className="slog-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="slog-th-sort"
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                    >
                      Time
                      <ArrowUpDown size={14} aria-hidden />
                    </button>
                  </th>
                  <th>Level</th>
                  <th>Event</th>
                  <th>Message</th>
                  <th>IP Address</th>
                  <th>Organization</th>
                  <th className="slog-th-actions" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="slog-empty-cell">
                      No log entries match your filters.
                    </td>
                  </tr>
                ) : (
                  pageItems.map((log) => (
                    <tr key={log.id}>
                      <td className="slog-td-time">{formatTableTime(log.ts)}</td>
                      <td>
                        <LevelBadge level={log.level} />
                      </td>
                      <td>
                        <span className="slog-event-link">{log.event}</span>
                      </td>
                      <td className="slog-td-message">
                        <span className="slog-msg-title">{log.title}</span>
                        {log.detail && log.detail !== '—' && (
                          <span className="slog-msg-detail">{log.detail}</span>
                        )}
                      </td>
                      <td className="slog-td-muted">
                        {log.ipAddress || '—'}
                      </td>
                      <td className="slog-td-muted">
                        {log.organizationName || '—'}
                      </td>
                      <td className="slog-td-actions">
                        <RowMenu log={log} onCopy={copyLine} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <footer className="slog-table-foot">
              <p className="slog-foot-summary">
                Showing {showingFrom} to {showingTo} of {filtered.length} entries
              </p>
              <div className="slog-pagination">
                <button
                  type="button"
                  className="slog-page-btn"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="slog-page-num">{safePage}</span>
                <button
                  type="button"
                  className="slog-page-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <label className="slog-rows-per-page">
                Rows per page
                <select
                  className="slog-rows-select"
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Number(e.target.value))}
                >
                  {ROWS_PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </footer>
          )}
        </section>

        <footer className="slog-status-foot">
          <p className="slog-status-line">
            <span className="slog-status-dot" aria-hidden />
            Last updated: {formatStatusTime(generatedAt)}
            {logsQuery.isFetching ? ' · Refreshing…' : ''}
          </p>
          <p className="slog-status-sub">Auto-refresh is enabled</p>
        </footer>
      </div>
    </div>
  );
}
