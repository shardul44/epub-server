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
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Briefcase,
  Package,
  Activity,
  UserCog,
  Building2,
  Users,
  FileText,
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
        <Link to="/admin/plans" className="adm-nav-card">
          <span className="adm-nav-icon" aria-hidden>
            <Package size={22} />
          </span>
          Plans &amp; features
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
          <div className="adm-stat-top">
            <span className="adm-stat-label">Organizations</span>
            <Building2 size={18} color="#9ca3af" aria-hidden />
          </div>
          <div className="adm-stat-value">{loading ? '—' : orgCount}</div>
          <div
            className={`adm-stat-trend ${
              newOrgsThisMonth > 0 ? 'adm-stat-trend--up' : 'adm-stat-trend--muted'
            }`}
          >
            {newOrgsThisMonth > 0 ? (
              <>
                <TrendingUp size={14} aria-hidden />+{newOrgsThisMonth} this month
              </>
            ) : (
              'No new orgs this month'
            )}
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-top">
            <span className="adm-stat-label">Total users</span>
            <Users size={18} color="#9ca3af" aria-hidden />
          </div>
          <div className="adm-stat-value">{loading ? '—' : totalUsers}</div>
          <div className="adm-stat-trend adm-stat-trend--muted">Across all organizations</div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-top">
            <span className="adm-stat-label">PDF pages used</span>
            <FileText size={18} color="#9ca3af" aria-hidden />
          </div>
          <div className="adm-stat-value">
            {loading ? '—' : totalPagesUsed.toLocaleString()}
          </div>
          <div className={`adm-stat-trend adm-stat-trend--${pdfWeekTrend.tone}`}>
            {pdfWeekTrend.tone === 'up' && <TrendingUp size={14} aria-hidden />}
            {pdfWeekTrend.tone === 'down' && <TrendingDown size={14} aria-hidden />}
            {pdfWeekTrend.text}
          </div>
        </div>

        <div className="adm-stat">
          <div className="adm-stat-top">
            <span className="adm-stat-label">Conversions today</span>
            <RefreshCw size={18} color="#9ca3af" aria-hidden />
          </div>
          <div className="adm-stat-value">{loading ? '—' : todayJobCount}</div>
          <div className={`adm-stat-trend adm-stat-trend--${convTodayTrend.tone}`}>
            {convTodayTrend.tone === 'up' && <TrendingUp size={14} aria-hidden />}
            {convTodayTrend.tone === 'down' && <TrendingDown size={14} aria-hidden />}
            {convTodayTrend.text}
          </div>
        </div>
      </div>

      <div className="adm-row2">
        <div className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">PDF upload &amp; job volume</h2>
              <p className="adm-panel-sub">
                Per day for the selected week — bars prefer PDF upload counts from the activity
                stream, then fall back to new jobs when no uploads are logged.
              </p>
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
          <div className="adm-chart">
            {volumeChart.every((d) => d.volume === 0) ? (
              <div className="adm-empty">No data for this range yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                  <Tooltip
                    formatter={(v, name) => [v, name === 'uploads' ? 'PDF uploads' : 'Jobs']}
                    labelFormatter={(l) => l}
                  />
                  <Legend />
                  <Bar dataKey="uploads" name="uploads" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="jobs" name="jobs" fill="#93c5fd" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="adm-panel">
          <div className="adm-panel-head">
            <div>
              <h2 className="adm-panel-title">Plan distribution</h2>
              <p className="adm-panel-sub">Active organizations by plan name</p>
            </div>
          </div>
          {planDistribution.length === 0 ? (
            <div className="adm-empty">No organizations yet.</div>
          ) : (
            <>
              <div className="adm-donut-wrap">
                <div className="adm-chart" style={{ minHeight: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={planDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={54}
                        outerRadius={78}
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
                </div>
                <div className="adm-donut-center" aria-hidden>
                  <div className="adm-donut-num">{planDistribution.length}</div>
                  <div className="adm-donut-label">Plans</div>
                </div>
              </div>
              <div className="adm-legend">
                {planDistribution.map((row, i) => (
                  <div key={row.name} className="adm-legend-row">
                    <span
                      className="adm-dot"
                      style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                    />
                    <span style={{ flex: 1 }}>{row.name}</span>
                    <strong>{row.pct}%</strong>
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
                  <th>Action</th>
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
                      <td>
                        <span className="adm-badge">{r.action || '—'}</span>
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
