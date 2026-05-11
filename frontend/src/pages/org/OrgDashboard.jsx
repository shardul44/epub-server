import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { conversionService } from '../../services/conversionService';
import useAppDispatch from '../../hooks/useAppDispatch';
import { setSeatLimit } from '../../features/dashboard/dashboardSlice';
import { useDashboardQuery } from '../../hooks/queries/useDashboardQuery';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import {
  FileText,
  RefreshCw,
  CheckCircle,
  Clock,
  ArrowRight,
  AlertTriangle,
  Eye,
  Image,
  Music,
  Download,
  Users,
  BarChart2,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react';
import DashboardHeader from '../../components/layout/Header';
import MainContent from '../../components/layout/MainContent';
import '../Dashboard.css';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const fmtStorage = (mb) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;

/* ─── sub-components ──────────────────────────────────────────────────────── */

const StatCardSkeleton = () => (
  <div className="ds-stat-card ds-stat-card--skeleton">
    <div className="ds-skel ds-skel--sm" />
    <div className="ds-skel ds-skel--lg" style={{ marginTop: 8 }} />
    <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
  </div>
);

const StatCard = ({ value, label, isEmpty, valueClass }) => (
  <div className="ds-stat-card">
    <div className="ds-stat-label">{label}</div>
    <div className={`ds-stat-value ${valueClass ?? ''}`}>{isEmpty ? '—' : value}</div>
  </div>
);

const StatusPill = ({ status }) => {
  const map = {
    COMPLETED:   { label: 'Completed',   cls: 'pill--completed' },
    IN_PROGRESS: { label: 'In Progress', cls: 'pill--progress'  },
    FAILED:      { label: 'Failed',      cls: 'pill--failed'    },
    QUEUED:      { label: 'Queued',      cls: 'pill--queued'    },
  };
  const { label, cls } = map[status] ?? { label: status, cls: '' };
  return <span className={`ds-pill ${cls}`}>{label}</span>;
};

const ProgressBar = ({ pct, status }) => {
  const colorMap = {
    COMPLETED:   '#22c55e',
    IN_PROGRESS: '#f59e0b',
    FAILED:      '#ef4444',
    QUEUED:      '#94a3b8',
  };
  return (
    <div className="ds-progress-wrap">
      <div
        className="ds-progress-bar"
        style={{ width: `${pct}%`, background: colorMap[status] ?? '#94a3b8' }}
      />
    </div>
  );
};

/* ─── Interactive Throughput Chart ───────────────────────────────────────── */
const ThroughputChart = ({ data, today }) => {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="ds-chart-wrap">
      {/* Y-axis labels */}
      <div className="ds-chart-y-axis">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>

      {/* Bars */}
      <div className="ds-chart">
        {data.map((d, i) => {
          const isToday   = d.day === today;
          const isHovered = hovered === i;
          const heightPct = max > 0 ? Math.round((d.count / max) * 100) : 0;

          return (
            <div
              key={d.day}
              className="ds-chart-col"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {isHovered && (
                <div className="ds-chart-tooltip">
                  <span className="ds-chart-tooltip-day">{d.fullDay}</span>
                  <span className="ds-chart-tooltip-val">
                    {d.count} job{d.count !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {/* Bar track */}
              <div className="ds-chart-bar-track">
                <div
                  className={[
                    'ds-chart-bar',
                    isToday   ? 'ds-chart-bar--today'   : '',
                    isHovered ? 'ds-chart-bar--hovered' : '',
                    d.count === 0 ? 'ds-chart-bar--empty' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ height: d.count === 0 ? '4px' : `${heightPct}%` }}
                />
              </div>

              <span className={`ds-chart-label${isToday ? ' ds-chart-label--today' : ''}`}>
                {d.day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── OrgDashboard ────────────────────────────────────────────────────────── */

const OrgDashboard = () => {
  const { user } = useAuth();
  const dispatch = useAppDispatch();

  const {
    stats,
    recentJobs,
    throughputData,
    throughputMeta,
    teamData,
    systemHealth,
    isLoading:    loading,
    isRefreshing: refreshing,
    refetch:      loadData,
  } = useDashboardQuery();

  // For the retry button in "Needs attention" panel
  const { refresh: refreshJobs } = useConversionsQuery({ enabled: false });

  // Sync seat limit from user object into the Redux store (still used by other parts)
  useEffect(() => {
    const limit = user?.memberSeatLimit ?? user?.organization?.memberSeatLimit ?? null;
    if (limit !== null) dispatch(setSeatLimit(limit));
  }, [dispatch, user?.memberSeatLimit, user?.organization?.memberSeatLimit]);

  const successRate =
    stats.totalConversions > 0
      ? ((stats.completed / stats.totalConversions) * 100).toFixed(0)
      : 0;

  const storageMb = stats.totalPdfs * 2.4;

  // Today's short day name for highlighting
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayName = DAY_NAMES[new Date().getDay()];

  const orgName = user?.organizationName || 'Your Organization'; // eslint-disable-line no-unused-vars
  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="ds-root">

      {/* ── Header ── */}
      <DashboardHeader
        title="Dashboard"
        healthStatus={systemHealth.api}
      />

      {/* ── Main content ── */}
      <MainContent>

      {/* ── Welcome Banner ── */}
      <div className="ds-welcome">
        <div className="ds-welcome-left">
          <span className="ds-welcome-badge">
            <span className="ds-badge-dot" />
            Welcome back
          </span>
          <h2 className="ds-welcome-title">
            Good to see you, {firstName}
            <span className="ds-wave" role="img" aria-label="wave">👋</span>
          </h2>
          <p className="ds-welcome-desc">
            You have <strong>{stats.inProgress} active</strong> job{stats.inProgress !== 1 ? 's' : ''} and{' '}
            <strong>{stats.totalPdfs} queued</strong>. Pick up where you left off or start a new conversion.
          </p>
          <div className="ds-welcome-actions">
            <Link to="/conversions" className="wb-btn wb-btn--primary">
              Resume work <ArrowRight size={16} />
            </Link>
            <Link to="/pdfs" className="wb-btn wb-btn--secondary">
              <FileText size={16} /> Browse PDFs
            </Link>
          </div>
        </div>

        <div className="ds-welcome-stats">
          {loading ? (
            [1, 2, 3, 4].map((k) => <StatCardSkeleton key={k} />)
          ) : (
            <>
              <StatCard
                value={`${successRate}%`}
                label="Success Rate"
                valueClass="stat-val--green"
                isEmpty={stats.totalConversions === 0}
              />
              <StatCard
                value={stats.totalPdfs > 0 ? Math.round(stats.totalPdfs * 8.5) : '—'}
                label="Avg. Pages"
                valueClass="stat-val--blue"
                isEmpty={stats.totalPdfs === 0}
              />
              <StatCard
                value={fmtStorage(storageMb)}
                label="Storage"
                valueClass="stat-val--purple"
                isEmpty={stats.totalPdfs === 0}
              />
              <StatCard
                value={`+${stats.completed}`}
                label="This Week"
                valueClass="stat-val--teal"
                isEmpty={stats.completed === 0}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Stat Row ── */}
      <div className="ds-stat-row">
        {loading ? (
          [1, 2, 3, 4].map((k) => (
            <div key={k} className="ds-stat-tile ds-stat-tile--skel">
              <div className="ds-skel ds-skel--sm" />
              <div className="ds-skel ds-skel--xl" style={{ marginTop: 8 }} />
              <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
            </div>
          ))
        ) : (
          <>
            {/* Total Jobs */}
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--blue">
                  <FileText size={18} />
                </span>
                <span className="ds-tile-badge badge--blue">
                  {stats.totalConversions > 0 ? 'org-wide' : 'no jobs yet'}
                </span>
              </div>
              <div className="ds-tile-value">{stats.totalConversions}</div>
              <div className="ds-tile-label">Total jobs</div>
            </div>

            {/* Completed */}
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--green">
                  <CheckCircle size={18} />
                </span>
                <span className="ds-tile-badge badge--green">
                  {successRate}% success
                </span>
              </div>
              <div className="ds-tile-value">{stats.completed}</div>
              <div className="ds-tile-label">Completed</div>
            </div>

            {/* In Progress */}
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--amber">
                  <Clock size={18} />
                </span>
                <span className="ds-tile-badge badge--amber">
                  {stats.inProgress} active
                </span>
              </div>
              <div className="ds-tile-value">{stats.inProgress}</div>
              <div className="ds-tile-label">In progress</div>
            </div>

            {/* Failed */}
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--red">
                  <AlertTriangle size={18} />
                </span>
                <span className="ds-tile-badge badge--red">
                  {stats.failed > 0 ? 'needs attention' : 'all clear'}
                </span>
              </div>
              <div className="ds-tile-value">{stats.failed}</div>
              <div className="ds-tile-label">Failed</div>
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Grid: Recent Activity + Throughput ── */}
      <div className="ds-bottom-grid">

        {/* Recent Activity — org-wide */}
        <div className="ds-panel ds-activity">
          <div className="ds-ra-header">
            <div>
              <h3 className="ds-panel-title">Recent activity</h3>
              <p className="ds-panel-sub">Latest conversion jobs across your library</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className={`ds-refresh-btn${refreshing ? ' ds-refresh-btn--spinning' : ''}`}
                onClick={() => loadData(true)}
                disabled={refreshing}
                title="Refresh"
                aria-label="Refresh activity"
              >
                <RefreshCw size={15} />
              </button>
              <Link to="/conversions" className="ds-ra-view-all">
                View all ↗
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="ds-ra-list">
              {[1, 2, 3].map((k) => (
                <div key={k} className="ds-ra-card">
                  <div className="ds-skel ds-skel--icon" style={{ borderRadius: 8 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="ds-skel ds-skel--md" />
                    <div className="ds-skel ds-skel--sm" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <div className="ds-skel" style={{ width: 120, height: 10 }} />
                    <div className="ds-skel" style={{ width: 120, height: 5, borderRadius: 3 }} />
                  </div>
                  <div className="ds-skel ds-skel--pill" />
                </div>
              ))}
            </div>
          ) : recentJobs.length === 0 ? (
            <div className="ds-empty">
              <FileText className="ds-empty-icon" />
              <p>No conversions yet. <Link to="/pdfs/upload">Upload a PDF</Link> to get started.</p>
            </div>
          ) : (
            <div className="ds-ra-list">
              {recentJobs.map((job) => {
                const pct =
                  job.status === 'COMPLETED' || job.status === 'FAILED'
                    ? 100
                    : job.progressPercentage ?? job.progress ?? 0;
                const pdfName =
                  job.pdfDocument?.originalName ||
                  job.pdfDocument?.filename ||
                  `Job #${job.id}`;
                const pages = job.pdfDocument?.pageCount ?? job.totalPages ?? null;
                const ago   = timeAgo(job.updatedAt || job.createdAt);
                const rawStep = job.currentStep || job.conversionType || '';
                const stage = rawStep
                  ? String(rawStep).replace(/STEP_\d+_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  : 'Conversion';
                const isActive = job.status === 'IN_PROGRESS' || job.status === 'QUEUED';

                const barColor =
                  job.status === 'COMPLETED' ? '#16a34a'
                  : job.status === 'FAILED'   ? '#ef4444'
                  : job.status === 'IN_PROGRESS' ? '#d97706'
                  : '#9ca3af';

                return (
                  <div key={job.id} className="ds-ra-card">
                    {/* icon */}
                    <span className="ds-ra-icon">
                      <FileText size={16} />
                    </span>

                    {/* name + meta */}
                    <div className="ds-ra-info">
                      <span className={`ds-ra-name${isActive ? ' ds-ra-name--active' : ''}`}>
                        {pdfName}
                      </span>
                      <span className="ds-ra-meta">
                        #{job.id}
                        {pages ? <>&nbsp;·&nbsp;{pages} pages</> : ''}
                        &nbsp;·&nbsp;
                        <Clock size={12} className="ds-ra-clock" />
                        {ago}
                      </span>
                    </div>

                    {/* progress */}
                    <div className="ds-ra-progress">
                      <div className="ds-ra-progress-top">
                        <span className="ds-ra-stage">{stage}</span>
                        <span className="ds-ra-pct">{pct}%</span>
                      </div>
                      <div className="ds-ra-bar-track">
                        <div
                          className="ds-ra-bar-fill"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </div>
                    </div>

                    {/* status pill */}
                    <span className={`ds-ra-pill ds-ra-pill--${job.status.toLowerCase().replace('_', '-')}`}>
                      {job.status === 'IN_PROGRESS' ? 'IN PROGRESS' : job.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly Throughput */}
        <div className="ds-panel ds-throughput">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Weekly throughput</h3>
              <p className="ds-panel-sub">Completed jobs — last 7 days</p>
            </div>
            <span className={`ds-trend-badge ${throughputMeta.trend >= 0 ? 'ds-trend-badge--up' : 'ds-trend-badge--down'}`}>
              {throughputMeta.trend >= 0 ? '↑' : '↓'}
              {Math.abs(throughputMeta.trend)}%
            </span>
          </div>

          {loading ? (
            <div className="ds-chart-skeleton">
              {[40, 70, 55, 90, 60, 80, 45].map((h, i) => (
                <div key={i} className="ds-skel" style={{ height: h, flex: 1, borderRadius: 4 }} />
              ))}
            </div>
          ) : (
            <ThroughputChart data={throughputData} today={todayName} />
          )}

          <div className="ds-throughput-meta">
            <div className="ds-meta-item">
              <span className="ds-meta-label">This week</span>
              <span className="ds-meta-value">{throughputMeta.totalWeek} jobs</span>
            </div>
            <div className="ds-meta-item">
              <span className="ds-meta-label">Peak day</span>
              <span className="ds-meta-value ds-meta-value--sm">{throughputMeta.peakDay}</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Needs Attention · Quick Actions · Team & System ── */}
      <div className="ds-three-grid">

        {/* Needs your attention */}
        <div className="ds-panel ds-attention">
          <div className="ds-attn-header">
            <h3 className="ds-panel-title">Needs your attention</h3>
            {!loading && stats.failed + stats.inProgress > 0 && (
              <span className="ds-attn-count-badge">
                {stats.failed + stats.inProgress}
              </span>
            )}
          </div>

          {loading ? (
            <div className="ds-attn-list">
              {[1, 2, 3].map((k) => (
                <div key={k} className="ds-attn-item">
                  <div style={{ flex: 1 }}>
                    <div className="ds-skel ds-skel--md" />
                    <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
                    <div className="ds-skel" style={{ width: 72, height: 28, borderRadius: 20, marginTop: 10 }} />
                  </div>
                  <div className="ds-skel ds-skel--pill" />
                </div>
              ))}
            </div>
          ) : recentJobs.filter(
              (j) => j.status === 'FAILED' || j.status === 'IN_PROGRESS' || j.status === 'QUEUED',
            ).length === 0 ? (
            <div className="ds-attention-empty">
              <CheckCircle className="ds-attention-empty-icon" />
              <span>All clear — no issues right now.</span>
            </div>
          ) : (
            <div className="ds-attn-list">
              {recentJobs
                .filter((j) => j.status === 'FAILED' || j.status === 'IN_PROGRESS' || j.status === 'QUEUED')
                .slice(0, 3)
                .map((job) => {
                  const name =
                    job.pdfDocument?.originalName ||
                    job.pdfDocument?.filename ||
                    `Job #${job.id}`;
                  const pct = job.progressPercentage ?? job.progress ?? 0;
                  const subLabel =
                    job.status === 'IN_PROGRESS'
                      ? `Conversion · ${pct}%`
                      : job.status === 'QUEUED'
                      ? 'Waiting in queue'
                      : `Conversion failed at step ${job.failedStep ?? 1}`;

                  return (
                    <div key={job.id} className="ds-attn-item">
                      {/* left: name + sub + action */}
                      <div className="ds-attn-body">
                        <span className="ds-attn-name">{name}</span>
                        <span className="ds-attn-sub">{subLabel}</span>
                        {job.status === 'FAILED' ? (
                          <button
                            className="ds-attn-action ds-attn-action--retry"
                          onClick={() => conversionService.retryConversion(job.id).then(() => { loadData(); refreshJobs(); })}
                          >
                            <RefreshCw size={13} /> Retry
                          </button>
                        ) : (
                          <Link
                            to="/conversions"
                            className="ds-attn-action ds-attn-action--open"
                          >
                            <Eye size={13} /> Open
                          </Link>
                        )}
                      </div>
                      {/* right: status pill */}
                      <span className={`ds-attn-pill ds-attn-pill--${job.status.toLowerCase().replace('_', '-')}`}>
                        {job.status === 'IN_PROGRESS' ? 'IN PROGRESS' : job.status}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Quick actions — org-admin specific */}
        <div className="ds-panel ds-quick-panel">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Quick actions</h3>
              <p className="ds-panel-sub">Jump straight into common workflows</p>
            </div>
          </div>
          <div className="ds-qa-grid">
            <Link to="/pdfs/upload" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--blue">
                <Upload size={20} />
              </span>
              <span className="ds-qa-label">Upload PDF</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--purple">
                <Image size={20} />
              </span>
              <span className="ds-qa-label">Image Editor</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--teal">
                <Music size={20} />
              </span>
              <span className="ds-qa-label">Audio Sync</span>
            </Link>
            <Link to="/conversions" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--green">
                <Download size={20} />
              </span>
              <span className="ds-qa-label">Download EPUB</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--amber">
                <RefreshCw size={20} />
              </span>
              <span className="ds-qa-label">EPUB Sync</span>
            </Link>
            <Link to="/ai-config" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--gray">
                <Zap size={20} />
              </span>
              <span className="ds-qa-label">AI Config</span>
            </Link>
          </div>
        </div>

        {/* Team & system — org-admin view */}
        <div className="ds-panel ds-team-panel">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Team &amp; system</h3>
              <p className="ds-panel-sub">Active members and platform health</p>
            </div>
            <Link to="/org/team" className="ds-view-all">
              Manage
            </Link>
          </div>

          {/* ── Member avatars ── */}
          {loading ? (
            <div className="ds-team-avatars" style={{ marginBottom: 20 }}>
              {[1,2,3,4].map(i => (
                <div key={i} className="ds-skel" style={{ width: 36, height: 36, borderRadius: '50%', marginLeft: i === 1 ? 0 : -8, flexShrink: 0 }} />
              ))}
            </div>
          ) : (
            <div className="ds-team-avatars" style={{ marginBottom: 20 }}>
              {teamData.members.slice(0, 4).map((m, i) => {
                const initial = (m.name || m.email || '?')[0].toUpperCase();
                const colors  = ['#4f46e5','#4f46e5','#4f46e5','#4f46e5'];
                return (
                  <span
                    key={m.id ?? i}
                    className="ds-avatar"
                    style={{ zIndex: 10 - i, background: colors[i % colors.length] }}
                    title={`${m.name || m.email} · ${m.role}`}
                  >
                    {initial}
                  </span>
                );
              })}
              {teamData.members.length > 4 && (
                <span className="ds-avatar ds-avatar--more" style={{ zIndex: 0 }}>
                  +{teamData.members.length - 4}
                </span>
              )}
              {teamData.members.length === 0 && (
                <span className="ds-team-no-members">No members yet</span>
              )}
            </div>
          )}

          {/* ── System stat cards ── */}
          <div className="ds-sys-cards">
            {/* API uptime */}
            <div className="ds-sys-card">
              <div className="ds-sys-card-left">
                <span className="ds-sys-card-icon ds-sys-card-icon--green">
                  <BarChart2 size={16} />
                </span>
                <span className="ds-sys-card-label">API uptime</span>
              </div>
              <span className="ds-sys-card-value ds-sys-card-value--green">
                {systemHealth.api === 'healthy' ? '99.98%' : systemHealth.api === 'checking' ? '…' : 'Down'}
              </span>
            </div>

            {/* Active seats */}
            <div className="ds-sys-card">
              <div className="ds-sys-card-left">
                <span className="ds-sys-card-icon ds-sys-card-icon--blue">
                  <Users size={16} />
                </span>
                <span className="ds-sys-card-label">Active seats</span>
              </div>
              <span className="ds-sys-card-value ds-sys-card-value--blue">
                {loading ? '—' : (
                  teamData.seatLimit != null
                    ? `${teamData.seatUsed} / ${teamData.seatLimit}`
                    : teamData.seatUsed
                )}
              </span>
            </div>

            {/* AI credits */}
            <div className="ds-sys-card">
              <div className="ds-sys-card-left">
                <span className="ds-sys-card-icon ds-sys-card-icon--purple">
                  <Sparkles size={16} />
                </span>
                <span className="ds-sys-card-label">AI credits</span>
              </div>
              <span className="ds-sys-card-value ds-sys-card-value--purple">
                {loading ? '—' : (
                  user?.aiCredits != null
                    ? `${user.aiCredits.toLocaleString()} left`
                    : user?.organization?.aiCredits != null
                    ? `${user.organization.aiCredits.toLocaleString()} left`
                    : '—'
                )}
              </span>
            </div>
          </div>
        </div>

      </div>
      </MainContent>
    </div>
  );
};

export default OrgDashboard;
