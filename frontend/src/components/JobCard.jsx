import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Trash2,
  Image,
  RefreshCw,
  FileText,
  ImageUp,
} from 'lucide-react';
import styles from './JobCard.module.css';
import { loadStoredJobThumb, saveStoredJobThumb } from '../utils/jobCardThumb';
import { isFixedLayout } from '../hooks/useConversionActions';

/** Resize to JPEG data URL for localStorage; keeps payload small. */
const fileToResizedDataUrl = (file, maxWidth = 320, quality = 0.78) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error('size'));
          return;
        }
        const scale = w > maxWidth ? maxWidth / w : 1;
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas'));
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const MAX_RETRIES = 3;

const STATUS_CLASS = {
  PENDING:     'cj-badge--info',
  IN_PROGRESS: 'cj-badge--warning',
  COMPLETED:   'cj-badge--success',
  FAILED:      'cj-badge--danger',
  CANCELLED:   'cj-badge--danger',
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const fmtStep = (s) =>
  s ? String(s).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '';

/* ─── JobGrid ─────────────────────────────────────────────────── */
/**
 * Responsive grid wrapper that replaces `className="cj-grid"`.
 * Renders children in an auto-fill grid (min 290 px per column).
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

  const fileInputRef = useRef(null);
  const [customThumb, setCustomThumb] = useState(null);

  useEffect(() => {
    setCustomThumb(loadStoredJobThumb(jobId));
  }, [jobId]);

  const onThumbFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const dataUrl = await fileToResizedDataUrl(file);
        if (dataUrl.length > 1_600_000) {
          window.alert('That image is still too large after resizing. Try a smaller original file.');
          return;
        }
        saveStoredJobThumb(jobId, dataUrl);
        setCustomThumb(dataUrl);
      } catch {
        window.alert('Could not use that image. Try JPG or PNG.');
      }
    },
    [jobId],
  );

  const clearCustomThumb = useCallback(() => {
    saveStoredJobThumb(jobId, null);
    setCustomThumb(null);
  }, [jobId]);

  return (
    <div
      className={[
        'cj-card',
        job.status === 'IN_PROGRESS' ? 'cj-card--running'  : '',
        isSelected                   ? 'cj-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.(job)}
    >
      {/* top badges row */}
      <div className="cj-card-top">
        <span className={`cj-type-pill ${isFxl ? 'cj-type-fxl' : 'cj-type-reflow'}`}>
          {isFxl ? 'FXL' : 'REFLOW'}
        </span>
        <span className={`cj-status-pill ${STATUS_CLASS[job.status] ?? 'cj-badge--info'}`}>
          {job.status === 'COMPLETED'   ? '✓ COMPLETED' :
           job.status === 'IN_PROGRESS' ? '● RUNNING'   :
           job.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Custom cover only — no PDF first-page preview */}
      <div
        className={[
          'cj-card-thumb',
          customThumb ? 'cj-card-thumb--has-custom' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {customThumb ? (
          <img src={customThumb} alt="" className="cj-card-thumb-img" />
        ) : null}
        <div className="cj-card-thumb-fallback" aria-hidden={!!customThumb}>
          <FileText size={40} />
        </div>
        <div className="cj-card-thumb-actions" onClick={(ev) => ev.stopPropagation()}>
          <button
            type="button"
            className="cj-card-thumb-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload a cover image for this job card"
          >
            <ImageUp size={14} aria-hidden />
            {customThumb ? 'Change cover' : 'Upload cover'}
          </button>
          {customThumb ? (
            <button
              type="button"
              className="cj-card-thumb-btn cj-card-thumb-btn--ghost"
              onClick={clearCustomThumb}
              title="Remove custom cover"
            >
              Remove
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            className="cj-sr-only"
            accept="image/jpeg,image/png,image/webp"
            onChange={onThumbFile}
            aria-label="Upload job card cover image"
          />
        </div>
      </div>

      {/* info block */}
      <div className="cj-card-body">
        <div className="cj-card-row-space">
          <span className="cj-card-title">Job #{jobId}</span>
          {job.totalPages && (
            <span className="cj-card-pages">{job.totalPages} pages</span>
          )}
        </div>
        {job.pdfFilename && (
          <div className="cj-card-filename">{job.pdfFilename}</div>
        )}

        {/* progress */}
        <div className="cj-card-row-space cj-card-prog-label">
          <span>Progress</span>
          <span className="cj-card-pct">{pct}%</span>
        </div>
        <div className="cj-progress-track">
          <div
            className="cj-progress-fill"
            style={{
              width: `${pct}%`,
              background:
                job.status === 'COMPLETED' ? '#22c55e' :
                job.status === 'FAILED'    ? '#ef4444' :
                '#2563eb',
            }}
          />
        </div>

        {/* step */}
        {(job.currentStep || job.completedAt) && (
          <div className="cj-card-step">
            {job.currentStep && <span>Step: {fmtStep(job.currentStep)}</span>}
            {job.completedAt && (
              <span className="cj-card-date">Completed {fmtDate(job.completedAt)}</span>
            )}
          </div>
        )}

        {/* error message */}
        {job.status === 'FAILED' && (job.error || job.errorMessage) && (
          <div className="cj-card-error" title={job.error || job.errorMessage}>
            ⚠ {job.error || job.errorMessage}
          </div>
        )}

        {/* retry limit notice */}
        {job.status === 'FAILED' && !canRetry && (
          <div className="cj-card-retry-limit">
            Max retries ({MAX_RETRIES}) reached
          </div>
        )}
      </div>

      {/* action bar */}
      <div
        className="cj-card-actions"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {job.status === 'COMPLETED' && (
          <button
            type="button"
            className="cj-btn cj-btn-primary"
            onClick={(e) => { e.stopPropagation(); onOpenEditor?.(job); }}
          >
            <Image size={14} />
            {isFxl ? 'Open with Zones →' : 'Open Editor →'}
          </button>
        )}
        {job.status === 'IN_PROGRESS' && !isFxl && (
          <button
            className="cj-btn cj-btn-stop"
            onClick={(e) => { e.stopPropagation(); onStop?.(jobId); }}
          >
            Stop
          </button>
        )}
        {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
          <button
            className="cj-btn cj-btn-primary"
            onClick={(e) => { e.stopPropagation(); onRetry?.(jobId); }}
            disabled={!canRetry}
            title={
              !canRetry
                ? `Max retries (${MAX_RETRIES}) reached`
                : `Retry (attempt ${retryCount + 1}/${MAX_RETRIES})`
            }
          >
            <RefreshCw size={14} />
            Retry{retryCount > 0 ? ` (${retryCount}/${MAX_RETRIES})` : ''}
          </button>
        )}
        {job.status === 'PENDING' && (
          <span className="cj-card-waiting">Waiting to start…</span>
        )}
        <button
          className="cj-btn cj-btn-del"
          onClick={(e) => { e.stopPropagation(); onDelete?.(job); }}
          title="Delete job"
          aria-label="Delete job"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
};

export default JobCard;
