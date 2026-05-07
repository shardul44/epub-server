import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Trash2,
  Play,
  Sparkles,
  Calendar,
  Eye,
  Download,
  MoreVertical,
  BookOpen,
} from 'lucide-react';
import api from '../services/api';
import './PdfCard.css';

/* ─────────────────────────────────────────────
   Shared helpers (exported so PdfList can reuse)
───────────────────────────────────────────── */
export const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export const cardGradients = [
  'linear-gradient(135deg, #f6d365 0%, #e8a020 100%)',   // amber
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',   // pink-red
  'linear-gradient(135deg, #4facfe 0%, #00c6fb 100%)',   // sky blue
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',   // green-teal
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',   // purple-pink
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',   // peach-purple
  'linear-gradient(135deg, #6a85b6 0%, #bac8e0 100%)',   // steel blue
  'linear-gradient(135deg, #fd7043 0%, #ff8a65 100%)',   // deep orange
];

export const getGradient = (id) => cardGradients[(id || 0) % cardGradients.length];

/* ─────────────────────────────────────────────
   useThumbnail — loads the first-page PNG for a PDF.
   Falls back to the gradient if the image fails or
   hasn't loaded yet.
───────────────────────────────────────────── */
const useThumbnail = (pdfId) => {
  const [src, setSrc]       = useState(null);   // null = loading
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!pdfId) return;
    setSrc(null);
    setFailed(false);

    // Build the URL with the auth token as a query param (same pattern used
    // elsewhere in the app for image endpoints that require auth).
    const base  = (api.defaults.baseURL || '').replace(/\/$/, '');
    const token = localStorage.getItem('token');
    const url   = `${base}/pdfs/${pdfId}/page/1/thumbnail${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const img = new Image();
    img.onload  = () => setSrc(url);
    img.onerror = () => setFailed(true);
    img.src = url;

    return () => { img.onload = null; img.onerror = null; };
  }, [pdfId]);

  return { src, failed, loading: !src && !failed };
};

/* ─────────────────────────────────────────────
   Three-dot dropdown menu
   Rendered via portal so it escapes overflow:hidden
   on .pdc-book. Opens downward by default; flips
   upward when there is not enough space below.
───────────────────────────────────────────── */
const DROPDOWN_HEIGHT = 148; // approximate px height of the menu
const DROPDOWN_WIDTH  = 160;

const MoreMenu = memo(({ onPreview, onDownload, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, upward: false });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        btnRef.current  && !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }

    const rect      = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const upward     = spaceBelow < DROPDOWN_HEIGHT + 12;

    setPos({
      // align right edge of menu with right edge of button
      left:   rect.right - DROPDOWN_WIDTH,
      top:    upward ? rect.top - DROPDOWN_HEIGHT - 8 : rect.bottom + 8,
      upward,
    });
    setOpen(true);
  };

  const menu = open && createPortal(
    <div
      ref={menuRef}
      className={`pdc-dropdown ${pos.upward ? 'pdc-dropdown--up' : 'pdc-dropdown--down'}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="pdc-dropdown-item" onClick={() => { setOpen(false); onPreview?.(); }}>
        <Eye size={15} /><span>Preview</span>
      </button>
      <button className="pdc-dropdown-item" onClick={() => { setOpen(false); onDownload?.(); }}>
        <Download size={15} /><span>Download</span>
      </button>
      <div className="pdc-dropdown-divider" />
      <button className="pdc-dropdown-item pdc-dropdown-item--danger" onClick={() => { setOpen(false); onDelete?.(); }}>
        <Trash2 size={15} /><span>Delete</span>
      </button>
    </div>,
    document.body
  );

  return (
    <div className="pdc-more-wrap">
      <button
        ref={btnRef}
        className="pdc-overlay-icon-btn"
        title="More options"
        onClick={handleToggle}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVertical size={14} />
      </button>
      {menu}
    </div>
  );
});
MoreMenu.displayName = 'MoreMenu';

/* ─────────────────────────────────────────────
   PdfCard
───────────────────────────────────────────── */
const PdfCard = memo(({ pdf, onConvert, onHifi, onDelete, onPreview, onDownload }) => {
  const isFixed  = pdf.layoutType === 'FIXED_LAYOUT';
  const gradient = getGradient(pdf.id);
  const { src: thumbSrc, failed: thumbFailed, loading: thumbLoading } = useThumbnail(pdf.id);

  // Use real thumbnail when available; fall back to gradient
  const hasThumbnail = thumbSrc && !thumbFailed;

  const handlePrimaryAction = useCallback(() => {
    if (isFixed) onHifi && onHifi(pdf);
    else onConvert && onConvert(pdf);
  }, [isFixed, onHifi, onConvert, pdf]);

  const formattedDate = new Date(pdf.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="pdc-card group" aria-label={`PDF: ${pdf.originalFileName || 'Unnamed PDF'}`}>

      {/* ── Book-style card ── */}
      <div
        className={`pdc-book${hasThumbnail ? ' pdc-book--thumb' : ''}${thumbLoading ? ' pdc-book--loading' : ''}`}
        style={hasThumbnail
          ? { backgroundImage: `url(${thumbSrc})` }
          : { background: gradient }
        }
        onClick={handlePrimaryAction}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handlePrimaryAction()}
      >
        {/* Left spine shadow */}
        <div className="pdc-spine-left" aria-hidden="true" />
        {/* Right page highlight */}
        <div className="pdc-spine-right" aria-hidden="true" />

        {/* Top badges */}
        <div className="pdc-badges">
          <span className="pdc-badge pdc-badge-pdf">
            <FileText size={11} aria-hidden="true" /> PDF
          </span>
          <span className={`pdc-badge ${isFixed ? 'pdc-badge-fxl' : 'pdc-badge-reflow'}`}>
            {isFixed ? 'FXL' : 'REFLOW'}
          </span>
        </div>

        {/* Center content */}
        <div className="pdc-body">
          <div className="pdc-center-icon">
            <BookOpen size={28} aria-hidden="true" />
          </div>
          <p className="pdc-name" title={pdf.originalFileName}>
            {pdf.originalFileName || 'Unnamed PDF'}
          </p>
          <p className="pdc-sub">
            {pdf.totalPages || 0} pages · {isFixed ? 'Fixed Layout' : 'Reflowable'}
          </p>
        </div>

        {/* Bottom frosted bar — ID + file size */}
        <div className="pdc-bottom-bar">
          <span className="pdc-bottom-text">ID #{pdf.id}</span>
          <span className="pdc-bottom-text">{formatFileSize(pdf.fileSize)}</span>
        </div>

        {/* Hover overlay with action buttons */}
        <div className="pdc-hover-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="pdc-overlay-actions">
            {/* Primary CTA */}
            {!isFixed ? (
              <button
                className="pdc-overlay-primary"
                onClick={(e) => { e.stopPropagation(); onConvert && onConvert(pdf); }}
                title="Convert to EPUB"
              >
                <Play size={13} aria-hidden="true" />
                Convert
              </button>
            ) : (
              <button
                className="pdc-overlay-primary pdc-overlay-hifi"
                onClick={(e) => { e.stopPropagation(); onHifi && onHifi(pdf); }}
                title="High-Fidelity FXL"
              >
                <Sparkles size={13} aria-hidden="true" />
                Hi-Fi FXL
              </button>
            )}

            {/* Eye button */}
            <button
              className="pdc-overlay-icon-btn"
              title="Preview"
              onClick={(e) => { e.stopPropagation(); onPreview && onPreview(pdf); }}
            >
              <Eye size={14} aria-hidden="true" />
            </button>

            {/* Three-dot menu */}
            <MoreMenu
              onPreview={() => onPreview && onPreview(pdf)}
              onDownload={() => onDownload && onDownload(pdf)}
              onDelete={() => onDelete && onDelete(pdf.id)}
            />
          </div>
        </div>
      </div>

      {/* ── Below-card info ── */}
      <div className="pdc-info">
        <p className="pdc-info-name" title={pdf.originalFileName}>
          {pdf.originalFileName || 'Unnamed PDF'}
        </p>
        <p className="pdc-info-meta">
          <Calendar size={11} aria-hidden="true" />
          {formattedDate}
          <span className="pdc-info-sep" aria-hidden="true">·</span>
          {formatFileSize(pdf.fileSize)}
        </p>
      </div>
    </div>
  );
});
PdfCard.displayName = 'PdfCard';

export default PdfCard;
