import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical,
  Download,
  Trash2,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { mediaUrl } from '../utils/mediaUrl';
import styles from './ExportCard.module.css';

/* ─── Status config ───────────────────────────────────────────── */
const STATUS_CONFIG = {
  Completed:   { cls: styles.badgeCompleted,  label: 'Completed'  },
  Rendering:   { cls: styles.badgeRendering,  label: 'Rendering'  },
  Queued:      { cls: styles.badgeQueued,     label: 'Queued'     },
  Failed:      { cls: styles.badgeFailed,     label: 'Failed'     },
  COMPLETED:   { cls: styles.badgeCompleted,  label: 'Completed'  },
  IN_PROGRESS: { cls: styles.badgeRendering,  label: 'Rendering'  },
  PENDING:     { cls: styles.badgeQueued,     label: 'Queued'     },
  FAILED:      { cls: styles.badgeFailed,     label: 'Failed'     },
  CANCELLED:   { cls: styles.badgeFailed,     label: 'Cancelled'  },
};

/* ─── Gradient palettes — soft pastel, matching screenshot ───── */
const GRADIENTS = [
  // blue-teal (card 1)
  'linear-gradient(160deg, #c8e6f5 0%, #b2e0d8 50%, #c5dff0 100%)',
  // teal-mint (card 2)
  'linear-gradient(160deg, #a8ddd4 0%, #b8e8d8 50%, #a0d8cc 100%)',
  // blue-lavender (card 3)
  'linear-gradient(160deg, #b8d4f0 0%, #c8d8f8 50%, #b0cce8 100%)',
  // peach-amber (card 4 — Rendering)
  'linear-gradient(160deg, #f8d8b0 0%, #f5c890 50%, #f8d0a0 100%)',
  // lavender-purple (card 5)
  'linear-gradient(160deg, #d0c8f0 0%, #c8b8e8 50%, #d8c8f5 100%)',
  // rose-pink (card 6 — Failed)
  'linear-gradient(160deg, #f5c0c0 0%, #f0b0b0 50%, #f8c8c8 100%)',
  // pink-rose (card 7)
  'linear-gradient(160deg, #f8c8d0 0%, #f5b8c8 50%, #f8c0cc 100%)',
  // green-mint (card 8 — Queued)
  'linear-gradient(160deg, #b8e8b8 0%, #a8dca8 50%, #c0ecc0 100%)',
  // sky-blue
  'linear-gradient(160deg, #b0d8f8 0%, #a0c8f0 50%, #b8d8f8 100%)',
  // warm-yellow
  'linear-gradient(160deg, #f8e8a0 0%, #f5d880 50%, #f8e8b0 100%)',
];

const pickGradient = (id) => GRADIENTS[(id ?? 0) % GRADIENTS.length];

const fmtSize = (bytes) => {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

/** "Apr 3" style for secondary meta row (matches reference card). */
const fmtDateShort = (d) => {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Short clock for thumb badge (e.g. 3:32) — uses completion/update time when no audio duration. */
const fmtTimeShort = (d) => {
  if (!d) return null;
  const t = new Date(d);
  const h24 = t.getHours();
  const m = t.getMinutes();
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}`;
};

/* ─── Thumbnail decorative lines (mimics text/content lines) ─── */
const ThumbnailLines = () => (
  <div className={styles.thumbLines} aria-hidden="true">
    {/* upper faint lines */}
    <div className={styles.thumbLinesTop}>
      {[60, 45, 52].map((w, i) => (
        <div key={i} className={styles.thumbLineLight} style={{ width: `${w}%` }} />
      ))}
    </div>
    {/* lower prominent lines */}
    <div className={styles.thumbLinesBottom}>
      {[85, 70, 78, 62, 74].map((w, i) => (
        <div key={i} className={styles.thumbLine} style={{ width: `${w}%` }} />
      ))}
    </div>
  </div>
);

/* ─── Dot menu ────────────────────────────────────────────────── */
const MENU_WIDTH  = 160;
const MENU_HEIGHT = 120; // approx

const DotMenu = ({ onDownload, onPreview, onDelete, canDownload }) => {
  const [open,        setOpen]        = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pos,         setPos]         = useState({ top: 0, left: 0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current  && !btnRef.current.contains(e.target)
      ) setOpen(false);
    };
    const closeScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeScroll, true);
    };
  }, [open]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect       = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const top        = spaceBelow < MENU_HEIGHT + 8
      ? rect.top - MENU_HEIGHT - 4
      : rect.bottom + 4;
    const left = Math.min(
      rect.right - MENU_WIDTH,
      window.innerWidth - MENU_WIDTH - 8
    );
    setPos({ top, left });
    setOpen(true);
  };

  return (
    <div className={styles.dotMenuWrap} ref={btnRef}>
      <button
        className={styles.dotBtn}
        onClick={handleToggle}
        aria-label="More options"
        aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={styles.dotMenu}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {canDownload && (
            <button
              className={styles.dotMenuItem}
              role="menuitem"
              disabled={downloading}
              onClick={async (e) => {
                e.stopPropagation();
                setOpen(false);
                setDownloading(true);
                try {
                  await onDownload?.();
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <Download size={14} /> {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
          {onPreview && (
            <button
              className={styles.dotMenuItem}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onPreview?.(); }}
            >
              <Eye size={14} /> Preview
            </button>
          )}
          <button
            className={`${styles.dotMenuItem} ${styles.dotMenuItemDanger}`}
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete?.(); }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ─── Delete Confirm Modal ────────────────────────────────────── */
const DeleteConfirmModal = ({ jobId, onConfirm, onCancel }) =>
  createPortal(
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="del-modal-title">
      <div className={styles.modalBox}>
        <div className={styles.modalIcon}>
          <AlertTriangle size={24} />
        </div>
        <h2 id="del-modal-title" className={styles.modalTitle}>Delete Export</h2>
        <p className={styles.modalBody}>
          Delete export for <strong>Job #{jobId}</strong>? This cannot be undone.
        </p>
        <div className={styles.modalActions}>
          <button className={styles.modalBtnCancel} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.modalBtnDelete} onClick={onConfirm} autoFocus>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

/* ─── ExportCard ──────────────────────────────────────────────── */
const ExportCard = ({ job, onClick, onDownload, onPreview, onDelete, duration }) => {
  const [thumbLoaded,    setThumbLoaded]    = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleDeleteClick = () => setShowDeleteModal(true);
  const handleDeleteConfirm = () => { setShowDeleteModal(false); onDelete?.(); };
  const handleDeleteCancel  = () => setShowDeleteModal(false);

  const jobId       = job.id ?? job.jobId;
  const isFxl       = job.jobType === 'FXL';
  const statusKey   = job.status ?? 'PENDING';
  const statusCfg   = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.PENDING;
  const gradient    = pickGradient(jobId);
  const canDownload = statusKey === 'COMPLETED' || statusKey === 'Completed';

  // Use the page/1/thumbnail endpoint — serves real PNG if available, SVG placeholder otherwise
  const pdfId     = job.pdfDocumentId ?? job.pdfId;
  const thumbSrc  = pdfId ? mediaUrl(`/api/pdfs/${pdfId}/page/1/thumbnail`) : null;

  const title     = job.pdfFilename?.replace(/\.pdf$/i, '') || `Job #${jobId}`;
  const typeLabel = isFxl ? 'FXL EPUB' : 'Reflow EPUB';
  const pages     = job.totalPages ? `${job.totalPages} pages` : null;
  const size      = fmtSize(job.fileSizeBytes ?? job.fileSize);
  const dateLine  = fmtDateShort(job.completedAt ?? job.updatedAt ?? job.createdAt);
  const timeThumb =
    duration ??
    (canDownload ? fmtTimeShort(job.completedAt ?? job.updatedAt) : null);
  const lang      = job.language ?? 'English';
  const version   = job.version ?? 'v1';
  const userName  = job.createdByName ?? 'You';
  const avatarLetter = userName.trim().toLowerCase() === 'you' ? 'Y' : userName.charAt(0).toUpperCase();

  return (
    <div
      className={styles.card}
      onClick={() => onClick?.(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(job)}
      aria-label={`Export: ${title}`}
    >
      {/* ── Thumbnail: dot grid + optional tint + lines, or cover image ── */}
      <div className={`${styles.thumb}${thumbLoaded ? ` ${styles.thumbHasImage}` : ''}`}>
        {!thumbLoaded && (
          <div className={styles.thumbTint} style={{ background: gradient }} aria-hidden />
        )}
        {thumbSrc && (
          <img
            src={thumbSrc}
            alt=""
            className={styles.thumbImg}
            onLoad={() => setThumbLoaded(true)}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        )}
        {!thumbLoaded && <ThumbnailLines />}
        {/* Status badge — top left */}
        <span className={`${styles.badge} ${statusCfg.cls}`}>{statusCfg.label}</span>
        {/* Duration — bottom right */}
        {timeThumb && <span className={styles.duration}>{timeThumb}</span>}
      </div>

      {/* ── Body ── */}
      <div className={styles.body}>
        {/* Title + dot menu on same row */}
        <div className={styles.titleRow}>
          <span className={styles.title} title={title}>{title}</span>
          <DotMenu
            onDownload={canDownload ? onDownload : undefined}
            onPreview={onPreview}
            onDelete={handleDeleteClick}
            canDownload={canDownload}
          />
        </div>

        {/* Type · pages */}
        <div className={styles.metaRow}>
          <span className={styles.metaType}>{typeLabel}</span>
          {pages && <><span className={styles.metaDot}>·</span><span className={styles.metaText}>{pages}</span></>}
        </div>

        {/* Apr 3 · 35 MB */}
        {(dateLine || size) && (
          <div className={styles.metaRow}>
            {dateLine && <span className={styles.metaText}>{dateLine}</span>}
            {dateLine && size && <span className={styles.metaDot}>·</span>}
            {size && <span className={styles.metaText}>{size}</span>}
          </div>
        )}

        {/* Tags: language · version · You avatar */}
        <div className={styles.tags}>
          <span className={styles.tag}>{lang}</span>
          <span className={styles.tag}>{version}</span>
          <span className={styles.tagYou}>
            <span className={styles.tagYouAvatar}>
              {avatarLetter}
            </span>
            <span className={styles.tagYouLabel}>You</span>
          </span>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteConfirmModal
          jobId={jobId}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
};

/* ─── ExportGrid ──────────────────────────────────────────────── */
export const ExportGrid = ({ children }) => (
  <div className={styles.grid}>{children}</div>
);

/* ─── ExportCardSkeleton ──────────────────────────────────────── */
export const ExportCardSkeleton = () => (
  <div className={styles.skeleton} aria-hidden="true">
    <div className={styles.skeletonThumb} />
    <div className={styles.skeletonBody}>
      <div className={styles.skeletonLine} style={{ width: '75%' }} />
      <div className={styles.skeletonLine} style={{ width: '55%' }} />
      <div className={styles.skeletonLine} style={{ width: '40%' }} />
      <div className={styles.skeletonLine} style={{ width: '60%' }} />
    </div>
  </div>
);

export default ExportCard;
