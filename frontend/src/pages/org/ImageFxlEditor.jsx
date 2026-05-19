/**
 * ImageFxlEditor — job selector page at /conversions/fxl-editor
 *
 * Clicking a card navigates to the dedicated editor:
 *   FXL   → /conversions/fxl-editor/:jobId  → KitabooZoningStudio
 *   Reflow → /conversions/image-editor/:jobId → EpubImageEditorPage
 */
import { useMemo, memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, FileText, Layers, Image, ChevronRight } from 'lucide-react';
import WorkflowStepper from '../../components/WorkflowStepper';
import { useListScope } from '../../context/ListScopeContext';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { isFixedLayout, useWorkflowNavigation } from '../../hooks/useWorkflowNavigation';
import PdfThumbnail from '../../components/PdfThumbnail';
import './ImageFxlEditor.css';

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

function buildPdfViewUrl(pdfDocumentId) {
  if (pdfDocumentId == null || pdfDocumentId === '') return null;
  try {
    const token = localStorage.getItem('token');
    const base = (import.meta.env.VITE_API_URL || 'http://localhost:8082').replace(/\/$/, '');
    const id = String(pdfDocumentId);
    return `${base}/pdfs/${id}/view${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  } catch {
    return null;
  }
}

const STATUS_BADGE = {
  PENDING:     'ife-status-pill--info',
  IN_PROGRESS: 'ife-status-pill--running',
  COMPLETED:   'ife-status-pill--done',
  FAILED:      'ife-status-pill--fail',
  CANCELLED:   'ife-status-pill--fail',
};

const statusLabel = (status) => {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return 'RUNNING';
  return String(status || '').replace(/_/g, ' ');
};

/* ─── PDF thumb (first page) ─────────────────────────────────── */
const IfePdfThumb = memo(function IfePdfThumb({ pdfId }) {
  const url = useMemo(() => buildPdfViewUrl(pdfId), [pdfId]);
  const cacheKey =
    pdfId != null && pdfId !== '' ? `pdf-thumb-card-${String(pdfId)}` : null;

  if (!url) {
    return (
      <div className="ife-job-card-thumb-fallback" aria-hidden>
        <FileText size={28} />
      </div>
    );
  }

  return (
    <>
      <div className="ife-job-card-thumb-fallback ife-job-card-thumb-fallback--under" aria-hidden>
        <FileText size={28} />
      </div>
      <div className="ife-job-card-thumb-preview">
        <PdfThumbnail
          url={url}
          width={200}
          height={280}
          scale={1.25}
          cacheKey={cacheKey}
          className="ife-job-card-pdf-thumb"
          alt=""
        />
      </div>
    </>
  );
});

/* ─── Job selector grid ───────────────────────────────────────── */
const JobSelector = ({ jobs, onSelect, loading, listScope }) => {
  const [tab, setTab] = useState('FXL');

  const fxlJobs    = jobs.filter(j => isFixedLayout(j));
  const reflowJobs = jobs.filter(j => !isFixedLayout(j));
  const visible    = tab === 'FXL' ? fxlJobs : reflowJobs;

  return (
    <div className="ife-selector-root">
      <div className="ife-selector-header">
        <h2 className="ife-selector-title">Image Editor &amp; FXL Studio</h2>
        <p className="ife-selector-sub">
          {listScope === 'own'
            ? 'Select one of your completed jobs to view zones overlaid on the PDF.'
            : 'Select a completed FXL job to view zones overlaid on the PDF.'}{' '}
          Reflow jobs are also available but do not have zone data.
        </p>
      </div>

      <div className="ife-selector-tabs">
        <button
          type="button"
          className={`ife-selector-tab${tab === 'FXL' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('FXL')}
        >
          <Layers size={14} />
          FXL Jobs
          <span className="ife-selector-tab-count">{fxlJobs.length}</span>
        </button>
        <button
          type="button"
          className={`ife-selector-tab${tab === 'REFLOW' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('REFLOW')}
        >
          <FileText size={14} />
          Reflow Jobs
          <span className="ife-selector-tab-count">{reflowJobs.length}</span>
        </button>
      </div>

      {tab === 'FXL' && (
        <div className="ife-selector-info">
          <Layers size={14} />
          FXL jobs include zone data — zones will be overlaid on the PDF pages.
        </div>
      )}
      {tab === 'REFLOW' && (
        <div className="ife-selector-info ife-selector-info--warn">
          <AlertCircle size={14} />
          Reflow jobs do not have zone data. The PDF will open without zone overlays.
        </div>
      )}

      {loading ? (
        <div className="ife-selector-loading">
          <div className="ife-spinner" /> Loading jobs…
        </div>
      ) : visible.length === 0 ? (
        <div className="ife-selector-empty">
          <FileText size={40} />
          <p>
            {tab === 'FXL'
              ? 'No completed FXL jobs yet. Run a Hi-Fi FXL conversion first.'
              : 'No completed Reflow jobs yet.'}
          </p>
        </div>
      ) : (
        <div className="ife-selector-grid">
          {visible.map((job) => {
            const jobId = job.id ?? job.jobId;
            const pdfId = job.pdfDocumentId ?? job.pdfId;
            const fxl   = isFixedLayout(job);
            const status = job.status ?? 'COMPLETED';
            const pct = job.progressPercentage ?? (status === 'COMPLETED' ? 100 : 0);
            const displayName = job.pdfFilename || (pdfId != null ? `PDF #${pdfId}` : 'Untitled PDF');
            const pagesPart = job.totalPages != null ? `${job.totalPages} pages` : null;
            const subMeta = pagesPart || '—';

            const durMs = jobDurationMs(job);
            const metrics =
              status === 'COMPLETED'
                ? {
                    c1Label: 'Completed',
                    c1Val: fmtCompletedNice(job.completedAt || job.updatedAt),
                    c2Label: 'Duration',
                    c2Val: durMs != null ? fmtDurationMs(durMs) : '—',
                    c3Label: 'AI model',
                    c3Val:
                      job.aiModel ||
                      job.modelName ||
                      job.model ||
                      '—',
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
                ? 'ife-progress-fill--done'
                : status === 'FAILED' || status === 'CANCELLED'
                  ? 'ife-progress-fill--fail'
                  : fxl
                    ? 'ife-progress-fill--fxl'
                    : 'ife-progress-fill--reflow';

            return (
              <button
                key={jobId}
                type="button"
                className={[
                  'ife-job-card',
                  fxl ? 'ife-job-card--fxl' : 'ife-job-card--reflow',
                  status === 'IN_PROGRESS' ? 'ife-job-card--running' : '',
                  status === 'COMPLETED' ? 'ife-job-card--done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(job)}
              >
                <div className="ife-job-card-header">
                  <span className={`ife-type-pill${fxl ? ' ife-type-fxl' : ' ife-type-reflow'}`}>
                    {fxl ? 'FXL' : 'REFLOW'}
                  </span>
                  <span className={`ife-status-pill ${STATUS_BADGE[status] ?? 'ife-status-pill--info'}`}>
                    {statusLabel(status)}
                  </span>
                </div>

                <div className="ife-job-card-pdf-panel">
                  <div className="ife-job-card-pdf-thumb-col">
                    <span className="ife-job-card-pdf-badge" aria-hidden>
                      PDF
                    </span>
                    {fxl && (
                      <span className="ife-job-card-zones-badge">
                        <Layers size={10} /> Zones
                      </span>
                    )}
                    <div className="ife-job-card-thumb">
                      <IfePdfThumb pdfId={pdfId} />
                    </div>
                  </div>
                  <div className="ife-job-card-pdf-meta">
                    <div className="ife-job-card-pdf-name" title={displayName}>
                      {displayName}
                    </div>
                    <div className="ife-job-card-pdf-sub">{subMeta}</div>
                  </div>
                </div>

                <div className="ife-job-card-body">
                  <div className="ife-job-card-job-id">Job #{jobId}</div>
                  <div className="ife-job-card-step-row">
                    <span className="ife-job-card-step-text">
                      Step: {fmtStep(job.currentStep) || '—'}
                    </span>
                    <span className="ife-job-card-pct">{pct}%</span>
                  </div>
                  <div className="ife-job-card-progress-track">
                    <div
                      className={['ife-job-card-progress-fill', progressClass].filter(Boolean).join(' ')}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>

                  <div className="ife-job-card-metrics">
                    <div className="ife-job-card-metric">
                      <span className="ife-job-card-metric-label">{metrics.c1Label}</span>
                      <span className="ife-job-card-metric-value">{metrics.c1Val}</span>
                    </div>
                    <div className="ife-job-card-metric">
                      <span className="ife-job-card-metric-label">{metrics.c2Label}</span>
                      <span className="ife-job-card-metric-value">{metrics.c2Val}</span>
                    </div>
                    <div className="ife-job-card-metric">
                      <span className="ife-job-card-metric-label">{metrics.c3Label}</span>
                      <span className="ife-job-card-metric-value">{metrics.c3Val}</span>
                    </div>
                  </div>
                </div>

                <div className="ife-job-card-footer">
                  <span className="ife-job-card-cta">
                    <Image size={16} aria-hidden />
                    {fxl ? 'Open in Zoning Studio' : 'Open in Editor'}
                    <ChevronRight size={18} aria-hidden />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ─── Page component ──────────────────────────────────────────── */
const ImageFxlEditor = () => {
  const navigate = useNavigate();
  const { goToEditor } = useWorkflowNavigation();
  const listScope = useListScope();

  const { jobs: allJobs, isLoading: jobsLoading } = useConversionsQuery({
    statusFilter: 'COMPLETED',
  });

  const handleSelect = (job) => {
    goToEditor(job);
  };

  return (
    <div className="ife-root">
      <div className="ife-topbar">
        <div className="ife-topbar-left">
          <h1 className="ife-topbar-title">Image Editor &amp; FXL Studio</h1>
        </div>
        <div className="ife-topbar-right">
          <button type="button" className="ife-back-btn" onClick={() => navigate('/conversions')}>
            <ArrowLeft size={15} /> Back to jobs
          </button>
        </div>
      </div>

      <WorkflowStepper activeStep={1} jobId={null} onStepClick={(s) => navigate(s.path)} />

      <JobSelector jobs={allJobs} onSelect={handleSelect} loading={jobsLoading} listScope={listScope} />
    </div>
  );
};

export default ImageFxlEditor;
