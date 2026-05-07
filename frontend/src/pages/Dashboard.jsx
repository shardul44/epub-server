import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConversionsQuery } from '../hooks/queries/useConversionsQuery';
import {
  FileText,
  RefreshCw,
  CheckCircle,
  Clock,
  CloudUpload,
  ArrowRight,
  AlertTriangle,
  Eye,
  Image,
  Music,
  Download,
  Settings,
  Users,
  BarChart2,
  Sparkles,
} from 'lucide-react';
import './Dashboard.css';
import OrgDashboard from './org/OrgDashboard';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const fmtStorage = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`);

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

/* Bar chart — purely CSS-driven, no library needed */
const ThroughputChart = ({ data }) => {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="ds-chart">
      {data.map((d) => (
        <div key={d.day} className="ds-chart-col">
          <div
            className="ds-chart-bar"
            style={{ height: `${Math.round((d.count / max) * 100)}%` }}
            title={`${d.count} jobs`}
          />
          <span className="ds-chart-label">{d.day}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── main component ──────────────────────────────────────────────────────── */

const Dashboard = () => {
  const { user } = useAuth();

  // Use React Query — shared cache, no extra API calls
  const isOrgOrAdmin = user?.role === 'org_admin' || user?.role === 'platform_admin';
  const { allJobs, isLoading: loading, refresh } = useConversionsQuery({
    enabled: !isOrgOrAdmin && !!user,
  });

  // Derive stats from the shared jobs list
  const completedJobs  = allJobs.filter(j => j.status === 'COMPLETED');
  const inProgressJobs = allJobs.filter(j => j.status === 'IN_PROGRESS');
  const failedJobs     = allJobs.filter(j => j.status === 'FAILED');

  const stats = {
    totalPdfs:        0,
    totalConversions: allJobs.length,
    inProgress:       inProgressJobs.length,
    completed:        completedJobs.length,
    failed:           failedJobs.length,
  };

  const recentJobs = [...allJobs]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 5);

  const loadDashboardData_retry = refresh;

  const successRate = stats.totalConversions > 0
    ? ((stats.completed / stats.totalConversions) * 100).toFixed(0)
    : 0;

  const storageMb = stats.totalPdfs * 2.4;

  // Synthetic weekly throughput (last 7 days from completed jobs)
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const throughputData = weekDays.map((day, i) => ({
    day,
    count: Math.max(0, Math.floor(stats.completed / 7) + (i % 3 === 0 ? 1 : 0)),
  }));

  /* ── org admin view ── */
  if (user?.role === 'org_admin') {
    return <OrgDashboard />;
  }

  /* ── platform admin view ── */
  if (!loading && user?.role === 'platform_admin') {
    return (
      <div className="ds-container">
        <div className="ds-page-header">
          <h1>Platform admin</h1>
          <p>Manage organizations, plans, and subscriptions.</p>
        </div>
        <div className="ds-admin-actions">
          <Link to="/admin/organizations" className="wb-btn wb-btn--primary">Organizations &amp; clients</Link>
          <Link to="/admin/plans"         className="wb-btn wb-btn--secondary">Plans &amp; features</Link>
          <Link to="/activity"            className="wb-btn wb-btn--secondary">View activity</Link>
        </div>
      </div>
    );
  }

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="ds-container">

      {/* ── Dashboard Navbar ── */}
      <div className="ds-navbar">
        <div className="ds-navbar-left">
          <h1 className="ds-navbar-title">Dashboard</h1>
        </div>
        <div className="ds-navbar-right">
          <Link to="/pdfs/upload" className="ds-navbar-btn ds-navbar-btn--ghost">
            <CloudUpload className="ds-navbar-btn-icon" />
            Upload PDF
          </Link>
          <Link to="/conversions" className="ds-navbar-btn ds-navbar-btn--primary">
            <span className="ds-navbar-btn-plus">+</span>
            New conversion
          </Link>
        </div>
      </div>

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
            [1,2,3,4].map((k) => <StatCardSkeleton key={k} />)
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
          [1,2,3,4].map((k) => (
            <div key={k} className="ds-stat-tile ds-stat-tile--skel">
              <div className="ds-skel ds-skel--sm" />
              <div className="ds-skel ds-skel--xl" style={{ marginTop: 8 }} />
              <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
            </div>
          ))
        ) : (
          <>
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--blue"><FileText size={18} /></span>
                <span className="ds-tile-badge badge--blue">+{stats.totalPdfs > 0 ? '19%' : '0%'} vs last week</span>
              </div>
              <div className="ds-tile-value">{stats.totalConversions}</div>
              <div className="ds-tile-label">Total jobs</div>
            </div>

            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--green"><CheckCircle size={18} /></span>
                <span className="ds-tile-badge badge--green">{successRate}% success</span>
              </div>
              <div className="ds-tile-value">{stats.completed}</div>
              <div className="ds-tile-label">Completed</div>
            </div>

            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--amber"><Clock size={18} /></span>
                <span className="ds-tile-badge badge--amber">{stats.inProgress} queued</span>
              </div>
              <div className="ds-tile-value">{stats.inProgress}</div>
              <div className="ds-tile-label">In progress</div>
            </div>

            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--red"><AlertTriangle size={18} /></span>
                <span className="ds-tile-badge badge--red">needs attention</span>
              </div>
              <div className="ds-tile-value">{stats.failed}</div>
              <div className="ds-tile-label">Failed</div>
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Grid: Recent Activity + Throughput ── */}
      <div className="ds-bottom-grid">

        {/* Recent Activity */}
        <div className="ds-panel ds-activity">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Recent activity</h3>
              <p className="ds-panel-sub">Latest conversion jobs across your library.</p>
            </div>
            <Link to="/conversions" className="ds-view-all">
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <div className="ds-activity-list">
              {[1,2,3].map((k) => (
                <div key={k} className="ds-activity-row ds-activity-row--skel">
                  <div className="ds-skel ds-skel--icon" />
                  <div style={{ flex: 1 }}>
                    <div className="ds-skel ds-skel--md" />
                    <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
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
            <div className="ds-activity-list">
              {recentJobs.map((job) => {
                const pct = job.status === 'COMPLETED' ? 100
                  : job.status === 'FAILED' ? 100
                  : job.progress ?? 0;
                const pdfName = job.pdfDocument?.originalName || job.pdfDocument?.filename || `Job #${job.id}`;
                const pages   = job.pdfDocument?.pageCount ?? '—';
                const ago     = timeAgo(job.updatedAt || job.createdAt);
                const stage   = job.currentStep || job.conversionType || 'Conversion';

                return (
                  <div key={job.id} className="ds-activity-row">
                    <span className="ds-activity-file-icon"><FileText size={16} /></span>
                    <div className="ds-activity-info">
                      <span className="ds-activity-name">{pdfName}</span>
                      <span className="ds-activity-meta">
                        #{job.id} &nbsp;·&nbsp; {pages} pages &nbsp;·&nbsp; <Clock size={12} className="ds-meta-icon" /> {ago}
                      </span>
                    </div>
                    <div className="ds-activity-progress">
                      <div className="ds-activity-progress-top">
                        <span className="ds-activity-stage">{stage}</span>
                        <span className="ds-activity-pct">{pct}%</span>
                      </div>
                      <ProgressBar pct={pct} status={job.status} />
                    </div>
                    <StatusPill status={job.status} />
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
              <p className="ds-panel-sub">Jobs completed per day.</p>
            </div>
            <span className="ds-trend-badge">
              <ArrowRight size={14} className="ds-trend-icon" />
              +{stats.completed > 0 ? '18' : '0'}%
            </span>
          </div>

          <ThroughputChart data={throughputData} />

          <div className="ds-throughput-meta">
            <div className="ds-meta-item">
              <span className="ds-meta-label">Avg. Duration</span>
              <span className="ds-meta-value">14m 22s</span>
            </div>
            <div className="ds-meta-item">
              <span className="ds-meta-label">Peak Day</span>
              <span className="ds-meta-value">Saturday</span>
            </div>
          </div>
        </div>

      </div>


      {/* ── Needs Attention · Quick Actions · Team & System ── */}
      <div className="ds-three-grid">

        {/* Needs your attention */}
        <div className="ds-panel ds-attention">
          <div className="ds-panel-header">
            <h3 className="ds-panel-title">Needs your attention</h3>
            {(stats.failed + stats.inProgress) > 0 && (
              <span className="ds-attention-count">{stats.failed + stats.inProgress}</span>
            )}
          </div>

          {loading ? (
            <div className="ds-attention-list">
              {[1, 2, 3].map((k) => (
                <div key={k} className="ds-attention-item ds-attention-item--skel">
                  <div style={{ flex: 1 }}>
                    <div className="ds-skel ds-skel--md" />
                    <div className="ds-skel ds-skel--sm" style={{ marginTop: 6 }} />
                  </div>
                  <div className="ds-skel ds-skel--pill" />
                </div>
              ))}
            </div>
          ) : recentJobs.filter(j => j.status === 'FAILED' || j.status === 'IN_PROGRESS' || j.status === 'QUEUED').length === 0 ? (
            <div className="ds-attention-empty">
              <CheckCircle className="ds-attention-empty-icon" />
              <span>All clear — no issues right now.</span>
            </div>
          ) : (
            <div className="ds-attention-list">
              {recentJobs
                .filter(j => j.status === 'FAILED' || j.status === 'IN_PROGRESS' || j.status === 'QUEUED')
                .slice(0, 3)
                .map((job) => {
                  const name = job.pdfDocument?.originalName || job.pdfDocument?.filename || `Job #${job.id}`;
                  const pct  = job.progress ?? 0;
                  const subLabel =
                    job.status === 'IN_PROGRESS' ? `Conversion · ${pct}%` :
                    job.status === 'QUEUED'      ? 'Waiting in queue' :
                    `Conversion failed at step ${job.failedStep ?? 1}`;

                  return (
                    <div key={job.id} className="ds-attention-item">
                      <div className="ds-attention-info">
                        <span className="ds-attention-name">{name}</span>
                        <span className="ds-attention-sub">{subLabel}</span>
                      </div>
                      <div className="ds-attention-right">
                        <StatusPill status={job.status} />
                        {job.status === 'FAILED' ? (
                          <button
                            className="ds-attn-btn ds-attn-btn--retry"
                          onClick={() => conversionService.retryConversion(job.id).then(loadDashboardData_retry)}
                          >
                          <RefreshCw size={14} /> Retry
                          </button>
                        ) : (
                          <Link to="/conversions" className="ds-attn-btn ds-attn-btn--open">
                          <Eye size={14} /> Open
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="ds-panel ds-quick-panel">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Quick actions</h3>
              <p className="ds-panel-sub">Jump straight into common workflows</p>
            </div>
          </div>
          <div className="ds-qa-grid">
            <Link to="/pdfs/upload"      className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--blue"><CloudUpload size={20} /></span>
              <span className="ds-qa-label">Upload PDF</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--purple"><Image size={20} /></span>
              <span className="ds-qa-label">Image Editor</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--green"><Music size={20} /></span>
              <span className="ds-qa-label">Audio Sync</span>
            </Link>
            <Link to="/conversions"      className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--teal"><Download size={20} /></span>
              <span className="ds-qa-label">Download EPUB</span>
            </Link>
            <Link to="/epub-sync-import" className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--amber"><RefreshCw size={20} /></span>
              <span className="ds-qa-label">EPUB Sync</span>
            </Link>
            <Link to="/ai-config"        className="ds-qa-item">
              <span className="ds-qa-icon ds-qa-icon--gray"><Settings size={20} /></span>
              <span className="ds-qa-label">AI Config</span>
            </Link>
          </div>
        </div>

        {/* Team & system */}
        <div className="ds-panel ds-team-panel">
          <div className="ds-panel-header">
            <div>
              <h3 className="ds-panel-title">Team &amp; system</h3>
              <p className="ds-panel-sub">Active members and platform health</p>
            </div>
            <Link to="/org/team" className="ds-view-all">Manage</Link>
          </div>

          {/* Avatar row */}
          <div className="ds-team-avatars">
            {['A', 'M', 'S', 'K'].map((initial, i) => (
              <span
                key={i}
                className="ds-avatar"
                style={{ zIndex: 4 - i }}
                title={`Team member ${initial}`}
              >
                {initial}
              </span>
            ))}
            <span className="ds-avatar ds-avatar--more">+2</span>
          </div>

          {/* System metrics */}
          <div className="ds-sys-list">
            <div className="ds-sys-row">
              <span className="ds-sys-icon ds-sys-icon--green"><BarChart2 size={16} /></span>
              <span className="ds-sys-label">API uptime</span>
              <span className="ds-sys-value ds-sys-value--green">99.98%</span>
            </div>
            <div className="ds-sys-row">
              <span className="ds-sys-icon ds-sys-icon--blue"><Users size={16} /></span>
              <span className="ds-sys-label">Active seats</span>
              <span className="ds-sys-value ds-sys-value--blue">6 / 10</span>
            </div>
            <div className="ds-sys-row">
              <span className="ds-sys-icon ds-sys-icon--purple"><Sparkles size={16} /></span>
              <span className="ds-sys-label">AI credits</span>
              <span className="ds-sys-value ds-sys-value--purple">2,840 left</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;
