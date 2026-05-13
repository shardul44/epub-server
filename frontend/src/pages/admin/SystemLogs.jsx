import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { adminService } from '../../services/adminService';
import './SystemLogs.css';

const LEVELS = [
  { value: 'all', label: 'All levels' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARN', label: 'Warn' },
  { value: 'ERROR', label: 'Error' },
];

function formatBracketTs(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function levelKey(level) {
  const u = String(level || 'INFO').toUpperCase();
  if (u === 'WARN') return 'warn';
  if (u === 'ERROR') return 'error';
  return 'info';
}

function buildPlainLine(log) {
  return `[${formatBracketTs(log.ts)}] ${log.level} ${log.category} - ${log.message}`;
}

export default function SystemLogs() {
  const [level, setLevel] = useState('all');
  const viewerRef = useRef(null);

  const queryParams = useMemo(() => {
    const p = { limit: 500 };
    if (level && level !== 'all') p.level = level;
    return p;
  }, [level]);

  const logsQuery = useQuery({
    queryKey: ['admin', 'system-logs', queryParams],
    queryFn: () => adminService.getSystemLogs(queryParams),
    staleTime: 0,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 10000),
  });

  const logs = logsQuery.data?.logs ?? [];

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || logs.length === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, level]);

  const downloadTxt = useCallback(() => {
    const body = logs.map(buildPlainLine).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `system-logs-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

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
        <header className="slog-head">
          <h1 className="slog-title">System Logs</h1>
          <p className="slog-sub">Real-time platform event logs for debugging and auditing.</p>
        </header>

        {logsQuery.isError ? (
          <div className="slog-err">{logsQuery.error?.message || 'Failed to load system logs.'}</div>
        ) : null}

        <section className="slog-card" aria-label="Live log stream">
          <header className="slog-card-header">
            <div className="slog-card-header-text">
              <h2 className="slog-card-title">Live Log Stream</h2>
              <p className="slog-card-caption">Real-time event feed</p>
            </div>
            <div className="slog-card-tools">
              <label htmlFor="slog-level-filter" className="visually-hidden">
                Filter by level
              </label>
              <select
                id="slog-level-filter"
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
              <button
                type="button"
                className="slog-btn-download"
                onClick={downloadTxt}
                disabled={logs.length === 0}
              >
                <Download size={16} strokeWidth={2} aria-hidden />
                Download
              </button>
            </div>
          </header>
          <div className="slog-card-body">
            <div ref={viewerRef} className="slog-viewer" role="log" aria-live="polite" aria-relevant="additions">
              {logs.length === 0 ? (
                <p className="slog-empty">No log entries match this filter yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="slog-line">
                    <span className="slog-ts">[{formatBracketTs(log.ts)}]</span>{' '}
                    <span className={`slog-lvl slog-lvl--${levelKey(log.level)}`}>{log.level}</span>{' '}
                    <span className="slog-cat">{log.category}</span>
                    <span className="slog-dash"> - </span>
                    <span className="slog-msg">{log.message}</span>
                  </div>
                ))
              )}
            </div>
            {logsQuery.data?.generatedAt ? (
              <p className="slog-meta">
                Last updated {new Date(logsQuery.data.generatedAt).toLocaleString()}
                {logsQuery.isFetching ? ' · Refreshing…' : ''}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
