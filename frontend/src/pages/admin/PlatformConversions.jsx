import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Download,
  Square,
  LayoutGrid,
  List,
  FileText,
  Loader2,
} from 'lucide-react';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { adminService } from '../../services/adminService';
import { conversionService } from '../../services/conversionService';
import { queryKeys } from '../../lib/queryKeys';
import './PlatformConversions.css';

const MAX_RETRIES = 3;

const ACTIVE = new Set(['IN_PROGRESS', 'PENDING', 'PROCESSING']);

function escapeCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function formatFullDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function durationSeconds(job) {
  const start = job.createdAt ? new Date(job.createdAt).getTime() : NaN;
  const end = job.completedAt ? new Date(job.completedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const sec = (end - start) / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 120) return `${Math.round(sec)}s`;
  return `${(sec / 60).toFixed(1)}m`;
}

function etaHint(job) {
  const pct = Math.min(99, Math.max(0, Number(job.progressPercentage) || 0));
  if (pct < 5) return null;
  const start = job.createdAt ? new Date(job.createdAt).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  const elapsed = Date.now() - start;
  if (elapsed < 500) return null;
  const estTotal = elapsed / (pct / 100);
  const left = Math.max(0, estTotal - elapsed);
  if (left < 1500) return '~1s left';
  if (left < 60000) return `~${Math.round(left / 1000)}s left`;
  return `~${Math.round(left / 60000)}m left`;
}

function jobIdOf(job) {
  return job.id ?? job.jobId;
}

function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase();
  if (s === 'COMPLETED') {
    return (
      <span className="pcv-status-badge pcv-status-badge--completed">
        <CheckCircle2 size={12} aria-hidden />
        Completed
      </span>
    );
  }
  if (s === 'FAILED') {
    return (
      <span className="pcv-status-badge pcv-status-badge--failed">
        <XCircle size={12} aria-hidden />
        Failed
      </span>
    );
  }
  if (ACTIVE.has(s)) {
    return (
      <span className="pcv-status-badge pcv-status-badge--processing">
        <Clock size={12} aria-hidden />
        Processing
      </span>
    );
  }
  if (s === 'CANCELLED') {
    return (
      <span className="pcv-status-badge pcv-status-badge--cancelled">
        <XCircle size={12} aria-hidden />
        Cancelled
      </span>
    );
  }
  return (
    <span className="pcv-status-badge pcv-status-badge--cancelled">{s.replace(/_/g, ' ') || '—'}</span>
  );
}

function StatCard({ icon: Icon, iconTone, label, value, hint, hintTone = 'muted' }) {
  return (
    <div className="pcv-stat">
      <div className={`pcv-stat-icon pcv-stat-icon--${iconTone}`} aria-hidden>
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="pcv-stat-body">
        <div className="pcv-stat-label">{label}</div>
        <div className="pcv-stat-value">{value}</div>
        {hint != null && hint !== '' && (
          <div className={`pcv-stat-hint pcv-stat-hint--${hintTone}`}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function JobCardView({ job, onDownload, onRetry, onStop, onDetails, busyId, downloadBusy }) {
  const id = jobIdOf(job);
  const sid = id != null ? String(id) : '';
  const busy = busyId != null && String(busyId) === sid;
  const dlBusy = downloadBusy != null && String(downloadBusy) === sid;
  const status = String(job.status || '').toUpperCase();
  const isActive = ACTIVE.has(status);
  const isFailed = status === 'FAILED';
  const isDone = status === 'COMPLETED';
  const pct = Math.min(100, Math.max(0, Number(job.progressPercentage) || 0));
  const retryCount = job.retryCount ?? 0;
  const canRetry = retryCount < MAX_RETRIES;
  const pages = job.totalPages != null ? `${job.totalPages} pages` : '—';

  return (
    <article className={`pcv-card${isActive ? ' pcv-card--processing' : ''}`}>
      <div className="pcv-card-top">
        <span className="pcv-card-jobid">#{typeof id === 'string' ? id : `JOB-${id}`}</span>
        <StatusBadge status={job.status} />
      </div>

      <div className="pcv-file-row">
        <FileText className="pcv-file-icon" size={22} strokeWidth={2} aria-hidden />
        <div>
          <div className="pcv-file-name">{job.pdfFilename || `PDF #${job.pdfDocumentId ?? job.pdfId ?? '—'}`}</div>
          <div className="pcv-file-pages">{pages}</div>
        </div>
      </div>

      <div className="pcv-meta-grid">
        <div>
          <span className="pcv-meta-k">Organization</span>
          <span className="pcv-meta-v">{job.organizationName || '—'}</span>
        </div>
        <div>
          <span className="pcv-meta-k">User</span>
          <span className="pcv-meta-v">{job.userEmail || job.userName || '—'}</span>
        </div>
        <div>
          <span className="pcv-meta-k">{isDone ? 'Duration' : isActive ? 'Started' : 'Outcome'}</span>
          <span className={`pcv-meta-v${isDone ? ' pcv-meta-v--green' : ''}`}>
            {isDone
              ? durationSeconds(job) || '—'
              : isActive
                ? formatShortDate(job.createdAt || job.updatedAt)
                : String(job.status || '').replace(/_/g, ' ')}
          </span>
        </div>
        <div>
          <span className="pcv-meta-k">Date</span>
          <span className="pcv-meta-v">{formatFullDate(job.createdAt)}</span>
        </div>
      </div>

      {isFailed && job.errorMessage && <div className="pcv-err-box">{job.errorMessage}</div>}

      {isActive && (
        <div className="pcv-progress-wrap">
          <div className="pcv-progress-bar">
            <div className="pcv-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="pcv-progress-row">
            <span>Converting… {Math.round(pct)}%</span>
            <span>{etaHint(job) || ''}</span>
          </div>
        </div>
      )}

      <div className="pcv-card-actions">
        {isDone && (
          <button
            type="button"
            className="pcv-card-btn pcv-card-btn--primary"
            disabled={dlBusy}
            onClick={() => onDownload(job)}
          >
            {dlBusy ? <Loader2 size={14} className="pcv-btn-spinner" aria-hidden /> : <Download size={14} aria-hidden />}
            Download
          </button>
        )}
        {isFailed && (
          <button
            type="button"
            className="pcv-card-btn pcv-card-btn--danger"
            disabled={!canRetry || busy}
            onClick={() => onRetry(job)}
          >
            <RefreshCw size={14} aria-hidden />
            Retry job
          </button>
        )}
        {isActive && (
          <button type="button" className="pcv-card-btn pcv-card-btn--danger" disabled={busy} onClick={() => onStop(job)}>
            <Square size={14} aria-hidden />
            Cancel
          </button>
        )}
        <button
          type="button"
          className={`pcv-card-btn${isDone || isFailed || isActive ? '' : ' pcv-card-btn--span2'}`}
          onClick={() => onDetails(job)}
        >
          Details
        </button>
      </div>
    </article>
  );
}

export default function PlatformConversions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { allJobs, isLoading, error: fetchError } = useConversionsQuery({ enabled: true });
  const [orgFilter, setOrgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards');
  const [pageError, setPageError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [downloadBusy, setDownloadBusy] = useState(null);

  const orgsQuery = useQuery({
    queryKey: ['admin', 'organizations', 'platform-conversions'],
    queryFn: () => adminService.getOrganizations(),
    staleTime: 60 * 1000,
  });

  const organizations = Array.isArray(orgsQuery.data) ? orgsQuery.data : [];

  const orgNameById = useMemo(() => {
    const m = new Map();
    organizations.forEach((o) => {
      if (o?.id != null) m.set(Number(o.id), o.name || `Org #${o.id}`);
    });
    return m;
  }, [organizations]);

  const enrichedJobs = useMemo(() => {
    return (Array.isArray(allJobs) ? allJobs : []).map((j) => {
      const oid = j.organizationId != null ? Number(j.organizationId) : null;
      const fromOrg = oid != null ? orgNameById.get(oid) : null;
      return {
        ...j,
        organizationName: j.organizationName || fromOrg || (oid != null ? `Org #${oid}` : null),
      };
    });
  }, [allJobs, orgNameById]);

  const orgOptions = useMemo(() => {
    const names = new Set();
    enrichedJobs.forEach((j) => {
      const n = j.organizationName;
      if (n) names.add(n);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [enrichedJobs]);

  const filteredJobs = useMemo(() => {
    let list = [...enrichedJobs].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
    if (orgFilter) {
      list = list.filter((j) => (j.organizationName || '') === orgFilter);
    }
    if (statusFilter === 'all') return list;
    if (statusFilter === 'processing') {
      return list.filter((j) => ACTIVE.has(String(j.status || '').toUpperCase()));
    }
    return list.filter((j) => String(j.status || '').toUpperCase() === statusFilter);
  }, [enrichedJobs, orgFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = filteredJobs.length;
    const completed = filteredJobs.filter((j) => String(j.status || '').toUpperCase() === 'COMPLETED').length;
    const failed = filteredJobs.filter((j) => String(j.status || '').toUpperCase() === 'FAILED').length;
    const processing = filteredJobs.filter((j) => ACTIVE.has(String(j.status || '').toUpperCase())).length;
    const denom = completed + failed;
    const okPct = denom > 0 ? Math.round((completed / denom) * 1000) / 10 : null;
    const badPct = denom > 0 ? Math.round((failed / denom) * 1000) / 10 : null;
    return { total, completed, failed, processing, okPct, badPct };
  }, [filteredJobs]);

  const onDetails = useCallback(
    (job) => {
      const id = jobIdOf(job);
      if (id != null) navigate(`/admin/conversions/job/${id}`);
    },
    [navigate],
  );

  const invalidateJobs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversions.list() });
  }, [queryClient]);

  const retryMutation = useMutation({
    mutationFn: (jobId) => conversionService.retryConversion(jobId),
    onMutate: (jobId) => setBusyId(jobId != null ? String(jobId) : null),
    onSettled: () => setBusyId(null),
    onSuccess: () => {
      setPageError('');
      invalidateJobs();
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message || 'Retry failed');
    },
  });

  const stopMutation = useMutation({
    mutationFn: (jobId) => conversionService.stopConversion(jobId),
    onMutate: (jobId) => setBusyId(jobId != null ? String(jobId) : null),
    onSettled: () => setBusyId(null),
    onSuccess: () => {
      setPageError('');
      invalidateJobs();
    },
    onError: (e) => {
      setPageError(e.response?.data?.error || e.message || 'Cancel failed');
    },
  });

  const onRetry = (job) => {
    const id = jobIdOf(job);
    if (id == null) return;
    retryMutation.mutate(id);
  };

  const onStop = (job) => {
    const id = jobIdOf(job);
    if (id == null) return;
    stopMutation.mutate(id);
  };

  const onDownload = async (job) => {
    const id = jobIdOf(job);
    if (id == null) return;
    setPageError('');
    setDownloadBusy(String(id));
    try {
      await conversionService.downloadEpub(id, { jobType: job.jobType });
    } catch (e) {
      setPageError(e.response?.data?.error || e.message || 'Download failed');
    } finally {
      setDownloadBusy(null);
    }
  };

  const exportCsv = useCallback(() => {
    const header = [
      'Job ID',
      'Status',
      'PDF',
      'Pages',
      'Organization',
      'User',
      'Created',
      'Error',
    ]
      .map(escapeCsvCell)
      .join(',');
    const lines = filteredJobs.map((job) =>
      [
        jobIdOf(job),
        job.status,
        job.pdfFilename ?? '',
        job.totalPages ?? '',
        job.organizationName ?? '',
        job.userEmail ?? '',
        job.createdAt ? new Date(job.createdAt).toLocaleString() : '',
        job.errorMessage ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    );
    const blob = new Blob([[header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-conversions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredJobs]);

  const errMsg = fetchError || pageError;

  if (isLoading) {
    return (
      <div className="pcv-root">
        <div className="pcv-inner pcv-loading">
          <div className="pcv-spinner" aria-hidden />
          Loading conversions…
        </div>
      </div>
    );
  }

  return (
    <div className="pcv-root">
      <div className="pcv-inner">
        <header className="pcv-head">
          <div className="pcv-head-text">
            <h1 className="pcv-title">Conversions</h1>
            <p className="pcv-sub">Track all PDF-to-EPUB conversion jobs across the platform.</p>
          </div>
          <div className="pcv-toolbar">
            <select className="pcv-select" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} aria-label="Organization">
              <option value="">All organizations</option>
              {orgOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select className="pcv-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="all">All statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="processing">Processing</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <button type="button" className="pcv-btn-export" onClick={exportCsv}>
              <Download size={16} aria-hidden />
              Export
            </button>
          </div>
        </header>

        {errMsg ? <div className="pcv-err">{errMsg}</div> : null}

        <section className="pcv-stats" aria-label="Summary statistics">
          <StatCard
            icon={RefreshCw}
            iconTone="blue"
            label="Total jobs"
            value={stats.total}
            hint="All time (this view)"
            hintTone="muted"
          />
          <StatCard
            icon={CheckCircle2}
            iconTone="green"
            label="Completed"
            value={stats.completed}
            hint={stats.okPct != null ? `~ ${stats.okPct}% rate` : '—'}
            hintTone="green"
          />
          <StatCard
            icon={Clock}
            iconTone="amber"
            label="Processing"
            value={stats.processing}
            hint={stats.processing === 0 ? 'Queue clear' : 'In progress'}
            hintTone={stats.processing === 0 ? 'green' : 'muted'}
          />
          <StatCard
            icon={XCircle}
            iconTone="red"
            label="Failed"
            value={stats.failed}
            hint={stats.badPct != null ? `~ ${stats.badPct}% error` : '—'}
            hintTone="red"
          />
        </section>

        <section className="pcv-panel" aria-label="Conversion jobs">
          <div className="pcv-panel-head">
            <div className="pcv-panel-title-row">
              <h2 className="pcv-panel-title">Conversion jobs</h2>
              <span className="pcv-badge-count">{filteredJobs.length} total</span>
            </div>
            <div className="pcv-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`pcv-view-btn${viewMode === 'cards' ? ' pcv-view-btn--active' : ''}`}
                onClick={() => setViewMode('cards')}
              >
                <LayoutGrid size={16} aria-hidden />
                Card view
              </button>
              <button
                type="button"
                className={`pcv-view-btn${viewMode === 'list' ? ' pcv-view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List size={16} aria-hidden />
                List view
              </button>
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="pcv-empty">No conversion jobs match the current filters.</div>
          ) : viewMode === 'cards' ? (
            <div className="pcv-grid">
              {filteredJobs.map((job) => (
                <JobCardView
                  key={`${job.jobType ?? 'job'}-${jobIdOf(job)}`}
                  job={job}
                  onDownload={onDownload}
                  onRetry={onRetry}
                  onStop={onStop}
                  onDetails={onDetails}
                  busyId={busyId}
                  downloadBusy={downloadBusy}
                />
              ))}
            </div>
          ) : (
            <div className="pcv-table-wrap">
              <table className="pcv-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>File</th>
                    <th>Organization</th>
                    <th>User</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const id = jobIdOf(job);
                    const sid = id != null ? String(id) : '';
                    const st = String(job.status || '').toUpperCase();
                    const pct = Math.min(100, Math.max(0, Number(job.progressPercentage) || 0));
                    return (
                      <tr key={`${job.jobType ?? 'job'}-${sid}`}>
                        <td>#{sid}</td>
                        <td>
                          <StatusBadge status={job.status} />
                        </td>
                        <td>{job.pdfFilename || '—'}</td>
                        <td>{job.organizationName || '—'}</td>
                        <td>{job.userEmail || '—'}</td>
                        <td>{ACTIVE.has(st) ? `${Math.round(pct)}%` : '—'}</td>
                        <td>{formatFullDate(job.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="pcv-card-btn pcv-card-btn--primary"
                            style={{ marginRight: 6 }}
                            onClick={() => {
                              const jid = jobIdOf(job);
                              if (jid != null) navigate(`/admin/conversions/job/${jid}`);
                            }}
                          >
                            Details
                          </button>
                          {st === 'COMPLETED' && (
                            <button type="button" className="pcv-card-btn" onClick={() => onDownload(job)}>
                              Download
                            </button>
                          )}
                          {st === 'FAILED' && (
                            <button
                              type="button"
                              className="pcv-card-btn pcv-card-btn--danger"
                              disabled={(job.retryCount ?? 0) >= MAX_RETRIES || busyId === sid}
                              onClick={() => onRetry(job)}
                            >
                              Retry
                            </button>
                          )}
                          {ACTIVE.has(st) && (
                            <button
                              type="button"
                              className="pcv-card-btn pcv-card-btn--danger"
                              disabled={busyId === sid}
                              onClick={() => onStop(job)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
