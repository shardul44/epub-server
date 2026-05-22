import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Loader2,
  Copy,
  Check,
  Download,
  FileText,
  Building2,
  User,
  Calendar,
  Settings2,
  CheckCircle2,
  Clock,
  XCircle,
  Layers,
} from 'lucide-react';
import { useMergedConversionJob, jobIdOf, formatConversionWhen } from '../../hooks/useMergedConversionJob';
import ThumbnailImage from '../ThumbnailImage';
import {
  durationSeconds,
  formatJobStep,
  hasDisplayValue,
} from './conversionJobDisplay';
import './ConversionJobSummaryModal.css';

const ACTIVE = new Set(['IN_PROGRESS', 'PENDING', 'PROCESSING']);

function StatusPill({ status }) {
  const s = String(status || '').toUpperCase();
  let cls = 'cjsm-status-pill';
  let icon = null;
  let label = s.replace(/_/g, ' ') || 'Unknown';

  if (s === 'COMPLETED') {
    cls += ' cjsm-status-pill--completed';
    icon = <CheckCircle2 size={12} aria-hidden />;
    label = 'Completed';
  } else if (s === 'FAILED') {
    cls += ' cjsm-status-pill--failed';
    icon = <XCircle size={12} aria-hidden />;
    label = 'Failed';
  } else if (ACTIVE.has(s)) {
    cls += ' cjsm-status-pill--processing';
    icon = <Clock size={12} aria-hidden />;
    label = 'Processing';
  }

  return (
    <span className={cls}>
      {icon}
      {label}
    </span>
  );
}

function MetricCard({ icon: Icon, tone, label, value }) {
  const empty = !hasDisplayValue(value);
  return (
    <div className="cjsm-metric">
      <div className={`cjsm-metric-icon cjsm-metric-icon--${tone}`}>
        <Icon size={16} aria-hidden />
      </div>
      <span className="cjsm-metric-label">{label}</span>
      <span className={`cjsm-metric-value${empty ? ' cjsm-metric-value--muted' : ''}`}>
        {empty ? 'Not set' : value}
      </span>
    </div>
  );
}

function InfoField({ label, value, mono, copyKey, onCopy, copiedKey, fullWidth }) {
  const display = hasDisplayValue(value) ? String(value) : null;
  return (
    <div className={`cjsm-field${fullWidth ? ' cjsm-field--full' : ''}`}>
      <span className="cjsm-field-k">{label}</span>
      <span className={`cjsm-field-v${mono ? ' cjsm-field-v--mono' : ''}`}>
        {display ? (
          <>
            <span>{display}</span>
            {copyKey && onCopy && (
              <button
                type="button"
                className="cjsm-inline-copy"
                onClick={() => onCopy(display, copyKey)}
                aria-label={`Copy ${label}`}
                title="Copy"
              >
                {copiedKey === copyKey ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </>
        ) : (
          <span className="cjsm-field-empty">Not set</span>
        )}
      </span>
    </div>
  );
}

function SummaryContent({ merged, source, fetchError, onCopy, copiedKey }) {
  const status = String(merged.status || '').toUpperCase();
  const isFailed = status === 'FAILED';
  const isDone = status === 'COMPLETED';
  const jobType = String(merged.jobType || source || 'REFLOW').toUpperCase();
  const isFxl = jobType === 'FXL';
  const step = formatJobStep(merged.currentStep);
  const pdfId = merged.pdfDocumentId ?? merged.pdfId;
  const fileName = merged.pdfFilename || merged.originalFileName;

  return (
    <>
      {fetchError ? <div className="pcv-err" style={{ marginBottom: 12 }}>{fetchError}</div> : null}

      <div className="cjsm-metrics">
        <MetricCard
          icon={Building2}
          tone="blue"
          label="Organization"
          value={merged.organizationName}
        />
        <MetricCard
          icon={User}
          tone="purple"
          label="Requested by"
          value={merged.userName || merged.userEmail}
        />
        <MetricCard
          icon={Layers}
          tone="amber"
          label="Pages"
          value={merged.totalPages != null ? `${merged.totalPages} pages` : null}
        />
        <MetricCard
          icon={Clock}
          tone="green"
          label="Duration"
          value={isDone ? durationSeconds(merged) : null}
        />
      </div>

      <div className="cjsm-sections">
        <section className="cjsm-section">
          <div className="cjsm-section-head">
            <FileText size={14} />
            Document
          </div>
          <div className="cjsm-fields">
            <InfoField label="PDF file" value={fileName} fullWidth />
            <InfoField
              label="PDF document ID"
              value={pdfId}
              mono
              copyKey="pdfId"
              onCopy={onCopy}
              copiedKey={copiedKey}
            />
            <InfoField label="Job type" value={isFxl ? 'FXL EPUB' : 'Reflow EPUB'} />
            <InfoField
              label="Requires review"
              value={
                merged.requiresReview != null
                  ? merged.requiresReview
                    ? 'Yes'
                    : 'No'
                  : null
              }
            />
          </div>
        </section>

        <section className="cjsm-section">
          <div className="cjsm-section-head">
            <Calendar size={14} />
            Timeline
          </div>
          <div className="cjsm-fields">
            <InfoField label="Created" value={formatConversionWhen(merged.createdAt)} />
            <InfoField label="Updated" value={formatConversionWhen(merged.updatedAt)} />
            <InfoField label="Completed" value={formatConversionWhen(merged.completedAt)} />
            <InfoField label="Retry count" value={merged.retryCount ?? 0} />
          </div>
        </section>

        {(hasDisplayValue(merged.epubFilePath) || step) && (
          <section className="cjsm-section">
            <div className="cjsm-section-head">
              <Settings2 size={14} />
              Technical
            </div>
            <div className="cjsm-fields">
              {step && <InfoField label="Current step" value={step} />}
              <InfoField
                label="EPUB path"
                value={merged.epubFilePath}
                mono
                fullWidth
                copyKey="epub"
                onCopy={onCopy}
                copiedKey={copiedKey}
              />
            </div>
          </section>
        )}
      </div>

      {isFailed && merged.errorMessage && (
        <div className="cjsm-err-box">
          <h3 className="cjsm-err-title">Error message</h3>
          <pre className="cjsm-err-pre">{merged.errorMessage}</pre>
        </div>
      )}
    </>
  );
}

/**
 * Modern interactive summary modal for platform conversion jobs.
 */
export default function ConversionJobSummaryModal({ job, onClose, onDownload }) {
  const jobIdStr = job != null ? String(jobIdOf(job)) : '';
  const { merged, detailQuery, source, listLoading } = useMergedConversionJob(jobIdStr, job);
  const [copiedKey, setCopiedKey] = useState('');
  const [dlBusy, setDlBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleCopy = useCallback(async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const loading = listLoading || (detailQuery.isPending && !merged);
  const notFound = !loading && !merged && !detailQuery.isPending;
  const err = detailQuery.error?.message;

  const id = merged ? jobIdOf(merged) : jobIdStr;
  const status = merged ? String(merged.status || '').toUpperCase() : '';
  const isDone = status === 'COMPLETED';
  const isActive = ACTIVE.has(status);
  const isFailed = status === 'FAILED';
  const pct = merged
    ? Math.min(100, Math.max(0, Number(merged.progressPercentage) || 0))
    : 0;
  const jobType = merged ? String(merged.jobType || source || 'REFLOW').toUpperCase() : '';
  const isFxl = jobType === 'FXL';
  const fileName =
    merged?.pdfFilename || merged?.originalFileName || `Job #${id}`;
  const step = merged ? formatJobStep(merged.currentStep) : null;
  const pdfId = merged?.pdfDocumentId ?? merged?.pdfId;

  const handleDownload = async () => {
    if (!onDownload || !merged) return;
    setDlBusy(true);
    try {
      await onDownload(merged);
    } finally {
      setDlBusy(false);
    }
  };

  return createPortal(
    <div className="cjsm-overlay" role="presentation" onClick={onClose}>
      <div
        className="cjsm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cjsm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cjsm-hero">
          <div className="cjsm-hero-top">
            <div className="cjsm-hero-badges">
              {merged && <StatusPill status={merged.status} />}
              {merged && (
                <span className={`cjsm-type-pill${isFxl ? ' cjsm-type-pill--fxl' : ''}`}>
                  {isFxl ? 'FXL' : 'Reflow'}
                </span>
              )}
            </div>
            <button
              type="button"
              className="cjsm-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {loading ? null : (
            <div className="cjsm-hero-main">
              <div className="cjsm-hero-thumb">
                <ThumbnailImage
                  pdfId={pdfId}
                  alt=""
                  fallback={(
                    <div className="cjsm-hero-thumb-fallback">
                      <FileText size={28} strokeWidth={1.5} aria-hidden />
                    </div>
                  )}
                />
              </div>
              <div className="cjsm-hero-text">
                <h2 id="cjsm-title" className="cjsm-hero-title">
                  {fileName}
                </h2>
                <div className="cjsm-hero-id-row">
                  <span className="cjsm-hero-id">Job #{id}</span>
                  <button
                    type="button"
                    className={`cjsm-copy-btn${copiedKey === 'jobId' ? ' cjsm-copy-btn--ok' : ''}`}
                    onClick={() => handleCopy(String(id), 'jobId')}
                  >
                    {copiedKey === 'jobId' ? (
                      <>
                        <Check size={12} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy ID
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {merged && (
            <div className="cjsm-progress-block">
              <div className="cjsm-progress-head">
                <span>{isActive ? 'Converting…' : isFailed ? 'Failed' : 'Progress'}</span>
                <span>{Math.round(pct)}%</span>
              </div>
              <div className="cjsm-progress-track">
                <div
                  className={`cjsm-progress-fill${isActive ? ' cjsm-progress-fill--active' : ''}${isFailed ? ' cjsm-progress-fill--failed' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {step && isActive && <p className="cjsm-step-hint">{step}</p>}
            </div>
          )}
        </header>

        <div className="cjsm-body">
          {loading ? (
            <div className="cjsm-loading">
              <Loader2 size={28} className="cjsm-spin" aria-hidden />
              Loading job details…
            </div>
          ) : notFound ? (
            <p className="cjsm-empty">Job not found or you do not have access.</p>
          ) : (
            <SummaryContent
              merged={merged}
              source={source}
              fetchError={err}
              onCopy={handleCopy}
              copiedKey={copiedKey}
            />
          )}
        </div>

        <footer className="cjsm-foot">
          <button type="button" className="cjsm-btn cjsm-btn--ghost" onClick={onClose}>
            Close
          </button>
          {isDone && onDownload && (
            <button
              type="button"
              className="cjsm-btn cjsm-btn--primary"
              disabled={dlBusy}
              onClick={handleDownload}
            >
              {dlBusy ? (
                <Loader2 size={16} className="cjsm-spin" aria-hidden />
              ) : (
                <Download size={16} aria-hidden />
              )}
              Download EPUB
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
