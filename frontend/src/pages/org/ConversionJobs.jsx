import { useEffect, useState, useCallback, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { conversionApi, apiClient } from '../../api';
import WorkflowStepper from '../../components/WorkflowStepper';
import {
  LayoutGrid,
  List,
  Trash2,
  Image,
  X,
  FileText,
  CheckCircle2,
  Mic2,
} from 'lucide-react';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import JobCard, { JobGrid } from '../../components/JobCard';
import ConfirmModal from '../../components/Loadingmodal';
import './ConversionJobs.css';

/* ─── Constants ───────────────────────────────────────────────── */
const MAX_RETRIES = 3;

/* ─── Helpers ─────────────────────────────────────────────────── */
const STATUS_CLASS = {
  PENDING:     'cj-badge--info',
  IN_PROGRESS: 'cj-badge--warning',
  COMPLETED:   'cj-badge--success',
  FAILED:      'cj-badge--danger',
  CANCELLED:   'cj-badge--danger',
};

const fmtDate = (d) => d ? new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
const fmtStep = (s) => s ? String(s).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '';

/** Normalize API job type for routing (REFLOW vs FXL). */
const resolveJobType = (job) => {
  const t = job?.jobType ?? job?.type;
  if (t === 'FXL') return 'FXL';
  if (t === 'REFLOW' || t === 'REFLOWABLE') return 'REFLOW';
  return typeof t === 'string' ? t : null;
};

/* ─── FocusedJobBanner ────────────────────────────────────────── */
const PANEL_STEPS = [
  {
    icon: <CheckCircle2 size={26} />,
    name: 'Conversion',
    desc: 'Your PDF was successfully converted to EPUB format at 100%.',
    cta: 'View job details',
    path: '/conversions',
  },
  {
    icon: <Image size={26} />,
    name: 'Image Editor / FXL Studio',
    desc: 'Review zones, fix layout, and edit images in your converted file.',
    cta: 'Open Image Editor',
    path: '/conversions/fxl-editor',
  },
  {
    icon: <Mic2 size={26} />,
    name: 'Audio Sync Studio',
    desc: 'Add narration, sync audio to text, and create an immersive read.',
    cta: 'Audio Sync Studio',
    path: '/conversions/audio-sync',
  },
];

const FocusedJobBanner = memo(({ job, onDismiss, onNavigate }) => {
  if (!job) return null;
  const jobId = job.id ?? job.jobId;

  return (
    <div className="cj-banner">
      <button className="cj-banner-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>

      <div className="cj-banner-head">
        <span className="cj-banner-doc-icon"><FileText size={20} /></span>
        <div>
          <div className="cj-banner-title">Job #{jobId} — Conversion complete</div>
          <div className="cj-banner-meta">
            <span>📄 PDF ID: {job.pdfDocumentId ?? job.pdfId}</span>
            <span>⊙ {job.jobType === 'FXL' ? 'FXL layout' : 'Reflow layout'}</span>
            {job.updatedAt && <span>🕐 Updated {fmtDate(job.updatedAt)}</span>}
            <span className="cj-banner-done">✓ 100% done</span>
          </div>
        </div>
      </div>

      <div className="cj-banner-prompt">WHAT TO DO NEXT WITH THIS JOB</div>

      <div className="cj-banner-panels">
        {PANEL_STEPS.map((ps, idx) => {
          const isDone    = idx === 0;
          const isCurrent = idx === 1;
          const isLocked  = idx === 2;
          return (
            <div
              key={ps.name}
              className={[
                'cj-panel',
                isDone    ? 'cj-panel--done'    : '',
                isCurrent ? 'cj-panel--current' : '',
                isLocked  ? 'cj-panel--locked'  : '',
              ].filter(Boolean).join(' ')}
            >
              {isDone    && <span className="cj-panel-tag cj-tag-done">✓ STEP {idx + 1} — DONE</span>}
              {isCurrent && <span className="cj-panel-tag cj-tag-now">STEP {idx + 1} — DO THIS NOW</span>}
              {isLocked  && <span className="cj-panel-tag cj-tag-locked">⏱ After previous step</span>}

              <div className="cj-panel-icon">{ps.icon}</div>
              <div className="cj-panel-name">{ps.name}</div>
              <div className="cj-panel-desc">{ps.desc}</div>

              {isDone && (
                <button className="cj-panel-cta cj-panel-cta--outline" onClick={() => onNavigate(ps.path, job)}>
                  {ps.cta}
                </button>
              )}
              {isCurrent && (
                <button
                  type="button"
                  className="cj-panel-cta cj-panel-cta--primary"
                  onClick={() => onNavigate(ps.path, job)}
                >
                  {resolveJobType(job) === 'FXL' ? 'Open FXL Studio' : 'Open Image Editor'} →
                </button>
              )}
              {isLocked && (
                <button className="cj-panel-cta cj-panel-cta--locked" disabled>
                  {ps.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
FocusedJobBanner.displayName = 'FocusedJobBanner';

/* ─── List row ────────────────────────────────────────────────── */
const JobRow = memo(({ job, onDelete, onStop, onRetry, onOpenEditor }) => {
  const jobId      = job.id ?? job.jobId;
  const pct        = job.progressPercentage ?? 0;
  const isFxl      = resolveJobType(job) === 'FXL';
  const retryCount = job.retryCount ?? 0;
  const canRetry   = retryCount < MAX_RETRIES;

  return (
    <tr className={job.status === 'IN_PROGRESS' ? 'cj-row--running' : ''}>
      <td>
        <div className="cj-row-id">
          <span className="cj-row-num">#{jobId}</span>
          <span className={`cj-type-pill ${isFxl ? 'cj-type-fxl' : 'cj-type-reflow'}`}>
            {isFxl ? 'FXL' : 'Reflow'}
          </span>
        </div>
      </td>
      <td className="cj-row-pdf">{job.pdfFilename || (job.pdfDocumentId ?? job.pdfId)}</td>
      <td>
        <span className={`cj-status-pill ${STATUS_CLASS[job.status] ?? 'cj-badge--info'}`}>
          {job.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td>
        <div className="cj-row-prog">
          <div className="cj-progress-track">
            <div className="cj-progress-fill" style={{
              width: `${pct}%`,
              background: job.status === 'COMPLETED' ? '#22c55e' : '#2563eb',
            }} />
          </div>
          <span className="cj-row-pct">{pct}%</span>
        </div>
      </td>
      <td className="cj-row-step">{fmtStep(job.currentStep)}</td>
      <td className="cj-row-error" title={job.errorMessage || ''}>
        {job.status === 'FAILED' && job.errorMessage
          ? <span className="cj-error-text">⚠ {job.errorMessage}</span>
          : '—'}
      </td>
      <td className="cj-row-date">{job.createdAt ? new Date(job.createdAt).toLocaleDateString() : '—'}</td>
      <td>
        <div className="cj-row-actions">
          {job.status === 'COMPLETED' && (
            <button
              type="button"
              className="cj-btn cj-btn-primary cj-btn-sm"
              onClick={() => onOpenEditor(job)}
            >
              <Image size={12} />
              {isFxl ? 'Open FXL Studio' : 'Open Image Editor'}
            </button>
          )}
          {job.status === 'IN_PROGRESS' && !isFxl && (
            <button className="cj-btn cj-btn-stop cj-btn-sm" onClick={() => onStop(jobId)}>Stop</button>
          )}
          {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
            <button
              className="cj-btn cj-btn-primary cj-btn-sm"
              onClick={() => onRetry(jobId)}
              disabled={!canRetry}
              title={!canRetry ? `Max retries (${MAX_RETRIES}) reached` : undefined}
            >
              Retry{retryCount > 0 ? ` (${retryCount}/${MAX_RETRIES})` : ''}
            </button>
          )}
          <button className="cj-btn cj-btn-del cj-btn-sm" onClick={() => onDelete(job)}>
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
});
JobRow.displayName = 'JobRow';

/* ─── Main page ───────────────────────────────────────────────── */
const ConversionJobs = () => {
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode]         = useState('card');
  const [focusedJob, setFocusedJob]     = useState(null);
  const [actionError, setActionError]   = useState('');
  const [deleteModal, setDeleteModal]   = useState({ open: false, job: null, loading: false });

  // ── React Query (replaces manual polling hook) ────────────────
  const { jobs, isLoading: loading, error: pollError, refresh } = useConversionsQuery({ statusFilter });

  /* auto-focus first completed job */
  useEffect(() => {
    setFocusedJob(prev => {
      if (prev) return prev;
      return jobs.find(j => j.status === 'COMPLETED') ?? null;
    });
  }, [jobs]);

  /* ── Stable action callbacks — prevent child re-renders ── */
  const handleDelete = useCallback((job) => {
    setDeleteModal({ open: true, job, loading: false });
  }, []);

  // Use a ref so confirmDelete always reads the latest deleteModal
  // without needing it as a dependency (which causes stale closure issues).
  const deleteModalRef = useRef(null);
  deleteModalRef.current = deleteModal;

  const confirmDelete = useCallback(async () => {
    const { job } = deleteModalRef.current;
    if (!job) return;
    const jobId = job.id ?? job.jobId;
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      setActionError('');
      if (job.jobType === 'FXL') {
        try {
          await apiClient.delete(`/kitaboo/jobs/${jobId}`);
        } catch (err) {
          if (err.response?.status === 404) {
            console.warn('ConversionJobs: FXL delete returned 404; treating as already removed.', jobId);
          } else {
            throw err;
          }
        }
      } else {
        await conversionApi.deleteConversionJob(jobId);
      }
      setFocusedJob(prev => prev && (prev.id ?? prev.jobId) === jobId ? null : prev);
      setDeleteModal({ open: false, job: null, loading: false });
      refresh();
    } catch (err) {
      setActionError(err.message || 'Failed to delete job');
      setDeleteModal({ open: false, job: null, loading: false });
    }
  }, [refresh]);

  const handleStop = useCallback(async (jobId) => {
    try {
      setActionError('');
      await conversionApi.stopConversion(jobId);
      refresh();
    } catch (err) { setActionError(err.message || 'Failed to stop'); }
  }, [refresh]);

  const handleRetry = useCallback(async (jobId) => {
    const job = jobs.find(j => String(j.id ?? j.jobId) === String(jobId));
    const jobType = resolveJobType(job);
    if (jobType === 'FXL') {
      // FXL jobs don't have a retry endpoint — navigate to PDFs to start a new conversion
      setTimeout(() => navigate('/pdfs'), 0);
      return;
    }
    try {
      setActionError('');
      await conversionApi.retryConversion(jobId);
      refresh();
    } catch (err) { setActionError(err.message || 'Failed to retry'); }
  }, [jobs, refresh, navigate]);

  const handleOpenEditor = useCallback((job) => {
    if (!job) {
      console.warn('ConversionJobs: no job selected for editor');
      return;
    }
    const jobId = job.id ?? job.jobId;
    const jobType = resolveJobType(job);
    if (!['REFLOW', 'FXL'].includes(jobType)) {
      console.error('ConversionJobs: unsupported job type for editor', jobType, job);
      return;
    }
    console.log('ConversionJobs: opening editor', { jobId, jobType });
    // Defer navigation out of the current React event/render cycle to avoid
    // "Cannot update a component while rendering a different component" errors.
    const path = jobType === 'REFLOW' ? `/image-editor/${jobId}` : `/fxl-studio/${jobId}`;
    setTimeout(() => navigate(path), 0);
  }, [navigate]);

  const handleFocusNavigate = useCallback((path, job) => {
    if (path === '/conversions/fxl-editor') {
      handleOpenEditor(job);
      return;
    }
    setTimeout(() => navigate(path, { state: { jobId: job.id ?? job.jobId } }), 0);
  }, [navigate, handleOpenEditor]);

  const handleStepClick = useCallback((step) => setTimeout(() => navigate(step.path), 0), [navigate]);

  /* ── derived counts ── */
  const completedCount = jobs.filter(j => j.status === 'COMPLETED').length;
  const runningCount   = jobs.filter(j => j.status === 'IN_PROGRESS').length;
  const displayError   = actionError || pollError;

  /* ── render ── */
  if (loading && jobs.length === 0) {
    return (
      <div className="cj-root">
        <div className="cj-loading">
          <div className="cj-spinner" />
          Loading conversion jobs…
        </div>
      </div>
    );
  }

  return (
    <div className="cj-root">

      {/* ── Sticky top header ── */}
      <header className="cj-topnav">
        <div className="cj-topnav-left">
          <h1 className="cj-topnav-title">Conversion Jobs</h1>
          {completedCount > 0 && (
            <span className="cj-topnav-badge">{completedCount} completed</span>
          )}
        </div>
        <div className="cj-topnav-right">
          <select
            className="cj-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <div className="cj-view-toggle" role="group" aria-label="View mode">
            <button
              className={`cj-view-btn ${viewMode === 'card' ? 'cj-view-btn--on' : ''}`}
              onClick={() => setViewMode('card')}
              title="Card view"
              aria-pressed={viewMode === 'card'}
            >
              <LayoutGrid size={15} /> Card
            </button>
            <button
              className={`cj-view-btn ${viewMode === 'list' ? 'cj-view-btn--on' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List size={15} /> List
            </button>
          </div>
        </div>
      </header>

      {/* ── Workflow stepper (shared component) ── */}
      <WorkflowStepper activeStep={0} onStepClick={handleStepClick} variant="cj" />

      {/* ── Page body ── */}
      <div className="cj-body">

        {/* ── Alerts ── */}
        {displayError && (
          <div className="cj-alert cj-alert--error">
            {displayError}
            <button className="cj-alert-close" onClick={() => setActionError('')}><X size={14} /></button>
          </div>
        )}
        {runningCount > 0 && (
          <div className="cj-alert cj-alert--running">
            <span className="cj-pulse-dot" />
            {runningCount} conversion job{runningCount > 1 ? 's' : ''} currently running
          </div>
        )}

        {/* ── Focused job banner ── */}
        <FocusedJobBanner
          job={focusedJob}
          onDismiss={() => setFocusedJob(null)}
          onNavigate={handleFocusNavigate}
        />

        {/* ── Job list ── */}
        <div className="cj-list-header">
          <span className="cj-list-label">ALL JOBS · {jobs.length}</span>
          {loading && <span className="cj-refreshing">Refreshing…</span>}
        </div>

        {jobs.length === 0 ? (
          <div className="cj-empty">
            <FileText size={40} />
            <p>No conversion jobs found</p>
            <button className="cj-btn cj-btn-primary" style={{ width: 'auto', marginTop: 8 }}
              onClick={() => navigate('/pdfs/upload')}>
              Upload a PDF to get started
            </button>
          </div>
        ) : viewMode === 'card' ? (
          <JobGrid>
            {jobs.map(job => (
              <JobCard
                key={`${job.jobType ?? 'REFLOW'}-${job.id ?? job.jobId}`}
                job={job}
                isSelected={focusedJob && (focusedJob.id ?? focusedJob.jobId) === (job.id ?? job.jobId)}
                onSelect={setFocusedJob}
                onDelete={handleDelete}
                onStop={handleStop}
                onRetry={handleRetry}
                onOpenEditor={handleOpenEditor}
              />
            ))}
          </JobGrid>
        ) : (
          <div className="cj-table-wrap">
            <table className="cj-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>PDF / Filename</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Current Step</th>
                  <th>Error</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <JobRow
                    key={`${job.jobType ?? 'REFLOW'}-${job.id ?? job.jobId}`}
                    job={job}
                    onDelete={handleDelete}
                    onStop={handleStop}
                    onRetry={handleRetry}
                    onOpenEditor={handleOpenEditor}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Delete confirmation modal ── */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, job: null, loading: false })}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message={
          deleteModal.job
            ? `Delete Job #${deleteModal.job.id ?? deleteModal.job.jobId}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteModal.loading}
      />
    </div>
  );
};

export default ConversionJobs;
