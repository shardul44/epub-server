import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  CloudUpload,
  CheckCircle2,
  Clock,
  FileText,
  HardDrive,
  Eye,
  Download,
  Loader2,
  XCircle,
  AlertCircle,
  MoreVertical,
  Trash2,
  Image,
  RefreshCw as RetryIcon,
  ShieldCheck,
  FileAudio2,
} from 'lucide-react';
import PdfThumbnail from '../PdfThumbnail';
import ConfirmModal from '../Loadingmodal';
import './RecentActivityPanel.css';
import { useWorkflowNavigation } from '../../hooks/useWorkflowNavigation';
import { useConversionActions } from '../../hooks/useConversionActions';
import useAppDispatch from '../../hooks/useAppDispatch';
import { setFocusedJobId } from '../../features/conversions/conversionsSlice';
import { pdfViewUrl } from '../../services/api';

const RECENT_ACTIVITY_LIMIT = 3;

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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

function jobProgress(job) {
  if (job.status === 'COMPLETED' || job.status === 'FAILED') return 100;
  return Math.round(job.progressPercentage ?? job.progress ?? 0);
}

function statusLabel(job) {
  if (job.status === 'COMPLETED') return 'Complete';
  if (job.status === 'IN_PROGRESS' || job.status === 'PROCESSING') return 'In progress';
  if (job.status === 'FAILED') return 'Failed';
  if (job.status === 'QUEUED' || job.status === 'PENDING') return 'Queued';
  if (job.status === 'CANCELLED') return 'Cancelled';
  return job.status?.replace(/_/g, ' ') ?? 'Unknown';
}

function statusPillText(job, pct) {
  if (job.status === 'COMPLETED') return `${pct}% COMPLETED`;
  if (job.status === 'IN_PROGRESS' || job.status === 'PROCESSING') return `${pct}% IN PROGRESS`;
  if (job.status === 'FAILED') return `${pct}% FAILED`;
  if (job.status === 'QUEUED' || job.status === 'PENDING') return `${pct}% QUEUED`;
  return `${pct}% ${String(job.status || '').replace(/_/g, ' ')}`;
}

function barColorForStatus(status) {
  if (status === 'COMPLETED') return '#10b981';
  if (status === 'FAILED' || status === 'CANCELLED') return '#ef4444';
  if (status === 'IN_PROGRESS' || status === 'PROCESSING') return '#f59e0b';
  return '#9ca3af';
}

function statusModifier(status) {
  return String(status || 'pending').toLowerCase().replace(/_/g, '-');
}

function JobStatusIcon({ status }) {
  if (status === 'COMPLETED') {
    return <CheckCircle2 size={15} className="ds-activity-status-icon ds-activity-status-icon--ok" aria-hidden />;
  }
  if (status === 'IN_PROGRESS' || status === 'PROCESSING') {
    return <Loader2 size={15} className="ds-activity-status-icon ds-activity-status-icon--spin" aria-hidden />;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return <XCircle size={15} className="ds-activity-status-icon ds-activity-status-icon--err" aria-hidden />;
  }
  if (status === 'QUEUED' || status === 'PENDING') {
    return <Clock size={15} className="ds-activity-status-icon ds-activity-status-icon--muted" aria-hidden />;
  }
  return <AlertCircle size={15} className="ds-activity-status-icon ds-activity-status-icon--muted" aria-hidden />;
}

function EmptyIllustration() {
  return (
    <div className="ds-activity-empty-art" aria-hidden>
      <div className="ds-activity-empty-glow" />
      <span className="ds-activity-empty-spark ds-activity-empty-spark--1" />
      <span className="ds-activity-empty-spark ds-activity-empty-spark--2" />
      <span className="ds-activity-empty-spark ds-activity-empty-spark--3" />
      <span className="ds-activity-empty-spark ds-activity-empty-spark--4" />
      <div className="ds-activity-empty-plant" aria-hidden>
        <span className="ds-activity-empty-plant-pot" />
        <span className="ds-activity-empty-plant-stem" />
        <span className="ds-activity-empty-plant-leaf ds-activity-empty-plant-leaf--l" />
        <span className="ds-activity-empty-plant-leaf ds-activity-empty-plant-leaf--r" />
      </div>
      <div className="ds-activity-empty-doc">
        <FileText size={30} strokeWidth={1.4} />
        <span className="ds-activity-empty-pdf-badge">PDF</span>
      </div>
      <div className="ds-activity-empty-cloud">
        <svg viewBox="0 0 56 40" className="ds-activity-empty-cloud-shape" aria-hidden>
          <path
            d="M14 32c-6.6 0-12-4.5-12-10.5C2 15.8 6.8 10 13 10c1.2-5.5 6.5-9.5 12.5-9.5 4.2 0 7.9 2 10.2 5.1C37.4 3.8 41.8 2 46.5 2 52.4 2 57 6.6 57 12.5c0 .8-.1 1.6-.2 2.4 4.5 1.2 7.7 5.3 7.7 10.1 0 5.8-4.7 10.5-10.5 10.5H14z"
            fill="currentColor"
          />
        </svg>
        <CloudUpload size={18} strokeWidth={2.25} className="ds-activity-empty-cloud-icon" />
      </div>
    </div>
  );
}

function ActivityJobMenuWithConfirm({ job, onDeleted }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const { prepareDelete, confirmDelete, handleOpenEditor, handleRetry, MAX_RETRIES } =
    useConversionActions();
  const { goToDownload } = useWorkflowNavigation();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current.getBoundingClientRect();
    const menuW = 180;
    setPos({
      top: rect.bottom + 4,
      left: Math.min(rect.right - menuW, window.innerWidth - menuW - 8),
    });
    setOpen(true);
  };

  const retryCount = job.retryCount ?? job.retries ?? 0;
  const canRetry = job.status === 'FAILED' && retryCount < MAX_RETRIES;

  return (
    <>
      <div className="ds-activity-menu-wrap" ref={btnRef}>
        <button
          type="button"
          className="ds-activity-btn ds-activity-btn--icon"
          onClick={toggle}
          aria-label="More options"
          aria-expanded={open}
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="ds-activity-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: 180 }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {job.status === 'COMPLETED' && (
              <button
                type="button"
                className="ds-activity-menu-item"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  handleOpenEditor(job);
                }}
              >
                <Image size={14} /> Open in editor
              </button>
            )}
            {job.status === 'COMPLETED' && (
              <button
                type="button"
                className="ds-activity-menu-item"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  goToDownload(job);
                }}
              >
                <Download size={14} /> Download EPUB
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                className="ds-activity-menu-item"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  handleRetry(job.id ?? job.jobId);
                  onDeleted?.();
                }}
              >
                <RetryIcon size={14} /> Retry
              </button>
            )}
            <button
              type="button"
              className="ds-activity-menu-item ds-activity-menu-item--danger"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                prepareDelete(job);
                setDeleteOpen(true);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>,
          document.body,
        )}

      <ConfirmModal
        isOpen={deleteOpen}
        title="Delete conversion job?"
        message={`Delete job #${job.id ?? job.jobId}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          await confirmDelete();
          setDeleteOpen(false);
          onDeleted?.();
        }}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}

function ActivityJobCard({ job, onRefresh }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { goToDownload, goToEditor } = useWorkflowNavigation();

  const pct = jobProgress(job);
  const pdfName =
    job.pdfDocument?.originalName ||
    job.pdfDocument?.filename ||
    `Job #${job.id ?? job.jobId}`;
  const pages = job.pdfDocument?.pageCount ?? job.totalPages ?? null;
  const ago = timeAgo(job.updatedAt || job.createdAt);
  const sizeStr = formatFileSize(
    job.fileSize ?? job.pdfFileSize ?? job.pdfDocument?.fileSize ?? job.bytes ?? job.size,
  );
  const pdfDocumentId = job.pdfDocumentId ?? job.pdfDocument?.id ?? job.pdfId;
  const pdfViewUrl = useMemo(() => buildPdfViewUrl(pdfDocumentId), [pdfDocumentId]);
  const thumbCacheKey =
    pdfDocumentId != null ? `ds-activity-thumb-${String(pdfDocumentId)}` : null;
  const barColor = barColorForStatus(job.status);
  const statusMod = statusModifier(job.status);
  const thumbW = 92;
  const thumbH = 120;
  const outputLabel =
    job.status === 'COMPLETED'
      ? 'Converted to EPUB'
      : job.status === 'FAILED'
        ? 'Conversion failed'
        : 'Converting to EPUB';

  const handleView = (e) => {
    e.stopPropagation();
    const id = job.id ?? job.jobId;
    if (job.status === 'COMPLETED') {
      goToEditor(job);
      return;
    }
    dispatch(setFocusedJobId(String(id)));
    navigate('/conversions', { state: { focusJobId: id } });
  };

  const handleDownload = (e) => {
    e.stopPropagation();
    if (job.status === 'COMPLETED') goToDownload(job);
  };

  return (
    <article
      className={`ds-activity-job ds-activity-job--${statusMod}`}
      data-status={job.status}
    >
      <div className="ds-activity-job-accent" aria-hidden />
      <div className="ds-activity-job-inner">
        <div className="ds-activity-job-thumb-wrap">
          <div className="ds-activity-job-thumb">
            <FileText size={24} className="ds-activity-job-thumb-fallback" aria-hidden />
            {pdfViewUrl ? (
              <PdfThumbnail
                url={pdfViewUrl}
                width={thumbW}
                height={thumbH}
                scale={1.25}
                cacheKey={thumbCacheKey}
                className="ds-activity-job-thumb-img"
                alt=""
              />
            ) : null}
          </div>
          <span className="ds-activity-job-pdf-badge">PDF</span>
        </div>

        <div className="ds-activity-job-content">
          <div className="ds-activity-job-top">
            <div className="ds-activity-job-info">
              <h4 className="ds-activity-job-name" title={pdfName}>
                {pdfName}
              </h4>
              <p className="ds-activity-job-id">Job #{job.id ?? job.jobId}</p>
              <p className="ds-activity-job-action">{outputLabel}</p>
              <div className="ds-activity-job-meta">
                {ago ? (
                  <span className="ds-activity-meta-item">
                    <Clock size={13} strokeWidth={2} aria-hidden />
                    {ago}
                  </span>
                ) : null}
                {pages != null ? (
                  <span className="ds-activity-meta-item">
                    <FileText size={13} strokeWidth={2} aria-hidden />
                    {pages} pages
                  </span>
                ) : null}
                {sizeStr ? (
                  <span className="ds-activity-meta-item">
                    <HardDrive size={13} strokeWidth={2} aria-hidden />
                    {sizeStr}
                  </span>
                ) : null}
                <span className="ds-activity-format-pill">EPUB</span>
              </div>
            </div>

            <div className="ds-activity-job-status-col">
              <div className="ds-activity-job-status-head">
                <span className="ds-activity-job-status-label">
                  {statusLabel(job)}
                  <JobStatusIcon status={job.status} />
                </span>
                <span className="ds-activity-job-pct-lg">{pct}%</span>
              </div>
              <div className="ds-activity-job-bar-track">
                <div
                  className="ds-activity-job-bar-fill"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
              <span className={`ds-activity-job-pill ds-activity-job-pill--${statusMod}`}>
                {statusPillText(job, pct)}
              </span>
            </div>
          </div>

          <div className="ds-activity-job-actions">
            <button type="button" className="ds-activity-btn" onClick={handleView}>
              <Eye size={15} strokeWidth={2} aria-hidden />
              View
            </button>
            <button
              type="button"
              className="ds-activity-btn"
              onClick={handleDownload}
              disabled={job.status !== 'COMPLETED'}
              title={job.status !== 'COMPLETED' ? 'Available when conversion completes' : 'Download EPUB'}
            >
              <Download size={15} strokeWidth={2} aria-hidden />
              Download
            </button>
            <ActivityJobMenuWithConfirm job={job} onDeleted={onRefresh} />
          </div>
        </div>
      </div>
    </article>
  );
}

function ActivityEmptyState({ uploadHref }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const pickPdf = (file) => {
    if (!file) return;
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return;
    navigate(uploadHref, { state: { droppedFile: file } });
  };

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      pickPdf(e.dataTransfer.files?.[0]);
    },
    [uploadHref, navigate],
  );

  return (
    <div
      className={`ds-activity-empty${dragOver ? ' ds-activity-empty--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="ds-activity-empty-card">
        <div className="ds-activity-empty-body">
          <EmptyIllustration />
          <h3 className="ds-activity-empty-title">No recent conversions yet</h3>
          <p className="ds-activity-empty-desc">
            Your converted PDF files will appear here. Start by uploading a PDF to convert to EPUB.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="ds-activity-file-input"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => pickPdf(e.target.files?.[0])}
          />
          <Link to={uploadHref} className="ds-activity-upload-btn">
            <CloudUpload size={18} aria-hidden />
            Upload PDF
          </Link>
          <div className="ds-activity-empty-or">
            <span className="ds-activity-empty-or-line" aria-hidden />
            <span className="ds-activity-empty-or-text">
              or{' '}
              <button
                type="button"
                className="ds-activity-empty-drop-link"
                onClick={() => fileInputRef.current?.click()}
              >
                drag and drop
              </button>{' '}
              your PDF here
            </span>
            <span className="ds-activity-empty-or-line" aria-hidden />
          </div>
        </div>

        <div className="ds-activity-features">
          <div className="ds-activity-feature">
            <span className="ds-activity-feature-icon ds-activity-feature-icon--green">
              <CheckCircle2 size={18} strokeWidth={2.25} />
            </span>
            <div className="ds-activity-feature-text">
              <strong>Fast conversion</strong>
              <span>Convert in minutes</span>
            </div>
          </div>
          <div className="ds-activity-feature">
            <span className="ds-activity-feature-icon ds-activity-feature-icon--purple">
              <FileAudio2 size={18} strokeWidth={2.25} />
            </span>
            <div className="ds-activity-feature-text">
              <strong>High quality output</strong>
              <span>EPUB ready for publishing</span>
            </div>
          </div>
          <div className="ds-activity-feature">
            <span className="ds-activity-feature-icon ds-activity-feature-icon--orange">
              <ShieldCheck size={18} strokeWidth={2.25} />
            </span>
            <div className="ds-activity-feature-text">
              <strong>Secure &amp; private</strong>
              <span>Your files are safe with us</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivitySkeletonList({ count = RECENT_ACTIVITY_LIMIT }) {
  return (
    <div className="ds-activity-list">
      {Array.from({ length: count }, (_, i) => i + 1).map((k) => (
        <div key={k} className="ds-activity-job ds-activity-job--skel" aria-hidden>
          <div className="ds-activity-job-accent" />
          <div className="ds-activity-job-inner">
            <div className="ds-skel ds-activity-skel-thumb" />
            <div className="ds-activity-job-content">
              <div className="ds-activity-job-top">
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="ds-skel ds-skel--md" />
                  <div className="ds-skel ds-skel--sm" />
                  <div className="ds-skel" style={{ width: '55%', height: 10 }} />
                </div>
                <div className="ds-activity-skel-status">
                  <div className="ds-skel" style={{ width: '100%', height: 12 }} />
                  <div className="ds-skel" style={{ width: '100%', height: 5, borderRadius: 99 }} />
                  <div className="ds-skel ds-skel--pill" />
                </div>
              </div>
              <div className="ds-activity-skel-actions">
                <div className="ds-skel" style={{ width: 72, height: 34, borderRadius: 8 }} />
                <div className="ds-skel" style={{ width: 92, height: 34, borderRadius: 8 }} />
                <div className="ds-skel" style={{ width: 36, height: 34, borderRadius: 8 }} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Recent activity panel — empty state, job cards, refresh, view/download/actions.
 */
export default function RecentActivityPanel({
  loading = false,
  refreshing = false,
  recentJobs = [],
  onRefresh,
  title = 'Recent activity',
  subtitle = 'Latest conversion jobs from your library',
  uploadHref = '/pdfs/upload',
  conversionsHref = '/conversions',
  titleTag = 'h2',
  limit = RECENT_ACTIVITY_LIMIT,
}) {
  const TitleTag = titleTag;
  const titleId = useId();
  const visibleJobs = recentJobs.slice(0, limit);
  const hasJobs = visibleJobs.length > 0;

  return (
    <section className="ds-panel ds-activity" aria-labelledby={titleId}>
      <header className="ds-activity-header">
        <div className="ds-activity-header-text">
          <TitleTag id={titleId} className="ds-activity-title">
            {title}
          </TitleTag>
          <p className="ds-activity-subtitle">{subtitle}</p>
        </div>
        <div className="ds-activity-header-actions">
          <button
            type="button"
            className={`ds-activity-refresh${refreshing ? ' ds-activity-refresh--spinning' : ''}`}
            onClick={() => onRefresh?.()}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh activity"
          >
            <RefreshCw size={16} strokeWidth={2} />
          </button>
          <Link to={conversionsHref} className="ds-activity-view-all">
            View all →
          </Link>
        </div>
      </header>

      <div className="ds-activity-content">
      {loading ? (
        <ActivitySkeletonList />
      ) : !hasJobs ? (
        <ActivityEmptyState uploadHref={uploadHref} />
      ) : (
        <div className="ds-activity-list">
          {visibleJobs.map((job) => (
            <ActivityJobCard key={job.id ?? job.jobId} job={job} onRefresh={onRefresh} />
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
