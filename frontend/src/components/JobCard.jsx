import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Trash2,
  Image,
  RefreshCw,
  FileText,
  ChevronRight,
} from 'lucide-react';
import styles from './JobCard.module.css';
import { isFixedLayout } from '../hooks/useConversionActions';
import PdfThumbnail from './PdfThumbnail';
import { aiConfigService } from '../services/aiConfigService';

const MAX_RETRIES = 3;

const STATUS_CLASS = {
  PENDING:     'cj-badge--info',
  IN_PROGRESS: 'cj-badge--warning',
  COMPLETED:   'cj-badge--success',
  FAILED:      'cj-badge--danger',
  CANCELLED:   'cj-badge--danger',
};

const fmtStep = (s) =>
  s ? String(s).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '';

const formatFileSize = (bytes) => {
  if (bytes == null || bytes === 0) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

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

const resolveAiModel = (job) => {
  if (!job) return null;
  const direct =
    job.aiModel ||
    job.ai_model ||
    job.modelName ||
    job.model ||
    job.llmModel ||
    null;
  if (direct) return direct;
  try {
    const raw = job.intermediateData ?? job.intermediate_data;
    if (raw) {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data?.modelName) return data.modelName;
      if (data?.aiModel) return data.aiModel;
    }
  } catch {
    /* ignore */
  }
  return null;
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

/* ─── JobGrid ─────────────────────────────────────────────────── */
/**
 * Responsive grid wrapper that replaces `className="cj-grid"`.
 * Renders children in an auto-fill grid (min 320 px per column).
 */
export const JobGrid = ({ children }) => (
  <div className={styles.grid}>{children}</div>
);

/* ─── JobCard ─────────────────────────────────────────────────── */
/**
 * Displays a single conversion job as a card.
 * Extracted from ConversionJobs.jsx so it can be reused across pages.
 */
const JobCard = ({
  job,
  onSelect,
  onDelete,
  onStop,
  onRetry,
  onOpenEditor,
  isSelected,
}) => {
  const jobId      = job.id ?? job.jobId;
  const pct        = job.progressPercentage ?? 0;
  const isFxl      = isFixedLayout(job);
  const retryCount = job.retryCount ?? 0;
  const canRetry   = retryCount < MAX_RETRIES;

  const pdfDocumentId = job.pdfDocumentId ?? job.pdfId;
  const pdfViewUrl = useMemo(() => buildPdfViewUrl(pdfDocumentId), [pdfDocumentId]);

  const { data: activeAi } = useQuery({
    queryKey: ['ai-config', 'active-model'],
    queryFn: () => aiConfigService.getActiveModel(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const configuredAiModel = activeAi?.modelName ?? null;

  const displayName =
    job.pdfFilename ||
    job.filename ||
    (pdfDocumentId != null && pdfDocumentId !== ''
      ? `PDF #${pdfDocumentId}`
      : 'Untitled PDF');

  const sizeStr = formatFileSize(job.fileSize ?? job.pdfFileSize ?? job.bytes ?? job.size);
  const pagesPart = job.totalPages != null ? `${job.totalPages} pages` : null;
  const subMeta = [pagesPart, sizeStr].filter(Boolean).join(' · ') || (pagesPart || '—');

  const metrics = useMemo(() => {
    const ai = resolveAiModel(job) || configuredAiModel;
    const durMs = jobDurationMs(job);
    if (job.status === 'COMPLETED') {
      return {
        c1Label: 'Completed',
        c1Val: fmtCompletedNice(job.completedAt || job.updatedAt),
        c2Label: 'Duration',
        c2Val: durMs != null ? fmtDurationMs(durMs) : '—',
        c3Label: 'AI model',
        c3Val: ai || '—',
      };
    }
    if (job.status === 'IN_PROGRESS') {
      return {
        c1Label: 'ETA',
        c1Val: estimateEta(job),
        c2Label: 'Started',
        c2Val: fmtTimeShort(job.createdAt),
        c3Label: 'AI model',
        c3Val: ai || '—',
      };
    }
    return {
      c1Label: 'Status',
      c1Val: job.status.replace(/_/g, ' '),
      c2Label: 'Started',
      c2Val: fmtTimeShort(job.createdAt),
      c3Label: 'AI model',
      c3Val: ai || '—',
    };
  }, [job, configuredAiModel]);

  const progressFillClass =
    job.status === 'COMPLETED'
      ? 'cj-progress-fill--done'
      : job.status === 'FAILED' || job.status === 'CANCELLED'
        ? 'cj-progress-fill--failed'
        : isFxl
          ? 'cj-progress-fill--fxl'
          : 'cj-progress-fill--reflow';

  const thumbCacheKey =
    pdfDocumentId != null && pdfDocumentId !== ''
      ? `pdf-thumb-card-${String(pdfDocumentId)}`
      : null;

  return (
    <div
      className={[
        'cj-card',
        isFxl ? 'cj-card--theme-fxl' : 'cj-card--theme-reflow',
        job.status === 'IN_PROGRESS' ? 'cj-card--running' : '',
        job.status === 'COMPLETED' ? 'cj-card--state-done' : '',
        isSelected ? 'cj-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.(job)}
    >
      <div className="cj-card-header">
        <span className={`cj-type-pill ${isFxl ? 'cj-type-fxl' : 'cj-type-reflow'}`}>
          {isFxl ? 'FXL' : 'REFLOW'}
        </span>
        <span className={`cj-status-pill ${STATUS_CLASS[job.status] ?? 'cj-badge--info'}`}>
          {job.status === 'COMPLETED'
            ? 'COMPLETED'
            : job.status === 'IN_PROGRESS'
              ? 'RUNNING'
              : job.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="cj-card-pdf-panel">
        <div className="cj-card-pdf-thumb-col">
          <span className="cj-card-pdf-badge" aria-hidden>
            PDF
          </span>
          <div className="cj-card-thumb" onClick={(e) => e.stopPropagation()}>
            <div className="cj-card-thumb-fallback" aria-hidden={!!pdfViewUrl}>
              <FileText size={28} />
            </div>
            {pdfViewUrl ? (
              <div className="cj-card-thumb-preview-layer">
                <PdfThumbnail
                  url={pdfViewUrl}
                  width={200}
                  height={280}
                  scale={1.25}
                  cacheKey={thumbCacheKey}
                  className="cj-job-pdf-thumb"
                  alt=""
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="cj-card-pdf-meta">
          <div className="cj-card-pdf-name" title={displayName}>
            {displayName}
          </div>
          <div className="cj-card-pdf-sub">{subMeta}</div>
        </div>
      </div>

      <div className="cj-card-body">
        <div className="cj-card-job-id">Job #{jobId}</div>

        <div className="cj-card-step-row">
          <span className="cj-card-step-text">
            Step: {fmtStep(job.currentStep) || '—'}
          </span>
          <span className="cj-card-pct">{pct}%</span>
        </div>

        <div className="cj-progress-track cj-progress-track--card">
          <div
            className={['cj-progress-fill', progressFillClass].filter(Boolean).join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="cj-card-metrics">
          <div className="cj-card-metric">
            <span className="cj-card-metric-label">{metrics.c1Label}</span>
            <span className="cj-card-metric-value">{metrics.c1Val}</span>
          </div>
          <div className="cj-card-metric">
            <span className="cj-card-metric-label">{metrics.c2Label}</span>
            <span className="cj-card-metric-value">{metrics.c2Val}</span>
          </div>
          <div className="cj-card-metric">
            <span className="cj-card-metric-label">{metrics.c3Label}</span>
            <span className="cj-card-metric-value">{metrics.c3Val}</span>
          </div>
        </div>

        {job.status === 'FAILED' && (job.error || job.errorMessage) && (
          <div className="cj-card-error" title={job.error || job.errorMessage}>
            ⚠ {job.error || job.errorMessage}
          </div>
        )}

        {job.status === 'FAILED' && !canRetry && (
          <div className="cj-card-retry-limit">Max retries ({MAX_RETRIES}) reached</div>
        )}
      </div>

      <div
        className={[
          'cj-card-actions',
          job.status === 'IN_PROGRESS' ? 'cj-card-actions--running' : '',
          job.status === 'COMPLETED' ? 'cj-card-actions--completed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {job.status === 'COMPLETED' && (
          <button
            type="button"
            className="cj-btn cj-btn-open-editor"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor?.(job);
            }}
          >
            <Image size={16} aria-hidden />
            {isFxl ? 'Open in Zoning Studio' : 'Open in Editor'}
            <ChevronRight size={18} aria-hidden />
          </button>
        )}

        {job.status === 'IN_PROGRESS' && !isFxl && (
          <button
            type="button"
            className="cj-btn cj-btn-stop"
            onClick={(e) => {
              e.stopPropagation();
              onStop?.(jobId);
            }}
          >
            <span className="cj-btn-stop-icon" aria-hidden />
            Stop
          </button>
        )}

        {job.status === 'IN_PROGRESS' && (
          <button
            type="button"
            className="cj-btn cj-btn-del cj-btn-del--inline"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(job);
            }}
            title="Delete job"
            aria-label="Delete job"
          >
            <Trash2 size={16} />
          </button>
        )}

        {job.status === 'IN_PROGRESS' && <span className="cj-card-actions-spacer" aria-hidden />}

        {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
          <button
            type="button"
            className="cj-btn cj-btn-retry"
            onClick={(e) => {
              e.stopPropagation();
              onRetry?.(jobId);
            }}
            disabled={!canRetry}
            title={
              !canRetry
                ? `Max retries (${MAX_RETRIES}) reached`
                : `Retry (attempt ${retryCount + 1}/${MAX_RETRIES})`
            }
          >
            <RefreshCw size={14} aria-hidden />
            Retry{retryCount > 0 ? ` (${retryCount}/${MAX_RETRIES})` : ''}
          </button>
        )}

        {job.status === 'PENDING' && (
          <span className="cj-card-waiting">Waiting to start…</span>
        )}

        {job.status !== 'IN_PROGRESS' && (
          <button
            type="button"
            className="cj-btn cj-btn-del"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(job);
            }}
            title="Delete job"
            aria-label="Delete job"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default JobCard;
