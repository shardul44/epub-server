import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useListScope } from '../../context/ListScopeContext';
import { useConversions } from '../../hooks/useConversions';
import { useWorkflowNavigation, isFixedLayout, audioSyncPath } from '../../hooks/useWorkflowNavigation';
import WorkflowStepper from '../../components/WorkflowStepper';
import PdfThumbnail from '../../components/PdfThumbnail';
import { pdfViewUrl } from '../../services/api';
import { ArrowLeft, FileText, X, Mic2, ChevronRight } from 'lucide-react';
import './AudioSyncStudio.css';

const fmtStep = (s) =>
  s ? String(s).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '';

const fmtDurationMs = (ms) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${sec % 60}s`;
  if (sec > 0) return `${sec}s`;
  return '—';
};

const fmtTimeShort = (d) =>
  d
    ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '—';

const fmtCompletedNice = (d) =>
  d
    ? new Date(d).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const estimateEta = (job) => {
  const pct = job.progressPercentage ?? 0;
  if (pct <= 0 || pct >= 100) return '—';
  const start = new Date(job.createdAt || job.updatedAt).getTime();
  if (!Number.isFinite(start)) return '—';
  const elapsed = Date.now() - start;
  if (elapsed < 4000) return '—';
  const remaining = (elapsed / pct) * (100 - pct);
  return fmtDurationMs(remaining);
};

const jobDurationMs = (job) => {
  const end = job.completedAt || job.updatedAt;
  const start = job.createdAt;
  if (!start || !end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
};

const formatFileSize = (bytes) => {
  if (bytes == null || bytes === 0) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

function buildPdfViewUrl(pdfDocumentId) {
  if (pdfDocumentId == null || pdfDocumentId === '') return null;
  try {
    return pdfViewUrl(pdfDocumentId);
  } catch {
    return null;
  }
}

const STATUS_BADGE = {
  PENDING:     'ass-status-pill--info',
  IN_PROGRESS: 'ass-status-pill--running',
  COMPLETED:   'ass-status-pill--done',
  FAILED:      'ass-status-pill--fail',
  CANCELLED:   'ass-status-pill--fail',
};

const statusLabel = (status) => {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return 'RUNNING';
  return String(status || '').replace(/_/g, ' ');
};

const AssPdfThumb = memo(function AssPdfThumb({ pdfId }) {
  const url = useMemo(() => buildPdfViewUrl(pdfId), [pdfId]);
  const cacheKey =
    pdfId != null && pdfId !== '' ? `pdf-thumb-card-${String(pdfId)}` : null;

  if (!url) {
    return (
      <div className="ass-job-card-thumb-fallback" aria-hidden>
        <FileText size={28} />
      </div>
    );
  }

  return (
    <>
      <div className="ass-job-card-thumb-fallback ass-job-card-thumb-fallback--under" aria-hidden>
        <FileText size={28} />
      </div>
      <div className="ass-job-card-thumb-preview">
        <PdfThumbnail
          url={url}
          width={200}
          height={280}
          scale={1.25}
          cacheKey={cacheKey}
          className="ass-job-card-pdf-thumb"
          alt=""
        />
      </div>
    </>
  );
});

/* ─── Job selector ────────────────────────────────────────────── */
const JobSelector = ({ jobs, loading, primeAudioSyncWorkflow, listScope }) => (
  <div className="ass-selector-root">
    <div className="ass-selector-header">
      <h2 className="ass-selector-title">Audio Sync Studio</h2>
      <p className="ass-selector-sub">
        {listScope === 'own'
          ? 'Select one of your completed jobs to add narration and sync audio'
          : 'Select a completed conversion job to add narration and sync audio'}
      </p>
    </div>
    {loading ? (
      <div className="ass-selector-loading">
        <div className="ass-spinner" /> Loading jobs…
      </div>
    ) : jobs.length === 0 ? (
      <div className="ass-selector-empty">
        <FileText size={40} />
        <p>No completed jobs available. Complete a conversion first.</p>
      </div>
    ) : (
      <div className="ass-selector-grid">
        {jobs.map((job) => {
          const jobId = job.id ?? job.jobId;
          const pdfId = job.pdfDocumentId ?? job.pdfId;
          const fxl = isFixedLayout(job);
          const to = audioSyncPath(job);
          const status = job.status ?? 'COMPLETED';
          const pct = job.progressPercentage ?? (status === 'COMPLETED' ? 100 : 0);
          const displayName = job.pdfFilename || (pdfId != null ? `PDF #${pdfId}` : 'Untitled PDF');
          const sizeStr = formatFileSize(job.fileSize ?? job.pdfFileSize ?? job.bytes ?? job.size);
          const pagesPart = job.totalPages != null ? `${job.totalPages} pages` : null;
          const subMeta = [pagesPart, sizeStr].filter(Boolean).join(' · ') || (pagesPart || '—');

          const durMs = jobDurationMs(job);
          const metrics =
            status === 'COMPLETED'
              ? {
                  c1Label: 'Completed',
                  c1Val: fmtCompletedNice(job.completedAt || job.updatedAt),
                  c2Label: 'Duration',
                  c2Val: durMs != null ? fmtDurationMs(durMs) : '—',
                  c3Label: 'AI model',
                  c3Val: job.aiModel || job.modelName || job.model || '—',
                }
              : status === 'IN_PROGRESS'
                ? {
                    c1Label: 'ETA',
                    c1Val: estimateEta(job),
                    c2Label: 'Started',
                    c2Val: fmtTimeShort(job.createdAt),
                    c3Label: 'AI model',
                    c3Val: job.aiModel || job.modelName || '—',
                  }
                : {
                    c1Label: 'Status',
                    c1Val: status.replace(/_/g, ' '),
                    c2Label: 'Started',
                    c2Val: fmtTimeShort(job.createdAt),
                    c3Label: 'AI model',
                    c3Val: job.aiModel || job.modelName || '—',
                  };

          const progressClass =
            status === 'COMPLETED'
              ? 'ass-progress-fill--done'
              : status === 'FAILED' || status === 'CANCELLED'
                ? 'ass-progress-fill--fail'
                : fxl
                  ? 'ass-progress-fill--fxl'
                  : 'ass-progress-fill--reflow';

          return (
            <Link
              key={`${fxl ? 'FXL' : 'REFLOW'}-${jobId}`}
              to={to}
              className={[
                'ass-job-card',
                fxl ? 'ass-job-card--fxl' : 'ass-job-card--reflow',
                status === 'IN_PROGRESS' ? 'ass-job-card--running' : '',
                status === 'COMPLETED' ? 'ass-job-card--done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => primeAudioSyncWorkflow(job)}
            >
              <div className="ass-job-card-header">
                <span className={`ass-type-pill${fxl ? ' ass-type-pill--fxl' : ' ass-type-pill--reflow'}`}>
                  {fxl ? 'FXL' : 'REFLOW'}
                </span>
                <span className={`ass-status-pill ${STATUS_BADGE[status] ?? 'ass-status-pill--info'}`}>
                  {statusLabel(status)}
                </span>
              </div>

              <div className="ass-job-card-pdf-panel">
                <div className="ass-job-card-pdf-thumb-col">
                  <span className="ass-job-card-pdf-badge" aria-hidden>
                    PDF
                  </span>
                  <div className="ass-job-card-thumb">
                    <AssPdfThumb pdfId={pdfId} />
                  </div>
                </div>
                <div className="ass-job-card-pdf-meta">
                  <div className="ass-job-card-pdf-name" title={displayName}>
                    {displayName}
                  </div>
                  <div className="ass-job-card-pdf-sub">{subMeta}</div>
                </div>
              </div>

              <div className="ass-job-card-body">
                <div className="ass-job-card-job-id">Job #{jobId}</div>
                <div className="ass-job-card-step-row">
                  <span className="ass-job-card-step-text">
                    Step: {fmtStep(job.currentStep) || '—'}
                  </span>
                  <span className="ass-job-card-pct">{pct}%</span>
                </div>
                <div className="ass-job-card-progress-track">
                  <div
                    className={['ass-job-card-progress-fill', progressClass].filter(Boolean).join(' ')}
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  />
                </div>

                <div className="ass-job-card-metrics">
                  <div className="ass-job-card-metric">
                    <span className="ass-job-card-metric-label">{metrics.c1Label}</span>
                    <span className="ass-job-card-metric-value">{metrics.c1Val}</span>
                  </div>
                  <div className="ass-job-card-metric">
                    <span className="ass-job-card-metric-label">{metrics.c2Label}</span>
                    <span className="ass-job-card-metric-value">{metrics.c2Val}</span>
                  </div>
                  <div className="ass-job-card-metric">
                    <span className="ass-job-card-metric-label">{metrics.c3Label}</span>
                    <span className="ass-job-card-metric-value">{metrics.c3Val}</span>
                  </div>
                </div>
              </div>

              <div className="ass-job-card-footer">
                <span className="ass-job-card-cta">
                  <Mic2 size={16} aria-hidden />
                  Open Audio Sync
                  <ChevronRight size={18} aria-hidden />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    )}
  </div>
);

/* ─── Main component ──────────────────────────────────────────── */
const AudioSyncStudio = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const listScope = useListScope();
  const [error, setError] = useState('');

  const { jobs: allJobs, loading: jobsLoading, error: jobsError } = useConversions();
  const { goToAudioSync, primeAudioSyncWorkflow } = useWorkflowNavigation();

  useEffect(() => {
    if (jobsError) setError(jobsError);
  }, [jobsError]);

  const handleSelectJob = useCallback(
    (job) => {
      goToAudioSync(job);
    },
    [goToAudioSync],
  );

  const handleStepClick = useCallback(
    (step) => {
      navigate(step.path);
    },
    [navigate],
  );

  useEffect(() => {
    if (jobsLoading) return;
    const stateJobId = location.state?.jobId ?? params?.jobId;
    if (!stateJobId) return;
    const found = allJobs.find((j) => String(j.id ?? j.jobId) === String(stateJobId));
    if (found) {
      handleSelectJob(found);
    }
   
  }, [jobsLoading, allJobs, location.state, params?.jobId]);

  return (
    <div className="ass-root">
      <div className="ass-topbar">
        <h1 className="ass-topbar-title ass-topbar-title--grow">Audio Sync Studio</h1>
        <div className="ass-topbar-right">
          <button type="button" className="ass-back-btn" onClick={() => navigate('/conversions')}>
            <ArrowLeft size={15} /> Back to conversions
          </button>
        </div>
      </div>

      <WorkflowStepper activeStep={2} jobId={null} onStepClick={handleStepClick} />

      {error && (
        <div className="ass-error-bar">
          {error}
          <button type="button" onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      )}

      <JobSelector
        jobs={allJobs}
        loading={jobsLoading}
        primeAudioSyncWorkflow={primeAudioSyncWorkflow}
        listScope={listScope}
      />
    </div>
  );
};

export default AudioSyncStudio;
