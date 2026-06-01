import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Briefcase,
  Package,
  Activity,
  UserCog,
  Inbox,
  Users,
  CloudUpload,
  RefreshCw,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { useAppBootstrap } from '../../hooks/queries/useAppBootstrap';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { adminService } from '../../services/adminService';
import './AdminDashboard.css';

const DONUT_COLORS = ['#2563eb', '#14b8a6', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfMondayWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isPdfUpload(action) {
  if (!action || typeof action !== 'string') return false;
  const a = action.toLowerCase();
  return a === 'pdf:upload' || (a.includes('pdf') && a.includes('upload'));
}

function countPdfUploadsOnLocalDay(activities, dayStart) {
  const end = new Date(dayStart);
  end.setHours(23, 59, 59, 999);
  return activities.filter((row) => {
    if (!isPdfUpload(row.action)) return false;
    const t = new Date(row.createdAt);
    return !Number.isNaN(t.getTime()) && t >= dayStart && t <= end;
  }).length;
}

function activityFileName(row) {
  let m = row.metadata;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      m = null;
    }
  }
  if (m && typeof m === 'object') {
    if (m.filename) return String(m.filename);
    if (m.originalFilename) return String(m.originalFilename);
    if (m.fileName) return String(m.fileName);
  }
  const s = row.summary || '';
  const m1 = s.match(/Uploaded\s+(.+)$/i);
  if (m1) return m1[1].trim().slice(0, 120);
  const m2 = s.match(/["']([^"']+\.pdf)["']/i);
  if (m2) return m2[1];
  return '—';
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function countJobsBetween(jobs, start, end) {
  return jobs.filter((j) => {
    const t = new Date(j.createdAt || j.updatedAt || 0);
    return !Number.isNaN(t.getTime()) && t >= start && t < end;
  }).length;
}

function countPdfActsBetween(acts, start, end) {
  return acts.filter((a) => {
    if (!isPdfUpload(a.action)) return false;
    const t = new Date(a.createdAt);
    return !Number.isNaN(t.getTime()) && t >= start && t < end;
  }).length;
}

export default function AdminDashboard() {
  const [volumeRange, setVolumeRange] = useState('this'); // 'this' | 'last'
  const { activities, isLoading: bootLoading, error: bootErr } = useAppBootstrap();
  const { allJobs, isLoading: jobsLoading, error: jobsErr } = useConversionsQuery({ enabled: true });

  const {
    data: organizations = [],
    isLoading: orgsLoading,
    error: orgErrObj,
  } = useQuery({
    queryKey: ['admin', 'organizations'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const { data: pendingPlanRequests = 0 } = useQuery({
    queryKey: ['admin', 'plan-requests', 'pending-count'],
    queryFn: () => adminService.getPlanRequestsPendingCount(),
    staleTime: 30 * 1000,
    retry: false,
  });

  const orgUsersQueries = useQueries({
    queries: (organizations ?? []).map((org) => ({
      queryKey: ['admin', 'org-users', org.id],
      queryFn: () => adminService.getOrgUsers(org.id),
      enabled: (organizations?.length ?? 0) > 0,
      staleTime: 2 * 60 * 1000,
    })),
  });

  const usersLoading = orgUsersQueries.some((q) => q.isLoading);
  const totalUsers = orgUsersQueries.reduce(
    (sum, q) => sum + (Array.isArray(q.data) ? q.data.length : 0),
    0,
  );

  const orgCount = organizations.length;
  const totalPagesUsed = useMemo(
    () =>
      organizations.reduce((sum, o) => sum + (Number(o.pdfPagesUsed) || 0), 0),
    [organizations],
  );

  const newOrgsThisMonth = useMemo(() => {
    const som = startOfMonth(new Date());
    return organizations.filter((o) => {
      if (!o.createdAt) return false;
      const c = new Date(o.createdAt);
      return !Number.isNaN(c.getTime()) && c >= som;
    }).length;
  }, [organizations]);

  const pdfWeekTrend = useMemo(() => {
    const now = new Date();
    const thisStart = startOfLocalDay(now);
    thisStart.setDate(thisStart.getDate() - 6);
    const prevStart = new Date(thisStart);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(thisStart);
    const a = activities ?? [];
    const c7 = countPdfActsBetween(a, thisStart, new Date(now.getTime() + 86400000));
    const p7 = countPdfActsBetween(a, prevStart, prevEnd);
    if (p7 === 0 && c7 === 0) return { text: 'No uploads in sample', tone: 'muted' };
    if (p7 === 0) return { text: `+${c7} this week`, tone: 'up' };
    const pct = Math.round(((c7 - p7) / p7) * 100);
    if (pct > 0) return { text: `+${pct}% vs prior week`, tone: 'up' };
    if (pct < 0) return { text: `${pct}% vs prior week`, tone: 'down' };
    return { text: 'Flat vs prior week', tone: 'muted' };
  }, [activities]);

  const convTodayTrend = useMemo(() => {
    const now = new Date();
    const t0 = startOfLocalDay(now);
    const t1 = new Date(t0);
    t1.setDate(t1.getDate() + 1);
    const y0 = new Date(t0);
    y0.setDate(y0.getDate() - 1);
    const todayN = countJobsBetween(allJobs, t0, t1);
    const yN = countJobsBetween(allJobs, y0, t0);
    if (yN === 0 && todayN === 0) return { text: 'No jobs today', tone: 'muted' };
    if (yN === 0) return { text: `+${todayN} today`, tone: 'up' };
    const pct = Math.round(((todayN - yN) / yN) * 100);
    if (pct > 0) return { text: `+${pct}% vs yesterday`, tone: 'up' };
    if (pct < 0) return { text: `${pct}% vs yesterday`, tone: 'down' };
    return { text: 'Same as yesterday', tone: 'muted' };
  }, [allJobs]);

  const todayJobCount = useMemo(() => {
    const now = new Date();
    const t0 = startOfLocalDay(now);
    const t1 = new Date(t0);
    t1.setDate(t1.getDate() + 1);
    return countJobsBetween(allJobs, t0, t1);
  }, [allJobs]);

  const volumeChart = useMemo(() => {
    const monThis = startOfMondayWeek(new Date());
    const monLast = addDays(monThis, -7);
    const base = volumeRange === 'this' ? monThis : monLast;
    return DAYS.map((label, i) => {
      const day = addDays(base, i);
      const uploads = countPdfUploadsOnLocalDay(activities ?? [], day);
      const jobs = countJobsBetween(
        allJobs,
        day,
        addDays(day, 1),
      );
      const volume = uploads > 0 ? uploads : jobs;
      return { day: label, uploads, jobs, volume };
    });
  }, [activities, allJobs, volumeRange]);

  const planDistribution = useMemo(() => {
    const map = new Map();
    organizations.forEach((o) => {
      const key = o.planName && String(o.planName).trim() ? o.planName : 'Unassigned';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    const rows = [...map.entries()].map(([name, value]) => ({ name, value }));
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    return rows.map((r) => ({ ...r, pct: Math.round((r.value / total) * 1000) / 10 }));
  }, [organizations]);

  const recentRows = useMemo(() => {
    const list = [...(activities ?? [])].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
    return list.slice(0, 8);
  }, [activities]);

  const loadError = [bootErr, orgErrObj?.message, jobsErr].filter(Boolean).join(' · ');
  const loading = bootLoading || orgsLoading || jobsLoading || usersLoading;

  return (
    <div className="adm-root">
      <header className="adm-head">
        <h1 className="adm-title">Dashboard</h1>
        <p className="adm-sub">
          Manage organizations, plans and subscriptions. Monitor platform health and conversion
          activity.
        </p>
      </header>

      {loadError && <div className="adm-err">{String(loadError)}</div>}

      <div className="adm-grid4">
        <Link to="/admin/organizations" className="adm-nav-card">
          <span className="adm-nav-icon" aria-hidden>
            <Briefcase size={22} />
          </span>
          Organizations &amp; clients
        </Link>
        <Link to="/admin/plan-requests" className="adm-nav-card">
          <span className="adm-nav-icon" aria-hidden>
            <Inbox size={22} />
          </span>
          Plan requests
          {pendingPlanRequests > 0 && (
            <span className="adm-nav-badge">{pendingPlanRequests > 99 ? '99+' : pendingPlanRequests}</span>
          )}
        </Link>
        <Link to="/admin/activity" className="adm-nav-card">
          <span className="adm-nav-icon" aria-hidden>
            <Activity size={22} />
          </span>
          View activity
        </Link>
        <Link to="/admin/users" className="adm-nav-card">
          <span className="adm-nav-icon" aria-hidden>
            <UserCog size={22} />
          </span>
          Manage users
        </Link>
      </div>

      <div className="adm-grid4">
        <div className="adm-stat">
          <div className="adm-stat-icon adm-stat-icon--blue" aria-hidden>
            <Briefcase size={22} strokeWidth={2} />
          </div>
          <div className="adm-stat-body">
            <span className="adm-stat-label">Organizations</span>
            <div className="adm-stat-value">{loading ? '—' : orgCount}</div>
            <div
              className={`adm-stat-trend ${
                newOrgsThisMonth > 0 ? 'adm-stat-trend--up' : 'adm-stat-trend--muted'
              }`}
            >
              {newOrgsThisMonth > 0 ? (
                <>
                  <TrendingUp size={14} strokeWidth={2.5} aria-hidden />+{newOrgsThisMonth} this month
                </>
              ) : (
                'No new orgs this month'
              )}
            </div>
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-icon adm-stat-icon--teal" aria-hidden>
            <Users size={22} strokeWidth={2} />
          </div>
          <div className="adm-stat-body">
            <span className="adm-stat-label">Total users</span>
            <div className="adm-stat-value">{loading ? '—' : totalUsers.toLocaleString()}</div>
            <div className="adm-stat-trend adm-stat-trend--muted">Across all organizations</div>
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-icon adm-stat-icon--amber" aria-hidden>
            <CloudUpload size={22} strokeWidth={2} />
          </div>
          <div className="adm-stat-body">
            <span className="adm-stat-label">PDF pages used</span>
            <div className="adm-stat-value">
              {loading ? '—' : totalPagesUsed.toLocaleString()}
            </div>
            <div className={`adm-stat-trend adm-stat-trend--${pdfWeekTrend.tone}`}>
              {pdfWeekTrend.tone === 'up' && <TrendingUp size={14} strokeWidth={2.5} aria-hidden />}
              {pdfWeekTrend.tone === 'down' && <TrendingDown size={14} strokeWidth={2.5} aria-hidden />}
              {pdfWeekTrend.text}
            </div>
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-icon adm-stat-icon--violet" aria-hidden>
            <RefreshCw size={22} strokeWidth={2} />
          </div>
          <div className="adm-stat-body">
            <span className="adm-stat-label">Conversions today</span>
            <div className="adm-stat-value">{loading ? '—' : todayJobCount}</div>
            <div className={`adm-stat-trend adm-stat-trend--${convTodayTrend.tone}`}>
              {convTodayTrend.tone === 'up' && <TrendingUp size={14} strokeWidth={2.5} aria-hidden />}
              {convTodayTrend.tone === 'down' && <TrendingDown size={14} strokeWidth={2.5} aria-hidden />}
              {convTodayTrend.text}
            </div>
          </div>
        </div>
      </div>

      <div className="adm-row2">
        <div className="adm-panel adm-panel--volume">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">PDF Upload Volume</h2>
              <p className="adm-panel-sub">Last 7 days — all organizations</p>
            </div>
            <div className="adm-seg" role="group" aria-label="Week range">
              <button
                type="button"
                className={volumeRange === 'this' ? 'adm-seg--on' : ''}
                onClick={() => setVolumeRange('this')}
              >
                This week
              </button>
              <button
                type="button"
                className={volumeRange === 'last' ? 'adm-seg--on' : ''}
                onClick={() => setVolumeRange('last')}
              >
                Last week
              </button>
            </div>
          </div>
          <div className="adm-chart adm-chart--bars">
            {volumeChart.every((d) => d.uploads === 0 && d.jobs === 0) ? (
              <div className="adm-empty">No data for this range yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={volumeChart}
                  margin={{ top: 12, right: 8, left: 0, bottom: 2 }}
                  barGap={2}
                  barCategoryGap="10%"
                >
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#9ca3af', fontWeight: 500 }}
                    dy={6}
                  />
                  <YAxis hide domain={[0, 'dataMax + 3']} allowDataOverflow={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }}
                    formatter={(v, name) => [v, name === 'uploads' ? 'PDF uploads' : 'Conversions']}
                    labelFormatter={(l) => l}
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="jobs"
                    name="jobs"
                    fill="#dbeafe"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={64}
                  />
                  <Bar
                    dataKey="uploads"
                    name="uploads"
                    fill="#3b82f6"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={64}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">Plan distribution</h2>
              <p className="adm-panel-sub">Active subscriptions</p>
            </div>
          </div>
          {planDistribution.length === 0 ? (
            <div className="adm-empty">No organizations yet.</div>
          ) : (
            <>
              <div className="adm-donut-wrap">
                <div className="adm-chart adm-chart--donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={planDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius="58%"
                        outerRadius="82%"
                        paddingAngle={2}
                      >
                        {planDistribution.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v, _n, p) => [
                          `${v} orgs (${p?.payload?.pct ?? 0}%)`,
                          p?.payload?.name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="adm-donut-center" aria-hidden>
                    <div className="adm-donut-num">{planDistribution.length}</div>
                    <div className="adm-donut-label">Plans</div>
                  </div>
                </div>
              </div>
              <div className="adm-legend">
                {planDistribution.map((row, i) => (
                  <div key={row.name} className="adm-legend-row">
                    <span className="adm-legend-left">
                      <span
                        className="adm-dot"
                        style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                      <span className="adm-legend-name">{row.name}</span>
                    </span>
                    <span className="adm-legend-pct">{row.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="adm-row2">
        <div className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">Recent activity</h2>
              <p className="adm-panel-sub">Latest events across all organizations</p>
            </div>
            <Link to="/admin/activity" className="adm-link-btn">
              View all
            </Link>
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>File</th>
                  <th>User</th>
                  <th>Org</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((r) => {
                  const t = r.createdAt ? new Date(r.createdAt) : null;
                  const clock =
                    t && !Number.isNaN(t.getTime())
                      ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                      : '—';
                  const day =
                    t && !Number.isNaN(t.getTime())
                      ? t.toLocaleDateString([], { month: 'short', day: 'numeric' })
                      : '';
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{clock}</div>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{day}</div>
                      </td>
                      <td>{activityFileName(r)}</td>
                      <td>{r.actorEmail || r.actorName || r.userId || '—'}</td>
                      <td>{r.organizationName || r.organizationId || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!recentRows.length && <div className="adm-empty">No activity rows yet.</div>}
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">Quota usage</h2>
              <p className="adm-panel-sub">PDF page consumption by organization</p>
            </div>
          </div>
          <div className="adm-quota-list">
            {organizations.length === 0 && !orgsLoading && (
              <div className="adm-empty">No organizations.</div>
            )}
            {organizations.map((org) => {
              const used = Number(org.pdfPagesUsed) || 0;
              const cap = org.pdfPageQuota != null ? Number(org.pdfPageQuota) : null;
              const pct =
                cap != null && cap > 0 ? Math.min(100, (used / cap) * 100) : used > 0 ? 100 : 0;
              const meta =
                cap == null || cap <= 0
                  ? `${used.toLocaleString()} pages used · Unlimited quota`
                  : `${used.toLocaleString()} of ${cap.toLocaleString()} pages used`;
              return (
                <div key={org.id}>
                  <div className="adm-quota-org">
                    <span>{org.name}</span>
                    {org.active !== false && <span className="adm-pill-active">Active</span>}
                  </div>
                  <div className="adm-bar-bg">
                    <div
                      className={`adm-bar-fill${cap == null || cap <= 0 ? ' adm-bar-fill--open' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="adm-quota-meta">{meta}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
