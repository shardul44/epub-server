import { useState } from 'react';
import {
  Download,
  Copy,
  Briefcase,
  Calendar,
  Clock,
  Trash2,
} from 'lucide-react';
import ThumbnailImage from './ThumbnailImage';
import './ExportCard.css';

/* ─── Status config ───────────────────────────────────────────── */
const STATUS_CONFIG = {
  Completed:   { cls: 'exp-card-badge--completed',  label: 'Completed'  },
  Rendering:   { cls: 'exp-card-badge--rendering',  label: 'Rendering'  },
  Queued:      { cls: 'exp-card-badge--queued',     label: 'Queued'     },
  Failed:      { cls: 'exp-card-badge--failed',     label: 'Failed'     },
  COMPLETED:   { cls: 'exp-card-badge--completed',  label: 'Completed'  },
  IN_PROGRESS: { cls: 'exp-card-badge--rendering',  label: 'Rendering'  },
  PENDING:     { cls: 'exp-card-badge--queued',     label: 'Queued'     },
  FAILED:      { cls: 'exp-card-badge--failed',     label: 'Failed'     },
  CANCELLED:   { cls: 'exp-card-badge--failed',     label: 'Cancelled'  },
};

/* ─── Gradient palettes ───────────────────────────────────────── */
const GRADIENTS = [
  'linear-gradient(160deg, #c8e6f5 0%, #b2e0d8 50%, #c5dff0 100%)',
  'linear-gradient(160deg, #a8ddd4 0%, #b8e8d8 50%, #a0d8cc 100%)',
  'linear-gradient(160deg, #b8d4f0 0%, #c8d8f8 50%, #b0cce8 100%)',
  'linear-gradient(160deg, #f8d8b0 0%, #f5c890 50%, #f8d0a0 100%)',
  'linear-gradient(160deg, #d0c8f0 0%, #c8b8e8 50%, #d8c8f5 100%)',
  'linear-gradient(160deg, #f5c0c0 0%, #f0b0b0 50%, #f8c8c8 100%)',
  'linear-gradient(160deg, #f8c8d0 0%, #f5b8c8 50%, #f8c0cc 100%)',
  'linear-gradient(160deg, #b8e8b8 0%, #a8dca8 50%, #c0ecc0 100%)',
  'linear-gradient(160deg, #b0d8f8 0%, #a0c8f0 50%, #b8d8f8 100%)',
  'linear-gradient(160deg, #f8e8a0 0%, #f5d880 50%, #f8e8b0 100%)',
];

const pickGradient = (id) => GRADIENTS[(id ?? 0) % GRADIENTS.length];

const fmtSize = (bytes) => {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const fmtDateTime = (d) => {
  if (!d) return { date: null, time: null };
  const t = new Date(d);
  return {
    date: t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
};

const fmtTimeShort = (d) => {
  if (!d) return null;
  const t = new Date(d);
  const h24 = t.getHours();
  const m = t.getMinutes();
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}`;
};

const Spinner = () => (
  <svg className="exp-card-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
    <path d="M12 3a9 9 0 0 1 9 9" />
  </svg>
);

/* ─── ExportCard ──────────────────────────────────────────────── */
const ExportCard = ({
  job,
  onClick,
  onDownload,
  onViewDetails,
  onCopyJobId,
  onDelete,
  duration,
}) => {
  const [downloading, setDownloading] = useState(false);

  const jobId       = job.id ?? job.jobId;
  const isFxl       = job.jobType === 'FXL';
  const statusKey   = job.status ?? 'PENDING';
  const statusCfg   = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.PENDING;
  const gradient    = pickGradient(jobId);
  const canDownload = statusKey === 'COMPLETED' || statusKey === 'Completed';
  const isActive    = statusKey === 'IN_PROGRESS' || statusKey === 'PENDING' || statusKey === 'Rendering' || statusKey === 'Queued';
  const isFailed    = statusKey === 'FAILED' || statusKey === 'Failed' || statusKey === 'CANCELLED';
  const progress    = job.progressPercentage ?? 0;
  const currentStep = job.currentStep
    ? String(job.currentStep).replace(/STEP_\d+_/, '').replace(/_/g, ' ').toLowerCase()
    : null;

  const pdfId     = job.pdfDocumentId ?? job.pdfId;

  const rawName   = job.pdfFilename || job.originalFileName || '';
  const title     = rawName.replace(/\.(pdf|epub)$/i, '') || `Job #${jobId}`;
  const description =
    job.bookDescription ??
    job.description ??
    job.bookSubtitle ??
    job.subtitle ??
    null;
  const typeLabel = isFxl ? 'FXL EPUB' : 'Reflow EPUB';
  const size      = fmtSize(job.fileSizeBytes ?? job.fileSize);
  const { date: dateLine, time: timeLine } = fmtDateTime(
    job.completedAt ?? job.updatedAt ?? job.createdAt,
  );
  const timeThumb =
    duration ??
    (canDownload ? fmtTimeShort(job.completedAt ?? job.updatedAt) : null);

  const lang      = job.language ?? 'English';
  const version   = job.version ?? 'v1';
  const userName  = job.createdByName ?? 'You';
  const avatarLetter = userName.trim().toLowerCase() === 'you' ? 'Y' : userName.charAt(0).toUpperCase();

  const handleViewDetailsClick = (e) => {
    e.stopPropagation();
    if (onViewDetails) onViewDetails();
    else onClick?.(job);
  };

  const handleDownloadClick = async (e) => {
    e.stopPropagation();
    if (!canDownload || downloading) return;
    setDownloading(true);
    try {
      await onDownload?.();
    } finally {
      setDownloading(false);
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete?.(job);
  };

  return (
    <div
      className={`exp-card${isActive ? ' exp-card--active' : ''}${isFailed ? ' exp-card--failed' : ''}`}
      onClick={() => onClick?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(job)}
      aria-label={`Export: ${title}`}
      aria-busy={isActive}
    >
      <div className="exp-card-media" aria-hidden>
        {!pdfId && (
          <div className="exp-card-cover-tint" style={{ background: gradient }} />
        )}
        <ThumbnailImage
          pdfId={pdfId}
          className="exp-card-cover-img"
          fallback={
            <div className="exp-card-cover-tint" style={{ background: gradient }} />
          }
        />
      </div>
      <div className="exp-card-overlay" aria-hidden />

      <div className="exp-card-top-row">
        <span className={`exp-card-badge ${statusCfg.cls}`}>
          {isActive && <Spinner />}
          {statusCfg.label}
        </span>
        {timeThumb ? <span className="exp-card-duration">{timeThumb}</span> : null}
      </div>

      <div className="exp-card-footer">
        <h3 className="exp-card-title" title={title}>
          {title}
        </h3>

        {description && (
          <p className="exp-card-description" title={description}>
            {description}
          </p>
        )}

        <div className="exp-card-meta-line">
          <Briefcase size={12} aria-hidden />
          <span>Job #{jobId}</span>
          {onCopyJobId && (
            <button
              type="button"
              className="exp-card-job-copy"
              onClick={(e) => { e.stopPropagation(); onCopyJobId(); }}
              aria-label={`Copy job ID ${jobId}`}
            >
              <Copy size={12} />
            </button>
          )}
          <span className="exp-card-meta-sep" aria-hidden>|</span>
          <span className="exp-card-meta-type">{typeLabel}</span>
          {size ? (
            <>
              <span className="exp-card-meta-sep" aria-hidden>·</span>
              <span>{size}</span>
            </>
          ) : null}
        </div>

        {!isActive && (dateLine || timeLine) && (
          <div className="exp-card-meta-line">
            {dateLine ? (
              <>
                <Calendar size={12} aria-hidden />
                <span>{dateLine}</span>
              </>
            ) : null}
            {timeLine ? (
              <>
                <Clock size={12} aria-hidden />
                <span>{timeLine}</span>
              </>
            ) : null}
          </div>
        )}

        {isActive && currentStep && (
          <p className="exp-card-step-label">
            {currentStep}… {progress > 0 ? `${progress}%` : ''}
          </p>
        )}

        {isFailed && job.errorMessage && (
          <p className="exp-card-error-msg" title={job.errorMessage}>
            {job.errorMessage.length > 80
              ? job.errorMessage.slice(0, 80) + '…'
              : job.errorMessage}
          </p>
        )}

        <div className="exp-card-tags">
          <span className="exp-card-tag">{lang}</span>
          <span className="exp-card-tag">{version}</span>
          <span className="exp-card-tag-you">
            <span className="exp-card-tag-you-avatar">{avatarLetter}</span>
            <span className="exp-card-tag-you-label">{userName}</span>
          </span>
        </div>

        <div className="exp-card-actions">
          {canDownload ? (
            <button
              type="button"
              className="exp-card-view-btn"
              onClick={handleDownloadClick}
              disabled={downloading}
            >
              <Download size={14} aria-hidden />
              {downloading ? 'Downloading…' : 'Download EPUB'}
            </button>
          ) : (
            <button
              type="button"
              className="exp-card-view-btn exp-card-view-btn--secondary"
              onClick={handleViewDetailsClick}
            >
              {isFailed ? 'View error' : 'View progress'}
            </button>
          )}
          {onDelete ? (
            <button
              type="button"
              className="exp-card-del-btn"
              onClick={handleDeleteClick}
              title="Delete job"
              aria-label={`Delete job #${jobId}`}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

/* ─── ExportGrid ──────────────────────────────────────────────── */
export const ExportGrid = ({ children }) => (
  <div className="exp-card-grid">{children}</div>
);

/* ─── ExportCardSkeleton ──────────────────────────────────────── */
export const ExportCardSkeleton = () => (
  <div className="exp-card-skeleton" aria-hidden="true">
    <div className="exp-card-skeleton-cover" />
    <div className="exp-card-skeleton-footer">
      <div className="exp-card-skeleton-line" style={{ width: '70%', height: 18 }} />
      <div className="exp-card-skeleton-line" style={{ width: '90%' }} />
      <div className="exp-card-skeleton-line" style={{ width: '55%' }} />
      <div className="exp-card-skeleton-line" style={{ width: '100%', height: 32, borderRadius: 999 }} />
    </div>
  </div>
);

export default ExportCard;
