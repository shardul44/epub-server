import { useEffect, useState, useCallback, memo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { useListScope } from '../../context/ListScopeContext';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { useConversionActions, resolveJobType, isFixedLayout } from '../../hooks/useConversionActions';
import useAppDispatch from '../../hooks/useAppDispatch';
import useAppSelector from '../../hooks/useAppSelector';
import {
  selectFocusedJobId,
  selectViewMode,
  selectStatusFilter,
  selectActionError,
  setFocusedJobId,
  setViewMode,
  setStatusFilter,
  clearActionError,
} from '../../features/conversions/conversionsSlice';
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
    // Resolved dynamically in handleFocusNavigate based on job type
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
                  {isFixedLayout(job) ? 'Open with Zones →' : 'Open Editor →'}
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
  const isFxl      = isFixedLayout(job);
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
              {isFxl ? 'Open with Zones →' : 'Open Editor →'}
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
  const location = useLocation();
  const dispatch = useAppDispatch();
  const listScope = useListScope();

  // ── Redux UI state ────────────────────────────────────────────
  const focusedJobId   = useAppSelector(selectFocusedJobId);
  const viewMode       = useAppSelector(selectViewMode);
  const statusFilter   = useAppSelector(selectStatusFilter);
  const actionError    = useAppSelector(selectActionError);

  // ── Local UI state (ephemeral — not worth persisting) ─────────
  const [deleteModal, setDeleteModal] = useState({ open: false, job: null, loading: false });

  // ── React Query (server state) ────────────────────────────────
  const { jobs, isPending, isLoading: loading, error: pollError, refresh } = useConversionsQuery({
    statusFilter,
    excludeEpubImports: true,
  });

  // If another page redirects here (e.g. editor opened while job is still running),
  // focus that job and switch filter to show the converting job.
  useEffect(() => {
    const focusJobId = location.state?.focusJobId;
    if (!focusJobId) return;

    dispatch(setFocusedJobId(String(focusJobId)));
    // Make sure the converting job is visible
    dispatch(setStatusFilter('all'));

    // Clear navigation state to avoid re-trigger on refresh/back
    navigate(location.pathname, { replace: true, state: null });
  }, [dispatch, location.pathname, location.state, navigate]);

  // ── Action hook (delete / stop / retry / navigate) ────────────
  const {
    prepareDelete,
    confirmDelete: runConfirmDelete,
    handleStop,
    handleRetry,
    handleOpenEditor,
    handleFocusNavigate,
  } = useConversionActions();

  // Derive the focused job object from the Redux-stored ID
  const focusedJob = focusedJobId
    ? jobs.find(j => String(j.id ?? j.jobId) === String(focusedJobId)) ?? null
    : null;

  /* auto-focus first completed job (only if nothing is focused yet) */
  useEffect(() => {
    if (focusedJobId) return;
    const first = jobs.find(j => j.status === 'COMPLETED');
    if (first) dispatch(setFocusedJobId(String(first.id ?? first.jobId)));
  }, [jobs, focusedJobId, dispatch]);

  /* ── Delete flow ── */
  const handleDelete = useCallback((job) => {
    prepareDelete(job);
    setDeleteModal({ open: true, job, loading: false });
  }, [prepareDelete]);

  const confirmDelete = useCallback(async () => {
    setDeleteModal(prev => ({ ...prev, loading: true }));
    const ok = await runConfirmDelete();
    if (ok) {
      dispatch(setFocusedJobId(null));
      setDeleteModal({ open: false, job: null, loading: false });
    } else {
      setDeleteModal(prev => ({ ...prev, loading: false }));
    }
  }, [runConfirmDelete, dispatch]);

  const handleStepClick = useCallback((step) => navigate(step.path), [navigate]);

  /* ── derived counts ── */
  const completedCount = jobs.filter(j => j.status === 'COMPLETED').length;
  const runningCount   = jobs.filter(j => j.status === 'IN_PROGRESS').length;
  const displayError   = actionError || pollError;

  /* ── render ── */
  if (isPending && jobs.length === 0) {
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
            onChange={e => dispatch(setStatusFilter(e.target.value))}
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
              onClick={() => dispatch(setViewMode('card'))}
              title="Card view"
              aria-pressed={viewMode === 'card'}
            >
              <LayoutGrid size={15} /> Card
            </button>
            <button
              className={`cj-view-btn ${viewMode === 'list' ? 'cj-view-btn--on' : ''}`}
              onClick={() => dispatch(setViewMode('list'))}
              title="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List size={15} /> List
            </button>
          </div>
        </div>
      </header>

      {/* ── Workflow stepper (shared component) ── */}
      <WorkflowStepper
        activeStep={0}
        jobId={focusedJob ? String(focusedJob.id ?? focusedJob.jobId) : null}
        job={focusedJob}
        onStepClick={handleStepClick}
      />

      {/* ── Page body ── */}
      <div className="cj-body">

        {/* ── Alerts ── */}
        {displayError && (
          <div className="cj-alert cj-alert--error">
            {displayError}
            <button className="cj-alert-close" onClick={() => dispatch(clearActionError())}><X size={14} /></button>
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
          onDismiss={() => dispatch(setFocusedJobId(null))}
          onNavigate={handleFocusNavigate}
        />

        {/* ── Job list ── */}
        <div className="cj-list-header">
          <span className="cj-list-label">
            {listScope === 'own' ? 'YOUR JOBS' : 'ALL JOBS'} · {jobs.length}
          </span>
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
                onSelect={(j) => dispatch(setFocusedJobId(String(j.id ?? j.jobId)))}
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
