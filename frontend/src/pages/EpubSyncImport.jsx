import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { conversionService } from '../services/conversionService';
import { queryKeys } from '../lib/queryKeys';
import { useListScope } from '../context/ListScopeContext';
import {
  Upload,
  FileText,
  X,
  CheckCircle,
  Zap,
  ChevronDown,
  ChevronUp,
  Info,
  ArrowLeft,
  RefreshCw,
  LayoutGrid,
} from 'lucide-react';
import './EpubSyncImport.css';

/* ─── Sidebar info panels ─────────────────────────────────────── */
const WHY_SKIP = [
  'No conversion or zoning step required',
  'Faster path — go straight to audio sync',
  'Preserves original EPUB structure & metadata',
  'Ideal for previously authored EPUB titles',
];

const LAYOUT_INFO = [
  {
    title: 'Reflowable',
    desc: 'Text-driven EPUBs that adapt to the reader\'s screen. Most novels and non-illustrated books.',
  },
  {
    title: 'Fixed layout (FXL)',
    desc: 'Page-based EPUBs with background images and sync zones. Children\'s books, comics, illustrated titles.',
  },
];

/* ─── Layout option card ──────────────────────────────────────── */
const LayoutCard = ({ value, selected, onSelect, title, tag, tagColor, icon, desc }) => (
  <button
    type="button"
    className={`esi-layout-card${selected ? ' esi-layout-card--active' : ''}`}
    onClick={() => onSelect(value)}
    aria-pressed={selected}
  >
    <div className="esi-layout-card-top">
      <div className="esi-layout-card-icon">{icon}</div>
      <div className="esi-layout-card-header">
        <span className="esi-layout-card-title">{title}</span>
        <span className={`esi-layout-tag esi-layout-tag--${tagColor}`}>{tag}</span>
      </div>
      <div className={`esi-layout-radio${selected ? ' esi-layout-radio--active' : ''}`}>
        {selected && <div className="esi-layout-radio-dot" />}
      </div>
    </div>
    <p className="esi-layout-card-desc">{desc}</p>
  </button>
);

/* ─── Collapsible sidebar section ────────────────────────────── */
const SidebarSection = ({ title, icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="esi-sidebar-section">
      <button
        type="button"
        className="esi-sidebar-section-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="esi-sidebar-section-icon">{icon}</span>
        <span className="esi-sidebar-section-title">{title}</span>
        {open ? <ChevronUp size={15} className="esi-sidebar-chevron" /> : <ChevronDown size={15} className="esi-sidebar-chevron" />}
      </button>
      {open && <div className="esi-sidebar-section-body">{children}</div>}
    </div>
  );
};

/* ─── Main component ──────────────────────────────────────────── */
const EpubSyncImport = () => {
  const [file, setFile]       = useState(null);
  const [mode, setMode]       = useState('reflowable');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef          = useRef(null);
  const navigate              = useNavigate();
  const queryClient           = useQueryClient();
  const listScope             = useListScope();

  /* ── file helpers ── */
  const validateAndSet = (f) => {
    setError('');
    if (!f) return;
    const name = (f.name || '').toLowerCase();
    if (!name.endsWith('.epub')) {
      setError('File must be a .epub package.');
      return;
    }
    if (f.size > 200 * 1024 * 1024) {
      setError('File size must be under 200 MB.');
      return;
    }
    setFile(f);
  };

  const handleFileChange = (e) => validateAndSet(e.target.files?.[0] || null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    validateAndSet(e.dataTransfer.files?.[0] || null);
  }, []);

  const handleDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const clearFile = () => {
    setFile(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fmtSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /* ── submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Please choose an EPUB file.'); return; }

    setBusy(true);
    setError('');
    try {
      const result = await conversionService.importEpubForSync(file, mode);
      const kind = result?.kind;
      // The uploaded EPUB list/card is intentionally hidden on this page now.

      if (kind === 'fxl' && result.fxlSyncStudioPath) {
        navigate(result.fxlSyncStudioPath);
        return;
      }
      if (kind === 'reflowable' && result.syncStudioPath) {
        navigate(result.syncStudioPath);
        return;
      }
      setError('Unexpected server response. Try again or pick a different layout mode.');
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Import failed.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="esi-page">

      {/* ── Top bar ── */}
      <div className="esi-topbar">
        <div className="esi-topbar-left">
          <h1 className="esi-topbar-title">EPUB → Audio Sync</h1>
          <span className="esi-skip-badge">Skip PDF stage</span>
        </div>
        <Link to="/conversions" className="esi-back-link">
          <ArrowLeft size={16} />
          Back to conversions
        </Link>
      </div>

      {/* ── Body ── */}
      <div className="esi-body">

        {/* ── Left: main form ── */}
        <div className="esi-main">

          {/* Hero card */}
          <div className="esi-hero-card">
            <div className="esi-hero-icon">
              <FileText size={28} />
            </div>
            <div className="esi-hero-text">
              <h2 className="esi-hero-title">EPUB → audio sync</h2>
              <p className="esi-hero-desc">
                Skip PDF conversion and zoning when you already have an EPUB. Reflowable books open in{' '}
                <strong>Sync Studio</strong>; fixed-layout (FXL) books open in{' '}
                <strong>FXL Sync Studio</strong> when the EPUB uses the usual page structure (background
                image plus sync zones). Pick the layout that matches your EPUB.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="esi-error" role="alert">
              <X size={15} className="esi-error-icon" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="esi-section">

              {/* ── EPUB FILE ── */}
              <div className="esi-section-header">
                <FileText size={15} className="esi-section-icon" />
                <span className="esi-section-label">EPUB FILE</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".epub,application/epub+zip"
                onChange={handleFileChange}
                className="esi-file-input"
                tabIndex={-1}
              />

              {!file ? (
                <div
                  className={`esi-dropzone${dragOver ? ' esi-dropzone--over' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                  aria-label="Upload EPUB file"
                >
                  <div className="esi-dropzone-icon-wrap">
                    <Upload size={28} />
                  </div>
                  <p className="esi-dropzone-title">Drop your EPUB here</p>
                  <p className="esi-dropzone-sub">
                    or click to browse · .epub up to 200 MB
                  </p>
                  <button
                    type="button"
                    className="esi-choose-btn"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    <FileText size={15} />
                    Choose file
                  </button>
                </div>
              ) : (
                <div className="esi-file-preview">
                  <div className="esi-file-preview-icon"><FileText size={22} /></div>
                  <div className="esi-file-preview-info">
                    <span className="esi-file-preview-name">{file.name}</span>
                    <span className="esi-file-preview-size">{fmtSize(file.size)}</span>
                  </div>
                  <button type="button" className="esi-file-remove" onClick={clearFile} aria-label="Remove file">
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* ── LAYOUT ── */}
              <div className="esi-section-header esi-section-header--layout">
                <LayoutGrid size={15} className="esi-section-icon" />
                <span className="esi-section-label">LAYOUT</span>
              </div>

              <div className="esi-layout-grid">
                <LayoutCard
                  value="reflowable"
                  selected={mode === 'reflowable'}
                  onSelect={setMode}
                  title="Reflowable"
                  tag="SYNC STUDIO"
                  tagColor="blue"
                  icon={<FileText size={20} />}
                  desc="Standard reflowable EPUBs. Text adapts to screen size."
                />
                <LayoutCard
                  value="fxl"
                  selected={mode === 'fxl'}
                  onSelect={setMode}
                  title="Fixed layout (FXL)"
                  tag="FXL SYNC STUDIO"
                  tagColor="purple"
                  icon={<LayoutGrid size={20} />}
                  desc="Page-based books with background image and sync zones."
                />
              </div>

              <p className="esi-layout-hint">
                Choose <strong>Reflowable</strong> for standard reflowable EPUBs, or{' '}
                <strong>Fixed layout</strong> for FXL page-based books.
              </p>

              {/* ── Footer ── */}
              <div className="esi-section-divider" />
              <div className="esi-section-footer">
                <Link to="/conversions" className="esi-back-link-footer">
                  ← Back to conversions
                </Link>
                <button type="submit" className="esi-submit-btn" disabled={busy || !file}>
                  {busy ? (
                    <><span className="esi-spinner" aria-hidden="true" />Importing…</>
                  ) : (
                    <><RefreshCw size={15} />Import and open sync →</>
                  )}
                </button>
              </div>

            </div>
          </form>
        </div>

        {/* ── Right: sidebar ── */}
        <aside className="esi-sidebar">

          {/* Why skip PDF */}
          <SidebarSection
            title="WHY SKIP PDF?"
            icon={<Zap size={15} />}
            defaultOpen={true}
          >
            <ul className="esi-why-list">
              {WHY_SKIP.map((item, i) => (
                <li key={i} className="esi-why-item">
                  <CheckCircle size={14} className="esi-why-check" />
                  {item}
                </li>
              ))}
            </ul>
          </SidebarSection>

          {/* Which layout */}
          <SidebarSection
            title="WHICH LAYOUT?"
            icon={<Info size={15} />}
            defaultOpen={true}
          >
            {LAYOUT_INFO.map((item, i) => (
              <div key={i} className="esi-layout-info-item">
                <div className="esi-layout-info-title">{item.title}</div>
                <div className="esi-layout-info-desc">{item.desc}</div>
              </div>
            ))}
          </SidebarSection>

          {/* Tip */}
          <div className="esi-tip-card">
            <span className="esi-tip-label">TIP</span>
            <p className="esi-tip-text">
              Need to start from a PDF instead?{' '}
              <Link to="/pdfs/upload" className="esi-tip-link">
                Upload a PDF →
              </Link>
            </p>
          </div>

        </aside>
      </div>
    </div>
  );
};

export default EpubSyncImport;
