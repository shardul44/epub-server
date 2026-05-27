import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertTriangle,
  Layers,
  ArrowRight,
  Image,
  Music,
  Download,
  Bell,
  Search,
  CloudUpload,
  BarChart2,
  HardDrive,
  Cpu,
  Eye,
  ExternalLink,
  Settings,
  ShieldCheck,
  Accessibility,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useListScope } from '../../context/ListScopeContext';
import { hasFeature } from '../../utils/features';
import { useDashboardQuery } from '../../hooks/queries/useDashboardQuery';
import { usePdfsQuery } from '../../hooks/queries/usePdfsQuery';
import { conversionService } from '../../services/conversionService';
import { aiConfigService } from '../../services/aiConfigService';
import DashboardHeader from '../../components/layout/Header';
import MainContent from '../../components/layout/MainContent';
import RecentActivityPanel from '../../components/dashboard/RecentActivityPanel';
import QuickActionsFab from '../../components/dashboard/QuickActionsFab';
import '../Dashboard.css';
import './UserDashboard.css';

const fmtStorage = (mb) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

const ATTENTION_STATUSES = new Set(['FAILED', 'IN_PROGRESS', 'QUEUED', 'PENDING', 'PROCESSING']);

function jobTitle(job) {
  return job.pdfDocument?.originalName || job.pdfDocument?.filename || job.title || `Job #${job.id}`;
}

function jobProgress(job) {
  if (job.status === 'COMPLETED' || job.status === 'FAILED') return 100;
  return Math.round(job.progressPercentage ?? job.progress ?? 0);
}

function jobStageLine(job) {
  const raw = job.currentStep || job.conversionType || '';
  const stage = raw
    ? String(raw)
        .replace(/STEP_\d+_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Conversion';
  return `Conversion · ${jobProgress(job)}% · ${stage}`;
}

function computeAvgDuration(jobs) {
  const done = jobs.filter((j) => {
    if (j.status !== 'COMPLETED') return false;
    const end = j.completedAt || j.updatedAt;
    return Boolean(end && j.createdAt);
  });
  if (!done.length) return null;
  let ms = 0;
  for (const j of done) {
    ms += Math.max(0, new Date(j.completedAt || j.updatedAt) - new Date(j.createdAt));
  }
  const mins = ms / done.length / 60000;
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const CHART_DAY_SHORT = {
  Sun: 'Su',
  Mon: 'Mo',
  Tue: 'Tu',
  Wed: 'We',
  Thu: 'Th',
  Fri: 'Fr',
  Sat: 'Sa',
};

/**
 * Member dashboard — personal workspace only (own PDFs + own conversion jobs).
 * Uses list scope `own`; does not show org-admin team/org-wide usage metrics.
 */
export default function UserDashboard() {
  const { user } = useAuth();
  const listScope = useListScope();

  const showConversion = hasFeature(user, 'conversion.basic');
  const showKitaboo = hasFeature(user, 'kitaboo.import');
  const showSyncStudio = hasFeature(user, 'sync_studio');
  const showEpubTools = hasFeature(user, 'epub_tools');
  const showAccessibility = hasFeature(user, 'accessibility_tools');
  const showAi = false; // AI settings — org admin only (not shown to members)
  const showInteractive = hasFeature(user, 'interactive.content');

  const { pdfs, isLoading: pdfsLoading } = usePdfsQuery({
    enabled: !!user && showConversion,
    scope: listScope,
  });

  const {
    stats,
    recentJobs,
    allJobs,
    throughputData,
    throughputMeta,
    isLoading: dashLoading,
    isRefreshing: refreshing,
    refetch: loadData,
  } = useDashboardQuery({
    enabled: !!user && showConversion,
    includeTeamUsers: false,
    scope: listScope,
  });

  const [retryingId, setRetryingId] = useState(null);

  const aiConfigQuery = useQuery({
    queryKey: ['user-dashboard', 'ai-config'],
    queryFn: () => aiConfigService.getCurrentConfig(),
    enabled: Boolean(user) && showAi,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const loading = showConversion && (dashLoading || pdfsLoading);

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const planName =
    user?.license?.planName || user?.planName || user?.plan || 'Your plan';

  const queuedCount = useMemo(
    () => stats.totalConversions > 0 ? recentJobs.filter((j) => j.status === 'QUEUED').length : 0,
    [recentJobs, stats.totalConversions],
  );
  const activeJobs = stats.inProgress;

  const successRate =
    stats.totalConversions > 0
      ? Math.round((stats.completed / stats.totalConversions) * 1000) / 10
      : 0;

  const pdfList = Array.isArray(pdfs) ? pdfs : [];
  const totalPdfPages = pdfList.reduce(
    (s, p) => s + (Number(p.totalPages) || Number(p.pageCount) || 0),
    0,
  );
  const avgPages =
    pdfList.length > 0 && totalPdfPages > 0 ? Math.round(totalPdfPages / pdfList.length) : null;
  const storageMb = totalPdfPages > 0 ? totalPdfPages * 0.12 : pdfList.length * 2.4;

  const trend = throughputMeta?.trend ?? 0;
  const trendLabel = `${trend >= 0 ? '+' : ''}${trend}%`;

  /** Activity mix from this member's jobs (not org-wide license usage). */
  const breakdown = useMemo(() => {
    const completed = allJobs.filter((j) => j.status === 'COMPLETED').length;
    const inProgress = allJobs.filter(
      (j) => j.status === 'IN_PROGRESS' || j.status === 'PROCESSING' || j.status === 'PENDING',
    ).length;
    const failed = allJobs.filter((j) => j.status === 'FAILED').length;
    const max = Math.max(completed, inProgress, failed, 1);
    return { completed, inProgress, failed, max };
  }, [allJobs]);

  const thisWeekJobs = throughputMeta?.totalWeek ?? stats.completed;

  const attentionJobs = useMemo(() => {
    const list = allJobs.filter((j) => ATTENTION_STATUSES.has(j.status));
    return [...list]
      .sort((a, b) => {
        const rank = (s) =>
          s === 'FAILED'
            ? 0
            : s === 'IN_PROGRESS' || s === 'PROCESSING'
              ? 1
              : s === 'QUEUED' || s === 'PENDING'
                ? 2
                : 9;
        const d = rank(a.status) - rank(b.status);
        return d !== 0 ? d : new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      })
      .slice(0, 4);
  }, [allJobs]);

  const jobStatusRows = useMemo(
    () => [
      { name: 'Completed', count: breakdown.completed, color: '#2563eb' },
      { name: 'In progress', count: breakdown.inProgress, color: '#d97706' },
      { name: 'Failed', count: breakdown.failed, color: '#ef4444' },
    ],
    [breakdown],
  );

  const storageCard = useMemo(() => {
    const capMb = 2 * 1024;
    const pdfBytes = pdfList.reduce((s, p) => s + (Number(p.fileSize) || 0), 0);
    const pdfMb = pdfBytes / (1024 * 1024);
    const epubMbEst = Math.max(0, stats.completed * 1.2);
    const usedMb = Math.min(capMb, Math.max(pdfMb + epubMbEst, storageMb));
    const pct = capMb > 0 ? Math.min(100, (usedMb / capMb) * 100) : 0;
    const epubMb = Math.max(0, usedMb - pdfMb);
    return { usedMb, capMb, pct, pdfMb, epubMb, capLabel: '2 GB' };
  }, [pdfList, stats.completed, storageMb]);

  const avgJobDuration = useMemo(() => computeAvgDuration(allJobs), [allJobs]);

  const throughputPeakIdx = useMemo(() => {
    if (!throughputData.length) return 0;
    return throughputData.reduce((best, d, i, arr) => (d.count > arr[best].count ? i : best), 0);
  }, [throughputData]);

  const peakDayShort =
    throughputMeta?.peakDay && String(throughputMeta.peakDay).includes(' ')
      ? String(throughputMeta.peakDay).split(' ')[0]
      : throughputMeta?.peakDay || '—';

  const notifyAttention = stats.failed > 0 || queuedCount > 0 || activeJobs > 0;

  const handleRetryJob = async (jobId) => {
    setRetryingId(jobId);
    try {
      await conversionService.retryConversion(jobId);
      loadData();
    } finally {
      setRetryingId(null);
    }
  };

  const aiCfg = aiConfigQuery.data;
  const chartMax = Math.max(1, ...throughputData.map((d) => d.count));

  const quickActions = useMemo(
    () => [
      { Icon: ShieldCheck, label: 'EPUB Checker', to: '/epub-checker', show: showEpubTools },
      { Icon: Accessibility, label: 'Accessibility', to: '/accessibility', show: showAccessibility },
      { Icon: Download, label: 'Download EPUB', to: '/conversions/download', show: showConversion },
      { Icon: Music, label: 'Audio Sync', to: '/conversions/audio-sync', show: showSyncStudio },
      { Icon: Image, label: 'FXL Editor', to: '/conversions/fxl-editor', show: showKitaboo },
      { Icon: CloudUpload, label: 'Upload PDF', to: '/pdfs/upload', show: showConversion },
    ],
    [showConversion, showSyncStudio, showEpubTools, showAccessibility, showKitaboo],
  );

  const headerActions = showConversion ? (
    <>
      <span className="ud-page-header-divider" aria-hidden="true" />
      <Link
        to="/conversions"
        title="Activity"
        aria-label="Activity"
        className={`ui-icon-btn ud-icon-btn${notifyAttention ? ' ud-icon-btn--notify' : ''}`}
      >
        <Bell size={18} strokeWidth={2} aria-hidden />
        {notifyAttention ? <span className="ud-icon-btn-dot" aria-hidden /> : null}
      </Link>
      <Link to="/pdfs" title="Search library" aria-label="Search library" className="ui-icon-btn ud-icon-btn">
        <Search size={18} strokeWidth={2} aria-hidden />
      </Link>
      <Link to="/pdfs/upload" className="ds-navbar-btn ds-navbar-btn--ghost">
        <CloudUpload size={16} strokeWidth={2} aria-hidden className="ds-navbar-btn-icon" />
        Upload PDF
      </Link>
      <Link to="/conversions" className="ds-navbar-btn ds-navbar-btn--primary">
        <span className="ds-navbar-btn-plus">+</span>
        New conversion
      </Link>
    </>
  ) : null;

  return (
    <div className="ds-root ui-page">
      <DashboardHeader
        title="Dashboard"
        className="navbar ud-page-header"
        actionsClassName={headerActions ? 'ud-page-header-actions' : undefined}
        actions={headerActions}
      />

      <MainContent>
      <div className="ud-root">
      {/* Hero */}
      <section className="ud-hero">
        <div className="ud-hero-left">
          <span className="ud-hero-badge">
            <span className="ud-hero-badge-dot" aria-hidden />
            Welcome back
          </span>
          <h1 className="ud-hero-title">
            Good to see you, {firstName}
          </h1>
          {showConversion ? (
            <p className="ud-hero-desc">
              You have <strong>{activeJobs}</strong> active job{activeJobs !== 1 ? 's' : ''} and{' '}
              <strong>{queuedCount}</strong> queued across <strong>{pdfList.length}</strong> PDF
              {pdfList.length !== 1 ? 's' : ''} in your library. Pick up where you left off or start a new conversion.
            </p>
          ) : (
            <p className="ud-hero-desc">
              Your organization is on the <strong>{planName}</strong> plan. Open only the tools
              included with your plan from the sidebar.
            </p>
          )}
          <div className="ud-hero-actions">
            {showConversion && (
              <>
                <Link to="/conversions" className="ud-btn ud-btn--solid">
                  Resume work
                  <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
                </Link>
                <Link to="/pdfs" className="ud-btn ud-btn--ghost">
                  <FileText size={16} strokeWidth={2} aria-hidden />
                  Browse PDFs
                </Link>
              </>
            )}
            {!showConversion && (
              <>
                <Link to="/usage" className="ud-btn ud-btn--solid">
                  View usage
                  <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
                </Link>
                <Link to="/activity" className="ud-btn ud-btn--ghost">
                  <BarChart2 size={16} strokeWidth={2} aria-hidden />
                  Activity
                </Link>
              </>
            )}
          </div>
        </div>
        {showConversion && (
        <div className="ud-hero-stats" aria-label="Quick stats">
          {loading ? (
            [1, 2, 3, 4].map((k) => (
              <div key={k} className="ud-hero-stat ud-hero-stat--loading">
                <span className="ud-hero-stat-lbl ud-hero-stat-skel" />
                <span className="ud-hero-stat-val ud-hero-stat-skel ud-hero-stat-skel--val" />
              </div>
            ))
          ) : (
            <>
              <div className="ud-hero-stat">
                <span className="ud-hero-stat-lbl">Success rate</span>
                <span
                  className={
                    stats.totalConversions
                      ? 'ud-hero-stat-val ud-hero-stat-val--success'
                      : 'ud-hero-stat-val ud-hero-stat-val--dash ud-hero-stat-val--muted'
                  }
                >
                  {stats.totalConversions ? `${successRate}%` : '—'}
                </span>
              </div>
              <div className="ud-hero-stat">
                <span className="ud-hero-stat-lbl">Avg. pages</span>
                <span
                  className={
                    avgPages != null
                      ? 'ud-hero-stat-val ud-hero-stat-val--metric'
                      : 'ud-hero-stat-val ud-hero-stat-val--dash ud-hero-stat-val--blue'
                  }
                >
                  {avgPages != null ? avgPages : '—'}
                </span>
              </div>
              <div className="ud-hero-stat">
                <span className="ud-hero-stat-lbl">Storage</span>
                <span
                  className={
                    totalPdfPages > 0
                      ? 'ud-hero-stat-val ud-hero-stat-val--metric'
                      : 'ud-hero-stat-val ud-hero-stat-val--dash ud-hero-stat-val--purple'
                  }
                >
                  {totalPdfPages > 0 ? fmtStorage(storageMb) : '—'}
                </span>
              </div>
              <div className="ud-hero-stat">
                <span className="ud-hero-stat-lbl">This week</span>
                <span
                  className={
                    thisWeekJobs > 0
                      ? 'ud-hero-stat-val ud-hero-stat-val--success'
                      : 'ud-hero-stat-val ud-hero-stat-val--metric'
                  }
                >
                  {thisWeekJobs > 0 ? `+${thisWeekJobs}` : thisWeekJobs}
                </span>
              </div>
            </>
          )}
        </div>
        )}
      </section>

      {showConversion && (
      <>
      {/* Metric tiles */}
      <div className="ds-stat-row ud-stat-row-spaced">
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
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--blue">
                  <Layers size={18} />
                </span>
                <span className="ds-tile-badge badge--blue">{trendLabel} vs last week</span>
              </div>
              <div className="ds-tile-value">{stats.totalConversions}</div>
              <div className="ds-tile-label">Your jobs</div>
            </div>
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--green">
                  <CheckCircle size={18} />
                </span>
                <span className="ds-tile-badge badge--green">{successRate}%</span>
              </div>
              <div className="ds-tile-value">{stats.completed}</div>
              <div className="ds-tile-label">Completed conversions</div>
            </div>
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--amber">
                  <Clock size={18} />
                </span>
                <span className="ds-tile-badge badge--amber">
                  {queuedCount} queued
                </span>
              </div>
              <div className="ds-tile-value">{activeJobs}</div>
              <div className="ds-tile-label">In progress</div>
            </div>
            <div className="ds-stat-tile">
              <div className="ds-tile-top">
                <span className="ds-tile-icon tile-icon--red">
                  <AlertTriangle size={18} />
                </span>
                <span className="ds-tile-badge badge--red">
                  {stats.failed > 0 ? 'Attention' : 'All clear'}
                </span>
              </div>
              <div className="ds-tile-value">{stats.failed}</div>
              <div className="ds-tile-label">Failed — review needed</div>
            </div>
          </>
        )}
      </div>

      {/* Top row: throughput, storage, job status */}
      <section className="ud-insights" aria-label="Dashboard insights">
        <div className="ud-insights-grid">
          {/* Weekly throughput */}
          <div className="ud-insight-card ud-insight-card--throughput">
            <div className="ud-insight-head">
              <div className="ud-insight-head-left">
                <span className="ud-insight-icon ud-insight-icon--blue">
                  <BarChart2 size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="ud-insight-title">Weekly throughput</h2>
                  <p className="ud-insight-sub">Jobs completed per day</p>
                </div>
              </div>
              {loading ? (
                <div className="ds-skel ds-skel--pill" style={{ width: 48 }} />
              ) : (
                <span className="ud-insight-badge ud-insight-badge--blue">{trendLabel}</span>
              )}
            </div>
            <div className="ud-insight-body ud-insight-body--chart">
              {loading ? (
                <div className="ud-chart ud-chart--skel" />
              ) : (
                <div className="ud-chart" role="img" aria-label="Completed jobs per day this week">
                  {throughputData.map((d, i) => {
                    const h = chartMax > 0 ? Math.round((d.count / chartMax) * 100) : 0;
                    const isPeak = i === throughputPeakIdx && d.count > 0;
                    return (
                      <div key={d.date} className="ud-chart-col">
                        <div className="ud-chart-track">
                          <div
                            className={`ud-chart-fill${isPeak ? ' ud-chart-fill--peak' : ''}`}
                            style={{ height: `${Math.max(h, 4)}%` }}
                            title={`${d.fullDay}: ${d.count}`}
                          />
                        </div>
                        <span className={`ud-chart-lbl${isPeak ? ' ud-chart-lbl--peak' : ''}`}>
                          {CHART_DAY_SHORT[d.day] ?? d.day?.charAt(0) ?? '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="ud-insight-foot">
                <span>Avg {avgJobDuration ?? '—'}</span>
                <span>Peak {peakDayShort}</span>
              </div>
            </div>
          </div>

          {/* 3 — Storage */}
          <div className="ud-insight-card ud-insight-card--storage">
            <div className="ud-insight-head">
              <div className="ud-insight-head-left">
                <span className="ud-insight-icon ud-insight-icon--slate">
                  <HardDrive size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="ud-insight-title">Storage</h2>
                  <p className="ud-insight-sub">Your file storage usage</p>
                </div>
              </div>
              {loading ? (
                <div className="ds-skel ds-skel--pill" style={{ width: 64 }} />
              ) : (
                <span className="ud-insight-badge ud-insight-badge--blue">
                  {storageCard.pct.toFixed(1)}% used
                </span>
              )}
            </div>
            <div className="ud-insight-body">
              {loading ? (
                <div className="ds-skel ds-skel--lg" style={{ height: 80 }} />
              ) : (
                <>
                  <p className="ud-storage-summary">
                    <strong>{storageCard.usedMb.toFixed(1)}</strong> MB of {storageCard.capLabel}
                  </p>
                  <div className="ud-storage-bar-track">
                    <div className="ud-storage-bar-fill" style={{ width: `${storageCard.pct}%` }} />
                  </div>
                  <ul className="ud-storage-rows">
                    <li>
                      <span className="ud-storage-dot" style={{ background: '#2563eb' }} aria-hidden />
                      <span>PDF files</span>
                      <span>{storageCard.pdfMb.toFixed(1)} MB</span>
                    </li>
                    <li>
                      <span className="ud-storage-dot" style={{ background: '#7c3aed' }} aria-hidden />
                      <span>EPUB &amp; assets</span>
                      <span>{storageCard.epubMb.toFixed(1)} MB</span>
                    </li>
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Job status */}
          <div className="ud-insight-card ud-insight-card--job-status">
            <div className="ud-insight-head">
              <div className="ud-insight-head-left">
                <span className="ud-insight-icon ud-insight-icon--purple">
                  <BarChart2 size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="ud-insight-title">Job status</h2>
                  <p className="ud-insight-sub">Your conversion jobs by outcome</p>
                </div>
              </div>
              <Link to="/conversions" className="ud-insight-manage">
                View all →
              </Link>
            </div>
            <div className="ud-insight-body">
              {loading ? (
                <div className="ud-insight-skel-stack">
                  {[1, 2, 3].map((k) => (
                    <div key={k} className="ds-skel ds-skel--sm" style={{ height: 28 }} />
                  ))}
                </div>
              ) : (
                <ul className="ud-insight-tts-list">
                  {jobStatusRows.map((row) => (
                    <li key={row.name} className="ud-insight-tts-row">
                      <div className="ud-insight-tts-info">
                        <span className="ud-insight-tts-name">{row.name}</span>
                        <span className="ud-insight-tts-meta">{row.count} jobs</span>
                      </div>
                      <div className="ud-insight-tts-bar-wrap">
                        <div
                          className="ud-insight-tts-bar"
                          style={{ width: `${(row.count / breakdown.max) * 100}%`, background: row.color }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {showAi && (
          <div className="ud-insight-card ud-insight-card--ai-config">
            <div className="ud-insight-head">
              <div className="ud-insight-head-left">
                <span className="ud-insight-icon ud-insight-icon--indigo">
                  <Cpu size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="ud-insight-title">AI config</h2>
                  <p className="ud-insight-sub">Your active AI settings</p>
                </div>
              </div>
              <Link to="/ai-config" className="ud-insight-manage">
                Edit →
              </Link>
            </div>
            <div className="ud-insight-body">
              {aiConfigQuery.isLoading ? (
                <div className="ud-insight-skel-stack">
                  {[1, 2, 3].map((k) => (
                    <div key={k} className="ds-skel ds-skel--sm" style={{ height: 28 }} />
                  ))}
                </div>
              ) : (
                <ul className="ud-insight-ai-list">
                  <li className="ud-insight-ai-row">
                    <Cpu size={16} className="ud-insight-ai-ic" aria-hidden />
                    <span className="ud-insight-ai-k">AI model</span>
                    <span className="ud-insight-ai-v">{aiCfg?.modelName ?? '—'}</span>
                  </li>
                  <li className="ud-insight-ai-row">
                    <Eye size={16} className="ud-insight-ai-ic" aria-hidden />
                    <span className="ud-insight-ai-k">Status</span>
                    <span className="ud-insight-ai-v">{aiCfg?.isActive !== false ? 'Active' : 'Inactive'}</span>
                  </li>
                  <li className="ud-insight-ai-row">
                    <Settings size={16} className="ud-insight-ai-ic" aria-hidden />
                    <span className="ud-insight-ai-k">Description</span>
                    <span className="ud-insight-ai-v ud-insight-ai-v--muted">
                      {aiCfg?.description ? String(aiCfg.description).slice(0, 48) : 'Default workspace'}
                    </span>
                  </li>
                </ul>
              )}
              <Link to="/ai-config" className="ud-insight-ai-cta">
                <Settings size={16} aria-hidden />
                Edit AI configuration
              </Link>
            </div>
          </div>
          )}
        </div>
      </section>

      {/* Bottom row: recent activity + needs attention */}
      <div className="ud-split">
        <div className="ud-split-card ud-split-card--recent">
          <RecentActivityPanel
            loading={loading}
            refreshing={refreshing}
            recentJobs={recentJobs}
            onRefresh={loadData}
          />
        </div>

        <aside className="ud-aside ud-split-card ud-split-card--attention">
          <div className="ud-insight-card ud-insight-card--attention">
            <div className="ud-insight-head">
              <div className="ud-insight-head-left">
                <span className="ud-insight-icon ud-insight-icon--amber">
                  <AlertTriangle size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="ud-insight-title">Needs attention</h2>
                  <p className="ud-insight-sub">Jobs requiring your action</p>
                </div>
              </div>
              {loading ? (
                <div className="ds-skel ds-skel--pill" style={{ width: 72 }} />
              ) : (
                <span className="ud-insight-badge ud-insight-badge--red">
                  {attentionJobs.length} {attentionJobs.length === 1 ? 'issue' : 'issues'}
                </span>
              )}
            </div>
            <div className="ud-insight-body">
              {loading ? (
                <div className="ud-insight-skel-stack">
                  {[1, 2].map((k) => (
                    <div key={k} className="ud-insight-attn-row ud-insight-attn-row--skel">
                      <div className="ds-skel ds-skel--md" />
                      <div className="ds-skel ds-skel--sm" />
                    </div>
                  ))}
                </div>
              ) : attentionJobs.length === 0 ? (
                <p className="ud-insight-empty">All clear — nothing needs action right now.</p>
              ) : (
                <ul className="ud-insight-attn-list">
                  {attentionJobs.map((job) => {
                    const id = job.id;
                    const isFxl = job.jobType === 'FXL';
                    const canRetry = job.status === 'FAILED' && !isFxl;
                    const pillClass =
                      job.status === 'FAILED'
                        ? 'ud-pill ud-pill--failed'
                        : job.status === 'IN_PROGRESS' || job.status === 'PROCESSING'
                          ? 'ud-pill ud-pill--progress'
                          : 'ud-pill ud-pill--queued';
                    const pillText =
                      job.status === 'IN_PROGRESS' || job.status === 'PROCESSING'
                        ? 'IN PROGRESS'
                        : job.status === 'FAILED'
                          ? 'FAILED'
                          : job.status === 'QUEUED' || job.status === 'PENDING'
                            ? 'QUEUED'
                            : job.status;
                    return (
                      <li key={`${job.jobType || 'job'}-${id}`} className="ud-insight-attn-item">
                        <div className="ud-insight-attn-main">
                          <span className="ud-insight-attn-name">{jobTitle(job)}</span>
                          <span className="ud-insight-attn-meta">{jobStageLine(job)}</span>
                        </div>
                        <span className={pillClass}>{pillText}</span>
                        <div className="ud-insight-attn-actions">
                          {canRetry ? (
                            <button
                              type="button"
                              className="ud-insight-linkbtn"
                              disabled={retryingId === id}
                              onClick={() => handleRetryJob(id)}
                            >
                              <RefreshCw size={14} aria-hidden />
                              {retryingId === id ? 'Retrying…' : 'Retry'}
                            </button>
                          ) : (
                            <Link to="/conversions" className="ud-insight-linkbtn">
                              <ExternalLink size={14} aria-hidden />
                              Open
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
      </>
      )}

      </div>
      </MainContent>

      <QuickActionsFab actions={quickActions} />
    </div>
  );
}
