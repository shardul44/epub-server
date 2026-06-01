import { useCallback, useMemo, useState } from 'react';
import { CloudUpload, CheckCircle2, AlertTriangle, Download, Check } from 'lucide-react';
import { useAppBootstrap } from '../../hooks/queries/useAppBootstrap';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import './ActivityPage.css';

const TABLE_PAGE = 7;

function escapeCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isPdfUpload(action) {
  if (!action || typeof action !== 'string') return false;
  const a = action.toLowerCase();
  return a === 'pdf:upload' || (a.includes('pdf') && a.includes('upload'));
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameLocalDay(iso, dayStart) {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const s = startOfLocalDay(t);
  return s.getTime() === dayStart.getTime();
}

function formatWhenShort(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const clock = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${md} ${clock}`;
}

function inferStatus(row) {
  const a = (row.action || '').toLowerCase();
  if (a.includes('fail') || a.includes('error') || a.includes('denied')) {
    return { key: 'bad', label: 'Failed' };
  }
  if (a.includes('cancel')) {
    return { key: 'muted', label: 'Cancelled' };
  }
  return { key: 'ok', label: 'Success' };
}

export default function ActivityPage() {
  const { activities, isLoading: bootLoading, error: bootErr } = useAppBootstrap();
  const { allJobs, isLoading: jobsLoading } = useConversionsQuery({ enabled: true });

  const [orgFilter, setOrgFilter] = useState('');
  const [visibleRows, setVisibleRows] = useState(TABLE_PAGE);

  const rows = activities ?? [];
  const loading = bootLoading || jobsLoading;
  const error = bootErr ? String(bootErr) : '';

  const orgOptions = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const n = r.organizationName || (r.organizationId != null ? `Org #${r.organizationId}` : '');
      if (n) set.add(n);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const list = [...rows].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (!orgFilter) return list;
    return list.filter((r) => {
      const n = r.organizationName || (r.organizationId != null ? `Org #${r.organizationId}` : '');
      return n === orgFilter;
    });
  }, [rows, orgFilter]);

  const todayStart = useMemo(() => startOfLocalDay(), []);

  const uploadsToday = useMemo(
    () => rows.filter((r) => isPdfUpload(r.action) && isSameLocalDay(r.createdAt, todayStart)),
    [rows, todayStart],
  );

  const uploadsTodayHint = useMemo(() => {
    if (uploadsToday.length === 0) return { text: 'No uploads yet today', tone: 'muted' };
    const emails = uploadsToday.map((r) => r.actorEmail || r.actorName || '').filter(Boolean);
    if (emails.length === 0) return { text: 'Today’s uploads', tone: 'muted' };
    const uniq = [...new Set(emails)];
    if (uniq.length === 1) return { text: `All by ${uniq[0]}`, tone: 'green' };
    const counts = new Map();
    emails.forEach((e) => counts.set(e, (counts.get(e) ?? 0) + 1));
    let top = uniq[0];
    let topN = 0;
    counts.forEach((n, e) => {
      if (n > topN) {
        topN = n;
        top = e;
      }
    });
    if (topN === uploadsToday.length) return { text: `All by ${top}`, tone: 'green' };
    return { text: `${uniq.length} users today`, tone: 'muted' };
  }, [uploadsToday]);

  const conversionStats = useMemo(() => {
    const completed = allJobs.filter((j) => j.status === 'COMPLETED').length;
    const failed = allJobs.filter((j) => j.status === 'FAILED').length;
    const denom = completed + failed;
    const successPct = denom > 0 ? Math.round((completed / denom) * 1000) / 10 : null;
    const errorPct = denom > 0 ? Math.round((failed / denom) * 1000) / 10 : null;
    return { completed, failed, successPct, errorPct, denom };
  }, [allJobs]);

  const displayRows = useMemo(
    () => filteredRows.slice(0, visibleRows),
    [filteredRows, visibleRows],
  );

  const exportCsv = useCallback(() => {
    const header = ['#', 'When', 'Summary', 'User', 'Organization', 'Status']
      .map(escapeCsvCell)
      .join(',');
    const lines = filteredRows.map((row, i) =>
      [
        String(i + 1).padStart(3, '0'),
        row.createdAt ? new Date(row.createdAt).toLocaleString() : '',
        row.summary ?? '',
        row.actorEmail || row.actorName || row.userId || '',
        row.organizationName || row.organizationId || '',
        inferStatus(row).label,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
    const csvFixed = [header, ...lines].join('\r\n');
    const blob = new Blob([csvFixed], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  if (loading) {
    return (
      <div className="pap-root">
        <div className="pap-inner pap-loading">
          <div className="pap-spinner" aria-hidden />
          Loading activity…
        </div>
      </div>
    );
  }

  const canShowMore = visibleRows < filteredRows.length;

  return (
    <div className="pap-root">
      <div className="pap-inner">
        <header className="pap-head">
          <h1 className="pap-title">Activity</h1>
          <p className="pap-sub">All actions across tenants — platform administrator view.</p>
        </header>

        {error && <div className="pap-err">{error}</div>}

        <section className="pap-kpis" aria-label="Key metrics">
          <div className="pap-kpi">
            <div className="pap-kpi-icon pap-kpi-icon--blue" aria-hidden>
              <CloudUpload size={22} strokeWidth={2} />
            </div>
            <div className="pap-kpi-body">
              <div className="pap-kpi-label">Uploads today</div>
              <div className="pap-kpi-value">{uploadsToday.length}</div>
              <div
                className={`pap-kpi-hint ${
                  uploadsTodayHint.tone === 'green' ? 'pap-kpi-hint--green' : 'pap-kpi-hint--muted'
                }`}
              >
                {uploadsTodayHint.text}
              </div>
            </div>
          </div>

          <div className="pap-kpi">
            <div className="pap-kpi-icon pap-kpi-icon--green" aria-hidden>
              <CheckCircle2 size={22} strokeWidth={2} />
            </div>
            <div className="pap-kpi-body">
              <div className="pap-kpi-label">Successful conversions</div>
              <div className="pap-kpi-value">{conversionStats.completed}</div>
              <div
                className={`pap-kpi-hint ${
                  conversionStats.successPct != null ? 'pap-kpi-hint--green' : 'pap-kpi-hint--muted'
                }`}
              >
                {conversionStats.successPct != null
                  ? `↗ ${conversionStats.successPct}% success rate`
                  : 'No completed / failed jobs yet'}
              </div>
            </div>
          </div>

          <div className="pap-kpi">
            <div className="pap-kpi-icon pap-kpi-icon--amber" aria-hidden>
              <AlertTriangle size={22} strokeWidth={2} />
            </div>
            <div className="pap-kpi-body">
              <div className="pap-kpi-label">Failed / errors</div>
              <div className="pap-kpi-value">{conversionStats.failed}</div>
              <div
                className={`pap-kpi-hint ${
                  conversionStats.errorPct != null ? 'pap-kpi-hint--red' : 'pap-kpi-hint--muted'
                }`}
              >
                {conversionStats.errorPct != null
                  ? `${conversionStats.errorPct}% error rate`
                  : '—'}
              </div>
            </div>
          </div>
        </section>

        <div className="pap-panel">
          <div className="pap-panel-head">
            <div className="pap-panel-titles">
              <h2>Activity log — all organizations</h2>
              <p>
                {filteredRows.length === 0
                  ? 'No events in this view.'
                  : `Newest first · ${filteredRows.length} total · showing ${displayRows.length} row${
                      displayRows.length !== 1 ? 's' : ''
                    }`}
              </p>
            </div>
            <div className="pap-panel-actions">
              <button type="button" className="pap-btn-export" onClick={exportCsv}>
                <Download size={16} aria-hidden />
                Export CSV
              </button>
              <select
                className="pap-select"
                value={orgFilter}
                onChange={(e) => {
                  setOrgFilter(e.target.value);
                  setVisibleRows(TABLE_PAGE);
                }}
                aria-label="Filter by organization"
              >
                <option value="">All orgs</option>
                {orgOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pap-table-wrap">
            <table className="pap-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Summary</th>
                  <th>User</th>
                  <th>Organization</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, i) => {
                  const st = inferStatus(r);
                  return (
                    <tr key={r.id}>
                      <td className="pap-num">{String(i + 1).padStart(3, '0')}</td>
                      <td className="pap-when">{formatWhenShort(r.createdAt)}</td>
                      <td>{r.summary || '—'}</td>
                      <td>{r.actorEmail || r.actorName || r.userId || '—'}</td>
                      <td>{r.organizationName || r.organizationId || '—'}</td>
                      <td>
                        <span className={`pap-badge-status pap-badge-status--${st.key}`}>
                          {st.key === 'ok' && <Check size={14} aria-hidden />}
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filteredRows.length && (
              <div className="pap-empty">No activity rows match this filter.</div>
            )}
          </div>

          {!!filteredRows.length && (
            <footer className="pap-foot">
              <span style={{ color: '#6b7280', fontSize: '0.8125rem' }}>
                {filteredRows.length} event{filteredRows.length !== 1 ? 's' : ''} in view
              </span>
              {canShowMore && (
                <button
                  type="button"
                  className="pap-link-more"
                  onClick={() => setVisibleRows((n) => Math.min(n + TABLE_PAGE, filteredRows.length))}
                >
                  Show more
                </button>
              )}
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
