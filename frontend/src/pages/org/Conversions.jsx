import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { conversionService } from '../../services/conversionService';
import api from '../../services/api';
import {
  Check,
  ChevronRight,
  Circle,
  FileText,
  Grid2X2,
  Image,
  List,
  Lock,
  Music,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { mediaUrl } from '../../utils/mediaUrl';
import { useJobPolling } from '../../hooks/useJobPolling';
import ThumbnailImage from '../../components/ThumbnailImage';
import './Conversions.css';

/* ─── Constants ───────────────────────────────────────────────── */
const MAX_RETRIES = 3;

/* ─── Stepper config ──────────────────────────────────────────── */
const STEPS = [
  { key: 'jobs',     label: 'Conversion Jobs',          sub: 'PDF processed',       path: '/conversions' },
  { key: 'editor',  label: 'Image Editor & FXL Studio', sub: 'Edit zones & layout', path: '/conversions/fxl-editor' },
  { key: 'audio',   label: 'Audio Sync Studio',         sub: 'Add narration & sync', path: '/conversions/audio-sync' },
  { key: 'download',label: 'Download EPUB',             sub: 'Get your final file', path: '/conversions/download' },
];

/* ─── helpers ─────────────────────────────────────────────────── */
const getStatusBadge = (status) => ({
  PENDING:     'badge-info',
  IN_PROGRESS: 'badge-warning',
  COMPLETED:   'badge-success',
  FAILED:      'badge-danger',
  CANCELLED:   'badge-danger',
}[status] || 'badge-info');

const jobCurrentStep = (job) => {
  if (!job) return 0;
  if (job.status !== 'COMPLETED') return 0;
  if (job._uiStep !== undefined) return job._uiStep;
  return 1;
};

/* ─── WorkflowStepper ─────────────────────────────────────────── */
const WorkflowStepper = ({ activeStep, onStepClick }) => (
  <div className="cv-stepper">
    {STEPS.map((step, idx) => {
      const done   = idx < activeStep;
      const active = idx === activeStep;
      const locked = idx > activeStep;
      return (
        <button
          key={step.key}
          className={`cv-step ${done ? 'cv-step--done' : ''} ${active ? 'cv-step--active' : ''} ${locked ? 'cv-step--locked' : ''}`}
          onClick={() => !locked && onStepClick(step, idx)}
          disabled={locked}
          title={locked ? 'Complete previous steps first' : step.label}
        >
          <span className="cv-step-icon">
            {done ? <Check /> : locked ? <Lock /> : <span>{idx + 1}</span>}
          </span>
          <span className="cv-step-text">
            <span className="cv-step-label">{step.label}</span>
            <span className="cv-step-sub">{step.sub}</span>
          </span>
          {idx < STEPS.length - 1 && <ChevronRight className="cv-step-arrow" />}
        </button>
      );
    })}
  </div>
);

/* ─── FocusedJobBanner ────────────────────────────────────────── */
const FocusedJobBanner = ({ job, onDismiss, onNavigate }) => {
  if (!job) return null;
  const step = jobCurrentStep(job);
  return (
    <div className="cv-focus-banner">
      <button className="cv-focus-close" onClick={onDismiss} aria-label="Dismiss">×</button>
      <div className="cv-focus-header">
        <span className="cv-focus-title">Job #{job.id ?? job.jobId} — Conversion complete</span>
        <div className="cv-focus-meta">
          <span><FileText size={13} /> PDF ID: {job.pdfDocumentId ?? job.pdfId}</span>
          <span><Circle size={13} /> {job.jobType === 'FXL' ? 'FXL layout' : 'Reflow layout'}</span>
          {job.updatedAt && <span>🕐 Updated {new Date(job.updatedAt).toLocaleString()}</span>}
          <span className="cv-focus-done"><Check size={13} /> 100% done</span>
        </div>
      </div>
      <p className="cv-focus-prompt">WHAT TO DO NEXT WITH THIS JOB</p>
      <div className="cv-focus-steps">
        {STEPS.slice(0, 3).map((s, idx) => {
          const isDone    = idx < step + 1;
          const isCurrent = idx === step + 1;
          const isLocked  = idx > step + 1;
          return (
            <div
              key={s.key}
              className={`cv-focus-step ${isDone ? 'cv-focus-step--done' : ''} ${isCurrent ? 'cv-focus-step--current' : ''} ${isLocked ? 'cv-focus-step--locked' : ''}`}
            >
              {isDone    && <span className="cv-focus-step-tag cv-tag-done"><Check size={12} /> STEP {idx + 1} — DONE</span>}
              {isCurrent && <span className="cv-focus-step-tag cv-tag-now">STEP {idx + 1} — DO THIS NOW</span>}
              {isLocked  && <span className="cv-focus-step-tag cv-tag-locked"><Lock size={12} /> After previous step</span>}
              <div className="cv-focus-step-icon">
                {idx === 0 ? <Circle size={22} /> : idx === 1 ? <Image size={22} /> : <Music size={22} />}
              </div>
              <div className="cv-focus-step-name">{s.label}</div>
              <div className="cv-focus-step-desc">
                {idx === 0 && 'Your PDF was successfully converted to EPUB format at 100%.'}
                {idx === 1 && 'Review zones, fix layout, and edit images in your converted file.'}
                {idx === 2 && 'Add narration, sync audio to text, and create an immersive read.'}
              </div>
              {isCurrent && (
                <button className="cv-focus-cta" onClick={() => onNavigate(s.path, job)}>
                  Open {s.label} <ChevronRight size={14} />
                </button>
              )}
              {isLocked && (
                <button className="cv-focus-cta cv-focus-cta--locked" disabled>
                  {s.label}
                </button>
              )}
              {isDone && idx === 0 && (
                <button className="cv-focus-cta cv-focus-cta--outline" onClick={() => onNavigate(s.path, job)}>
                  View job details
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── JobCard ─────────────────────────────────────────────────── */
const JobCard = ({ job, onFocus, onDelete, onStop, onRetry, onImageEditor, navigate }) => {
  const jobId      = job.id ?? job.jobId;
  const retryCount = job.retryCount ?? 0;
  const canRetry   = retryCount < MAX_RETRIES;

  return (
    <div className={`cv-card ${job.status === 'IN_PROGRESS' ? 'cv-card--running' : ''}`}>
      {/* type + status badges */}
      <div className="cv-card-type-row">
        <span className={`cv-type-badge ${job.jobType === 'FXL' ? 'cv-type-fxl' : 'cv-type-reflow'}`}>
          {job.jobType === 'FXL' ? 'FXL' : 'REFLOW'}
        </span>
        <span className={`cv-status-badge ${getStatusBadge(job.status)}`}>
          {job.status === 'IN_PROGRESS' ? 'RUNNING' : job.status}
        </span>
      </div>

      {/* thumbnail */}
      <div className="cv-card-thumb">
        <ThumbnailImage
          pdfId={job.pdfDocumentId ?? job.pdfId}
          alt="PDF preview"
          fallback={<div className="cv-card-thumb-fallback"><FileText size={24} /></div>}
        />
      </div>

      {/* info */}
      <div className="cv-card-info">
        <div className="cv-card-title">Job #{jobId}</div>
        <div className="cv-card-filename">{job.pdfFilename || `PDF ID: ${job.pdfDocumentId ?? job.pdfId}`}</div>
        <div className="cv-card-pages">{job.totalPages ? `${job.totalPages} pages` : ''}</div>
      </div>

      {/* progress */}
      <div className="cv-card-progress-row">
        <span>Progress</span>
        <span className="cv-card-pct">{job.progressPercentage ?? 0}%</span>
      </div>
      <div className="cv-progress-track">
        <div
          className="cv-progress-fill"
          style={{
            width: `${job.progressPercentage ?? 0}%`,
            background: job.status === 'COMPLETED' ? '#22c55e'
                      : job.status === 'FAILED'    ? '#ef4444'
                      : '#2563eb',
          }}
        />
      </div>

      {/* step label */}
      {job.currentStep && (
        <div className="cv-card-step">
          Step: {String(job.currentStep).replace(/STEP_\d+_/, '').replace(/_/g, ' ')}
          {job.completedAt && <span className="cv-card-date"> · {new Date(job.completedAt).toLocaleString()}</span>}
        </div>
      )}

      {/* error message — shown when job has failed */}
      {job.status === 'FAILED' && job.errorMessage && (
        <div className="cv-card-error" title={job.errorMessage}>
          <TriangleAlert size={14} /> {job.errorMessage}
        </div>
      )}

      {/* retry limit notice */}
      {job.status === 'FAILED' && !canRetry && (
        <div className="cv-card-retry-limit">Max retries ({MAX_RETRIES}) reached</div>
      )}

      {/* actions */}
      <div className="cv-card-actions">
        {job.status === 'COMPLETED' && (
          <button
            className="cv-btn cv-btn-primary"
            onClick={() => {
              if (job.jobType === 'FXL') navigate(`/kitaboo-studio/${jobId}`);
              else onImageEditor(jobId);
            }}
          >
            <Image size={15} /> Image Editor
          </button>
        )}
        {job.status === 'IN_PROGRESS' && job.jobType !== 'FXL' && (
          <button className="cv-btn cv-btn-danger" onClick={() => onStop(jobId)}>Stop</button>
        )}
        {(job.status === 'FAILED' || job.status === 'CANCELLED') && job.jobType !== 'FXL' && (
          <button
            className="cv-btn cv-btn-primary"
            onClick={() => onRetry(jobId)}
            disabled={!canRetry}
            title={!canRetry ? `Max retries (${MAX_RETRIES}) reached` : `Retry (attempt ${retryCount + 1}/${MAX_RETRIES})`}
          >
            <RefreshCw size={15} /> Retry
            {retryCount > 0 && ` (${retryCount}/${MAX_RETRIES})`}
          </button>
        )}
        {job.status === 'PENDING' && (
          <span className="cv-card-waiting">Waiting to start…</span>
        )}
        <button className="cv-btn cv-btn-icon-danger" onClick={() => onDelete(job)} title="Delete job">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};

/* ─── Main Conversions page ───────────────────────────────────── */
const Conversions = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode]         = useState('card');
  const [focusedJob, setFocusedJob]     = useState(null);
  const [activeStep, setActiveStep]     = useState(0);
  const [actionError, setActionError]   = useState('');

  // ── Centralised polling (single hook, no scattered intervals) ──
  const { jobs: conversions, loading, error: pollError, refresh } = useJobPolling(statusFilter);

  /* derive active step from current route */
  useEffect(() => {
    const idx = STEPS.findIndex(s => s.path === location.pathname);
    setActiveStep(idx >= 0 ? idx : 0);
  }, [location.pathname]);

  /* auto-focus first completed job */
  useEffect(() => {
    if (!focusedJob && conversions.length > 0) {
      const first = conversions.find(j => j.status === 'COMPLETED');
      if (first) setFocusedJob(first);
    }
  }, [conversions, focusedJob]);

  const handleDelete = async (job) => {
    const jobId = job.id ?? job.jobId;
    if (!window.confirm(`Delete Job #${jobId}? This cannot be undone.`)) return;
    try {
      setActionError('');
      if (job.jobType === 'FXL') {
        try {
          await api.delete(`/kitaboo/jobs/${jobId}`);
        } catch (err) {
          if (err.response?.status !== 404) throw err;
          console.warn('Conversions: FXL delete 404; treating as already removed.', jobId);
        }
      } else {
        await conversionService.deleteConversionJob(jobId);
      }
      if (focusedJob && (focusedJob.id ?? focusedJob.jobId) === jobId) setFocusedJob(null);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Failed to delete job');
    }
  };

  const handleStop = async (jobId) => {
    try {
      setActionError('');
      await conversionService.stopConversion(jobId);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Failed to stop conversion');
    }
  };

  const handleRetry = async (jobId) => {
    try {
      setActionError('');
      await conversionService.retryConversion(jobId);
      refresh();
    } catch (err) {
      setActionError(err.message || 'Failed to retry conversion');
    }
  };

  const handleImageEditor = (jobId) => navigate(`/conversions/fxl-editor/${jobId}`);
  const handleStepClick   = (step) => navigate(step.path);
  const handleFocusNavigate = (path, job) =>
    navigate(path, { state: { jobId: job.id ?? job.jobId } });

  const completedCount = conversions.filter(j => j.status === 'COMPLETED').length;
  const runningCount   = conversions.filter(j => j.status === 'IN_PROGRESS').length;
  const displayError   = actionError || pollError;

  if (loading && conversions.length === 0) {
    return <div className="cv-loading">Loading conversions…</div>;
  }

  return (
    <div className="cv-root">
      {/* ── Page header ── */}
      <div className="cv-header">
        <div className="cv-header-left">
          <h1 className="cv-title">Conversion Jobs</h1>
          {completedCount > 0 && (
            <span className="cv-count-badge">{completedCount} completed</span>
          )}
        </div>
        <div className="cv-header-right">
          <select
            className="cv-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <div className="cv-view-toggle">
            <button
              className={`cv-view-btn ${viewMode === 'card' ? 'cv-view-btn--active' : ''}`}
              onClick={() => setViewMode('card')}
              title="Card view"
            >
              <Grid2X2 size={17} />
            </button>
            <button
              className={`cv-view-btn ${viewMode === 'list' ? 'cv-view-btn--active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={17} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Workflow stepper ── */}
      <WorkflowStepper activeStep={activeStep} onStepClick={handleStepClick} />

      {displayError && <div className="cv-error">{displayError}</div>}

      {/* ── Running banner ── */}
      {runningCount > 0 && (
        <div className="cv-running-banner">
          <span className="cv-running-dot" />
          {runningCount} conversion job{runningCount > 1 ? 's' : ''} running
        </div>
      )}

      {/* ── Focused job banner ── */}
      <FocusedJobBanner
        job={focusedJob}
        onDismiss={() => setFocusedJob(null)}
        onNavigate={handleFocusNavigate}
      />

      {/* ── Job list ── */}
      <div className="cv-section-label">ALL JOBS · {conversions.length}</div>

      {conversions.length === 0 ? (
        <div className="cv-empty">No conversions found</div>
      ) : viewMode === 'card' ? (
        <div className="cv-grid">
          {conversions.map(job => (
            <JobCard
              key={`${job.jobType ?? 'REFLOW'}-${job.id ?? job.jobId}`}
              job={job}
              onFocus={setFocusedJob}
              onDelete={handleDelete}
              onStop={handleStop}
              onRetry={handleRetry}
              onImageEditor={handleImageEditor}
              navigate={navigate}
            />
          ))}
        </div>
      ) : (
        <div className="cv-table-wrap">
          <table className="cv-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>PDF</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Step</th>
                <th>Error</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {conversions.map(job => {
                const jobId      = job.id ?? job.jobId;
                const retryCount = job.retryCount ?? 0;
                const canRetry   = retryCount < MAX_RETRIES;
                return (
                  <tr key={jobId} className={job.status === 'IN_PROGRESS' ? 'cv-row--running' : ''}>
                    <td>
                      <span className="cv-table-id">#{jobId}</span>
                      <span className={`cv-type-badge ${job.jobType === 'FXL' ? 'cv-type-fxl' : 'cv-type-reflow'}`}>
                        {job.jobType === 'FXL' ? 'FXL' : 'Reflow'}
                      </span>
                    </td>
                    <td>{job.pdfDocumentId ?? job.pdfId}</td>
                    <td>
                      <span className={`cv-status-badge ${getStatusBadge(job.status)}`}>
                        {job.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <div className="cv-table-progress">
                        <div className="cv-progress-track">
                          <div className="cv-progress-fill" style={{ width: `${job.progressPercentage ?? 0}%`, background: job.status === 'COMPLETED' ? '#22c55e' : '#2563eb' }} />
                        </div>
                        <span>{job.progressPercentage ?? 0}%</span>
                      </div>
                    </td>
                    <td className="cv-table-step">
                      {job.currentStep ? String(job.currentStep).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '—'}
                    </td>
                    <td className="cv-table-error" title={job.errorMessage || ''}>
                      {job.status === 'FAILED' && job.errorMessage
                        ? <span className="cv-error-text"><TriangleAlert size={13} /> {job.errorMessage}</span>
                        : '—'}
                    </td>
                    <td>{job.createdAt ? new Date(job.createdAt).toLocaleDateString() : '—'}</td>
                    <td>
                      <div className="cv-table-actions">
                        {job.status === 'COMPLETED' && (
                          <button className="cv-btn cv-btn-primary cv-btn-sm" onClick={() => {
                            if (job.jobType === 'FXL') navigate(`/kitaboo-studio/${jobId}`);
                            else handleImageEditor(jobId);
                          }}>
                            <Image size={13} /> Image Editor
                          </button>
                        )}
                        {job.status === 'IN_PROGRESS' && job.jobType !== 'FXL' && (
                          <button className="cv-btn cv-btn-danger cv-btn-sm" onClick={() => handleStop(jobId)}>Stop</button>
                        )}
                        {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                          <button
                            className="cv-btn cv-btn-primary cv-btn-sm"
                            onClick={() => handleRetry(jobId)}
                            disabled={!canRetry}
                            title={!canRetry ? `Max retries (${MAX_RETRIES}) reached` : undefined}
                          >
                            Retry{retryCount > 0 ? ` (${retryCount}/${MAX_RETRIES})` : ''}
                          </button>
                        )}
                        <button className="cv-btn cv-btn-icon-danger cv-btn-sm" onClick={() => handleDelete(job)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Conversions;
