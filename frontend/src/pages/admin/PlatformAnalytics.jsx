import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { FileText, CheckCircle2, Clock, BarChart3 } from 'lucide-react';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { adminService } from '../../services/adminService';
import './PlatformAnalytics.css';

const MONTH_BUCKET_COUNT = 10;

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildRollingMonthBuckets(count) {
  const now = new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: monthKeyFromDate(d),
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      pages: 0,
    });
  }
  return out;
}

function jobTimestamp(job) {
  const t = new Date(job.updatedAt || job.createdAt || 0);
  return Number.isNaN(t.getTime()) ? null : t;
}

function inRange(iso, start, end) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return t >= start && t < end;
}

function pagesFromCompletedJobs(jobs, start, end) {
  return jobs
    .filter(
      (j) =>
        j.status === 'COMPLETED' &&
        jobTimestamp(j) != null &&
        inRange(j.updatedAt || j.createdAt, start, end),
    )
    .reduce((sum, j) => sum + (Number(j.totalPages) > 0 ? Number(j.totalPages) : 1), 0);
}

function classifyFailure(job) {
  const raw = String(job.error || job.errorMessage || '').toLowerCase();
  if (/timeout|timed out|etimedout|deadline|econnaborted|socket|network/.test(raw)) return 'timeout';
  if (/quota|limit exceeded|exceeded quota|402|403|forbidden/.test(raw)) return 'quota';
  if (/parse|syntax|invalid|malformed|xml|xhtml|unexpected|cannot read/.test(raw)) return 'parse';
  return 'other';
}

function startOfLocalMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export default function PlatformAnalytics() {
  const { allJobs, isLoading: jobsLoading, error: jobsErr } = useConversionsQuery({ enabled: true });
  const {
    data: organizations = [],
    isLoading: orgsLoading,
    error: orgErr,
  } = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const loading = jobsLoading || orgsLoading;
  const loadErr = [jobsErr, orgErr]
    .map((e) => (e == null ? '' : typeof e === 'string' ? e : e.message || String(e)))
    .filter(Boolean)
    .join(' · ');

  const totalPagesOrg = useMemo(
    () => organizations.reduce((s, o) => s + (Number(o.pdfPagesUsed) || 0), 0),
    [organizations],
  );

  const activeOrgs = useMemo(
    () => organizations.filter((o) => o.active !== false).length,
    [organizations],
  );

  const activeOrgPct = useMemo(() => {
    if (!organizations.length) return null;
    return Math.round((activeOrgs / organizations.length) * 1000) / 10;
  }, [organizations.length, activeOrgs]);

  const successStats = useMemo(() => {
    const completed = allJobs.filter((j) => j.status === 'COMPLETED').length;
    const failed = allJobs.filter((j) => j.status === 'FAILED').length;
    const denom = completed + failed;
    const rate = denom > 0 ? Math.round((completed / denom) * 10000) / 100 : null;
    return { completed, failed, rate, denom };
  }, [allJobs]);

  const successRatePrevMonth = useMemo(() => {
    const now = new Date();
    const thisStart = startOfLocalMonth(now);
    const prevStart = addMonths(thisStart, -1);
    const subset = allJobs.filter((j) => {
      const t = jobTimestamp(j);
      if (!t || t >= thisStart) return false;
      return t >= prevStart;
    });
    const c = subset.filter((j) => j.status === 'COMPLETED').length;
    const f = subset.filter((j) => j.status === 'FAILED').length;
    const d = c + f;
    return d > 0 ? Math.round((c / d) * 10000) / 100 : null;
  }, [allJobs]);

  const successDeltaVsLastMo = useMemo(() => {
    if (successStats.rate == null || successRatePrevMonth == null) return null;
    return Math.round((successStats.rate - successRatePrevMonth) * 10) / 10;
  }, [successStats.rate, successRatePrevMonth]);

  const avgDurationSec = useMemo(() => {
    const completed = allJobs.filter((j) => j.status === 'COMPLETED');
    const durations = completed
      .map((j) => {
        const a = new Date(j.createdAt || 0);
        const b = new Date(j.updatedAt || j.createdAt || 0);
        if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return null;
        return (b - a) / 1000;
      })
      .filter((x) => x != null && x > 0 && x < 86400 * 7);
    if (!durations.length) return null;
    const mean = durations.reduce((s, x) => s + x, 0) / durations.length;
    return Math.round(mean * 10) / 10;
  }, [allJobs]);

  const avgDurationPrev = useMemo(() => {
    const now = new Date();
    const thisStart = startOfLocalMonth(now);
    const prevStart = addMonths(thisStart, -1);
    const completed = allJobs.filter((j) => {
      if (j.status !== 'COMPLETED') return false;
      const t = jobTimestamp(j);
      return t && t >= prevStart && t < thisStart;
    });
    const durations = completed
      .map((j) => {
        const a = new Date(j.createdAt || 0);
        const b = new Date(j.updatedAt || j.createdAt || 0);
        if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return null;
        return (b - a) / 1000;
      })
      .filter((x) => x != null && x > 0 && x < 86400 * 7);
    if (!durations.length) return null;
    return Math.round((durations.reduce((s, x) => s + x, 0) / durations.length) * 10) / 10;
  }, [allJobs]);

  const avgDurationTrend = useMemo(() => {
    if (avgDurationSec == null || avgDurationPrev == null) return null;
    const diff = Math.round((avgDurationPrev - avgDurationSec) * 10) / 10;
    return diff;
  }, [avgDurationSec, avgDurationPrev]);

  const weekPagesTrend = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const thisStart = new Date(end);
    thisStart.setDate(thisStart.getDate() - 7);
    const prevEnd = new Date(thisStart);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 7);
    const thisP = pagesFromCompletedJobs(allJobs, thisStart, end);
    const lastP = pagesFromCompletedJobs(allJobs, prevStart, prevEnd);
    if (lastP === 0 && thisP === 0) return { text: 'No completed volume this week', tone: 'muted' };
    if (lastP === 0) return { text: `+${thisP} pages this week`, tone: 'up' };
    const pct = Math.round(((thisP - lastP) / lastP) * 1000) / 10;
    if (pct > 0) return { text: `+${pct}% this week`, tone: 'up' };
    if (pct < 0) return { text: `${pct}% this week`, tone: 'down' };
    return { text: 'Flat vs last week', tone: 'muted' };
  }, [allJobs]);

  const monthlyChart = useMemo(() => {
    const buckets = buildRollingMonthBuckets(MONTH_BUCKET_COUNT);
    const map = new Map(buckets.map((b) => [b.key, { ...b }]));
    allJobs.forEach((j) => {
      if (j.status !== 'COMPLETED') return;
      const t = jobTimestamp(j);
      if (!t) return;
      const k = monthKeyFromDate(t);
      if (!map.has(k)) return;
      const row = map.get(k);
      row.pages += Number(j.totalPages) > 0 ? Number(j.totalPages) : 1;
    });
    return buckets.map((b) => map.get(b.key));
  }, [allJobs]);

  const errorBreakdown = useMemo(() => {
    const start = startOfLocalMonth(new Date());
    const failed = allJobs.filter((j) => {
      if (j.status !== 'FAILED') return false;
      const t = jobTimestamp(j);
      return t && t >= start;
    });
    const cat = { timeout: 0, parse: 0, quota: 0, other: 0 };
    failed.forEach((j) => {
      cat[classifyFailure(j)] += 1;
    });
    const total = failed.length;
    const rows = [
      { key: 'timeout', label: 'Timeout errors', count: cat.timeout, color: '#f97316' },
      { key: 'parse', label: 'Parse errors', count: cat.parse, color: '#ef4444' },
      { key: 'quota', label: 'Quota exceeded', count: cat.quota, color: '#94a3b8' },
      { key: 'other', label: 'Other', count: cat.other, color: '#64748b' },
    ];
    if (total === 0) {
      return rows.map((r) => ({ ...r, pct: 0, width: 0 }));
    }
    return rows.map((r) => ({
      ...r,
      pct: Math.round((r.count / total) * 1000) / 10,
      width: (r.count / total) * 100,
    }));
  }, [allJobs]);

  const chips = useMemo(() => {
    const by = (st) => allJobs.filter((j) => j.status === st).length;
    return [
      { label: 'Total jobs', value: allJobs.length },
      { label: 'In progress', value: by('IN_PROGRESS') + by('PENDING') + by('PROCESSING') },
      { label: 'Completed', value: by('COMPLETED') },
      { label: 'Failed', value: by('FAILED') },
      { label: 'Cancelled', value: by('CANCELLED') },
      { label: 'Organizations', value: organizations.length },
      { label: 'Plans in use', value: new Set(organizations.map((o) => o.planName).filter(Boolean)).size },
    ];
  }, [allJobs, organizations]);

  if (loading) {
    return (
      <div className="pan-root">
        <div className="pan-inner pan-loading">
          <div className="pan-spinner" aria-hidden />
          Loading analytics…
        </div>
      </div>
    );
  }

  return (
    <div className="pan-root">
      <div className="pan-inner">
        <header className="pan-head">
          <h1 className="pan-title">Analytics</h1>
          <p className="pan-sub">
            Platform-wide usage trends, conversion metrics and growth insights.
          </p>
        </header>

        {!!loadErr && <div className="pan-err-banner">{loadErr}</div>}

        <section className="pan-kpis" aria-label="Key metrics">
          <div className="pan-kpi">
            <div className="pan-kpi-icon pan-kpi-icon--blue" aria-hidden>
              <FileText size={20} />
            </div>
            <div className="pan-kpi-body">
              <div className="pan-kpi-label">Pages processed</div>
              <div className="pan-kpi-value">{totalPagesOrg.toLocaleString()}</div>
              <div className={`pan-kpi-trend pan-kpi-trend--${weekPagesTrend.tone}`}>
                {weekPagesTrend.tone === 'up' && '↗ '}
                {weekPagesTrend.tone === 'down' && '↘ '}
                {weekPagesTrend.text}
              </div>
            </div>
          </div>

          <div className="pan-kpi">
            <div className="pan-kpi-icon pan-kpi-icon--green" aria-hidden>
              <CheckCircle2 size={20} />
            </div>
            <div className="pan-kpi-body">
              <div className="pan-kpi-label">Success rate</div>
              <div className="pan-kpi-value">
                {successStats.rate != null ? `${successStats.rate}%` : '—'}
              </div>
              <div
                className={`pan-kpi-trend ${
                  successDeltaVsLastMo == null
                    ? 'pan-kpi-trend--muted'
                    : successDeltaVsLastMo >= 0
                      ? 'pan-kpi-trend--up'
                      : 'pan-kpi-trend--down'
                }`}
              >
                {successDeltaVsLastMo == null
                  ? 'Need prior month data'
                  : `${successDeltaVsLastMo >= 0 ? '↗ +' : '↘ '}${successDeltaVsLastMo}% vs last mo`}
              </div>
            </div>
          </div>

          <div className="pan-kpi">
            <div className="pan-kpi-icon pan-kpi-icon--amber" aria-hidden>
              <Clock size={20} />
            </div>
            <div className="pan-kpi-body">
              <div className="pan-kpi-label">Avg conversion</div>
              <div className="pan-kpi-value">{avgDurationSec != null ? `${avgDurationSec}s` : '—'}</div>
              <div
                className={`pan-kpi-trend ${
                  avgDurationTrend == null
                    ? 'pan-kpi-trend--muted'
                    : avgDurationTrend > 0
                      ? 'pan-kpi-trend--up'
                      : avgDurationTrend < 0
                        ? 'pan-kpi-trend--down'
                        : 'pan-kpi-trend--muted'
                }`}
              >
                {avgDurationTrend == null
                  ? 'Not enough history'
                  : avgDurationTrend > 0
                    ? `${avgDurationTrend}s faster vs last mo`
                    : avgDurationTrend < 0
                      ? `${Math.abs(avgDurationTrend)}s slower vs last mo`
                      : 'Same vs last mo'}
              </div>
            </div>
          </div>

          <div className="pan-kpi">
            <div className="pan-kpi-icon pan-kpi-icon--teal" aria-hidden>
              <BarChart3 size={20} />
            </div>
            <div className="pan-kpi-body">
              <div className="pan-kpi-label">Active orgs</div>
              <div className="pan-kpi-value">{activeOrgs}</div>
              <div
                className={`pan-kpi-trend ${
                  activeOrgPct == null ? 'pan-kpi-trend--muted' : 'pan-kpi-trend--up'
                }`}
              >
                {activeOrgPct != null ? `${activeOrgPct}% active` : '—'}
              </div>
            </div>
          </div>
        </section>

        <div className="pan-row">
          <div className="pan-card">
            <h2>Monthly conversion trend</h2>
            <p className="pan-card-desc">PDF pages attributed to completed jobs per month</p>
            <div className="pan-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="panAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={(v) => [`${Number(v).toLocaleString()} pages`, 'Volume']}
                    labelFormatter={(l) => l}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="pages"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#panAreaGrad)"
                    dot={{ r: 3, fill: '#2563eb' }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pan-card">
            <h2>Error breakdown</h2>
            <p className="pan-card-desc">Failed conversions this calendar month (by error text)</p>
            <div className="pan-errors">
              {errorBreakdown.map((row) => (
                <div key={row.key} className="pan-err-row">
                  <span className="pan-err-label">{row.label}</span>
                  <span className="pan-err-count">{row.count}</span>
                  <span className="pan-err-pct">{row.pct}%</span>
                  <div className="pan-err-bar">
                    <div
                      className="pan-err-fill"
                      style={{ width: `${row.width}%`, background: row.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="pan-summary" aria-label="Full platform snapshot">
          <h3>Platform snapshot</h3>
          <div className="pan-chips">
            {chips.map((c) => (
              <span key={c.label} className="pan-chip">
                {c.label}: <strong>{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</strong>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
