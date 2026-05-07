import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { conversionService } from '../../services/conversionService';
import api from '../../services/api';
import { mediaUrl } from '../../utils/mediaUrl';
import { loadStoredJobThumb } from '../../utils/jobCardThumb';
import { useZoneUndoRedo } from '../../hooks/useZoneUndoRedo';
import { saveLocalImages, getLocalImages, deleteLocalImages } from '../../utils/localImageStorage';
import { withAuthImageQuery } from '../../utils/authImageUrl';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import {
  ArrowLeft,
  Check,
  Lock,
  ChevronRight,
  Image,
  FileText,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  X,
  ChevronLeft,
  Layers,
  AlertCircle,
  Loader2,
  Undo2,
  Redo2,
  Pencil,
  Upload,
  Trash2,
} from 'lucide-react';
import './ImageFxlEditor.css';

/* ─── Drag type for image gallery ────────────────────────────── */
const IFE_DRAG_TYPE = 'IFE_IMAGE';

/* ─── Draggable image thumbnail in gallery ───────────────────── */
const IfeGalleryImage = ({ image, onClick }) => {
  const [imgSrc, setImgSrc]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [imgError, setImgError] = useState(false);

  const [{ isDragging }, drag] = useDrag({
    type: IFE_DRAG_TYPE,
    item: () => {
      if (typeof window !== 'undefined') {
        window.__ifeDragImage = image;
        window.__ifeDragging  = true;
      }
      return { image };
    },
    end: () => {
      if (typeof window !== 'undefined') {
        window.__ifeDragging  = false;
        setTimeout(() => { window.__ifeDragImage = null; }, 200);
      }
    },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  /* native drag for cross-boundary drops */
  const handleNativeDragStart = (e) => {
    e.dataTransfer.setData('application/ife-image', JSON.stringify(image));
    e.dataTransfer.setData('text/plain', JSON.stringify(image));
    e.dataTransfer.effectAllowed = 'copy';
    if (typeof window !== 'undefined') {
      window.__ifeDragImage = image;
      window.__ifeDragging  = true;
    }
  };
  const handleNativeDragEnd = () => {
    if (typeof window !== 'undefined') {
      window.__ifeDragging = false;
      setTimeout(() => { window.__ifeDragImage = null; }, 200);
    }
  };

  useEffect(() => {
    let revoke = null;
    const load = async () => {
      try {
        setLoading(true);
        setImgError(false);
        if (!image?.url) { setImgError(true); setLoading(false); return; }
        if (image.url.startsWith('blob:') || image.url.startsWith('data:')) {
          setImgSrc(image.url); setLoading(false); return;
        }
        const isAbs = image.url.startsWith('http://') || image.url.startsWith('https://');
        if (isAbs) {
          const token = localStorage.getItem('token');
          const res = await fetch(image.url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          revoke = url;
          setImgSrc(url);
        } else {
          const res  = await api.get(image.url, { responseType: 'blob' });
          const url  = URL.createObjectURL(res.data);
          revoke = url;
          setImgSrc(url);
        }
      } catch { setImgError(true); }
      finally  { setLoading(false); }
    };
    load();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [image?.url]);

  return (
    <div
      ref={drag}
      className={`ife-gallery-img ${isDragging ? 'ife-gallery-img--dragging' : ''}`}
      draggable
      onDragStart={handleNativeDragStart}
      onDragEnd={handleNativeDragEnd}
      onClick={() => onClick && onClick(image)}
      title={image.fileName}
    >
      {loading ? (
        <div className="ife-gallery-img-skeleton" />
      ) : imgError || !imgSrc ? (
        <div className="ife-gallery-img-error">⚠</div>
      ) : (
        <img src={imgSrc} alt={image.fileName} />
      )}
      <span className="ife-gallery-img-label">{image.fileName}</span>
    </div>
  );
};

/* ─── PDF.js worker (react-pdf v10) ──────────────────────────── */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/* ─── Stepper ─────────────────────────────────────────────────── */
const STEPS = [
  { key: 'jobs',     label: 'Conversion Jobs',          sub: 'PDF processed',        path: '/conversions' },
  { key: 'editor',  label: 'Image Editor & FXL Studio', sub: 'Edit zones & layout',  path: '/conversions/fxl-editor' },
  { key: 'audio',   label: 'Audio Sync Studio',         sub: 'Add narration & sync', path: '/conversions/audio-sync' },
  { key: 'download',label: 'Download EPUB',             sub: 'Get your final file',  path: '/conversions/download' },
];

/** Uses the same cover as Conversion Jobs `cj-card` when the user uploaded one. */
const IfeJobCardThumb = memo(function IfeJobCardThumb({ jobId, pdfId }) {
  const [customSrc, setCustomSrc] = useState(() => loadStoredJobThumb(jobId));
  useEffect(() => {
    setCustomSrc(loadStoredJobThumb(jobId));
  }, [jobId]);

  const thumbSrc = customSrc || mediaUrl(`/api/pdfs/${pdfId}/thumbnail`);
  const isCustom = Boolean(customSrc);

  return (
    <div className={`ife-job-card-thumb${isCustom ? ' ife-job-card-thumb--custom' : ''}`}>
      <img
        src={thumbSrc}
        alt=""
        onError={(e) => {
          e.target.style.display = 'none';
          const fb = e.target.nextElementSibling;
          if (fb) fb.style.display = 'flex';
        }}
      />
      <div className="ife-job-card-fallback">
        <FileText size={32} />
      </div>
    </div>
  );
});

const WorkflowStepper = ({ activeStep, jobId, onStepClick }) => (
  <div className="ife-stepper">
    {STEPS.map((step, idx) => {
      const done   = idx < activeStep;
      const active = idx === activeStep;
      const locked = idx > activeStep;
      return (
        <button
          key={step.key}
          className={['ife-step', done ? 'ife-step--done' : '', active ? 'ife-step--active' : '', locked ? 'ife-step--locked' : ''].filter(Boolean).join(' ')}
          onClick={() => !locked && onStepClick(step)}
          disabled={locked}
          aria-current={active ? 'step' : undefined}
        >
          <span className="ife-step-circle">
            {done ? <Check size={12} /> : locked ? <Lock size={10} /> : <span>{idx + 1}</span>}
          </span>
          <span className="ife-step-body">
            <span className="ife-step-label">{step.label}</span>
            <span className="ife-step-sub">{step.sub}</span>
          </span>
          {idx < STEPS.length - 1 && <ChevronRight className="ife-step-arrow" size={13} />}
        </button>
      );
    })}
    {jobId && <span className="ife-job-chip">Job #{jobId}</span>}
  </div>
);

/* ─── Zone type config ────────────────────────────────────────── */
const ZONE_COLORS = {
  text:    { bg: 'rgba(37,99,235,0.15)',   border: '#2563eb', dash: true  },
  image:   { bg: 'rgba(16,185,129,0.15)',  border: '#10b981', dash: false },
  caption: { bg: 'rgba(245,158,11,0.15)',  border: '#f59e0b', dash: true  },
  default: { bg: 'rgba(107,114,128,0.15)', border: '#6b7280', dash: true  },
};
const zoneColor = (type) => ZONE_COLORS[type?.toLowerCase()] ?? ZONE_COLORS.default;

/**
 * Normalize a raw zone from the API into the shape the UI expects.
 *
 * The backend returns pixel coordinates (x, y, w, h) and the page dimensions
 * are available from the same /kitaboo/ready response.  We convert to percent
 * so the overlay can use CSS `left/top/width/height` as percentages.
 *
 * Falls back to treating values as percentages if no dimensions are provided
 * (e.g. REFLOW jobs or legacy data).
 */
const normalizeZone = (z, index, dims) => {
  const rawX = z.x ?? z.left  ?? 0;
  const rawY = z.y ?? z.top   ?? 0;
  const rawW = z.w ?? z.width ?? 0;
  const rawH = z.h ?? z.height ?? 0;

  let x, y, w, h;
  if (dims && dims.width > 0 && dims.height > 0) {
    // Convert pixel coords → percent
    x = (rawX / dims.width)  * 100;
    y = (rawY / dims.height) * 100;
    w = (rawW / dims.width)  * 100;
    h = (rawH / dims.height) * 100;
  } else {
    // Already percentages (or unknown — pass through)
    x = rawX; y = rawY; w = rawW; h = rawH;
  }

  return {
    id:           z.id    ?? z.zone_id ?? `zone-${index}`,
    type:         z.type  ?? 'default',
    label:        z.label ?? z.content ?? z.type ?? 'Zone',
    readingOrder: z.readingOrder ?? (index + 1),
    x, y, w, h,
  };
};

/* ─── Thumbnail cache (module-level, survives re-renders) ─────── */
const thumbCache = new Map(); // key: `${pdfUrl}::${pageNumber}` → dataURL

/* ─── Page thumbnail — lazy PDF render via react-pdf ─────────── */
const PageThumb = memo(function PageThumb({ pageNumber, pdfUrl, isActive, onClick }) {
  const [dataUrl,  setDataUrl]  = useState(() => thumbCache.get(`${pdfUrl}::${pageNumber}`) ?? null);
  const [visible,  setVisible]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const rootRef = useRef(null);

  /* Intersection Observer — only start rendering when in viewport */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' }   // pre-load 200px before entering view
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Once visible and no cached dataUrl, render via react-pdf */
  const cacheKey = `${pdfUrl}::${pageNumber}`;
  const needsRender = visible && !dataUrl && pdfUrl;

  const handlePageRender = useCallback((page) => {
    // react-pdf v10 passes the Page proxy; grab the canvas it rendered
    try {
      const canvas = rootRef.current?.querySelector('canvas');
      if (!canvas) return;
      const url = canvas.toDataURL('image/jpeg', 0.75);
      thumbCache.set(cacheKey, url);
      setDataUrl(url);
    } catch { /* cross-origin canvas taint — leave as-is */ }
  }, [cacheKey]);

  return (
    <button
      ref={rootRef}
      className={`ife-thumb ${isActive ? 'ife-thumb--active' : ''}`}
      onClick={onClick}
      title={`Page ${pageNumber}`}
    >
      <div className="ife-thumb-img">
        {/* Show cached/rendered image */}
        {dataUrl && (
          <img src={dataUrl} alt={`p.${pageNumber}`} />
        )}

        {/* Hidden react-pdf renderer — only mounts when visible and not yet cached */}
        {needsRender && (
          <div className="ife-thumb-pdf-render" aria-hidden="true">
            <Document
              file={pdfUrl}
              loading={null}
              error={null}
              onLoadError={() => { /* suppress console throw — invalid PDF handled silently for thumbnails */ }}
            >
              <Page
                pageNumber={pageNumber}
                width={110}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={null}
                onRenderSuccess={handlePageRender}
              />
            </Document>
          </div>
        )}

        {/* Skeleton while loading */}
        {!dataUrl && (
          <div className="ife-thumb-skeleton-inner" />
        )}
      </div>
      <span className="ife-thumb-label">p.{pageNumber}</span>
    </button>
  );
});

/* ─── Zone overlay ────────────────────────────────────────────── */
const ZoneOverlay = ({ zones, selectedZone, onSelect }) => (
  <div className="ife-canvas-zones">
    {zones.map((z, index) => {
      const c = zoneColor(z.type);
      const isSelected = selectedZone?.id === z.id;
      return (
        <div
          key={z.id || index}
          className={`ife-zone ${isSelected ? 'ife-zone--selected' : ''}`}
          style={{
            left:       `${z.x}%`,
            top:        `${z.y}%`,
            width:      `${z.w}%`,
            height:     `${z.h}%`,
            background: c.bg,
            border:     `2px ${c.dash ? 'dashed' : 'solid'} ${c.border}`,
            boxSizing:  'border-box',
          }}
          onClick={() => onSelect(z)}
          title={z.label}
        >
          {/* Reading order badge — top-right corner */}
          <span
            className="ife-zone-badge"
            style={{
              background: c.border,
              color: '#fff',
            }}
          >
            {z.readingOrder ?? (index + 1)}
          </span>
        </div>
      );
    })}
  </div>
);

/* ─── ZoneEditRow — single editable zone item ─────────────────── */
const ZoneEditRow = memo(function ZoneEditRow({
  zone,
  index,
  isActive,
  isEdited,
  canEdit,
  onSelect,
  onSaveLabel,
}) {
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState('');
  const textareaRef = useRef(null);

  const c = zoneColor(zone.type);

  /* Focus textarea when entering edit mode */
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const startEdit = useCallback((e) => {
    e.stopPropagation();
    if (!canEdit) return;
    setDraft(zone.label);
    setSaveError('');
    setEditing(true);
  }, [canEdit, zone.label]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setSaveError('');
  }, []);

  const commitEdit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === zone.label) {
      cancelEdit();
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onSaveLabel(zone.id, trimmed);
      setEditing(false);
    } catch (err) {
      setSaveError(err?.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, zone.id, zone.label, onSaveLabel, cancelEdit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [commitEdit, cancelEdit]);

  return (
    <div
      className={[
        'ife-zone-item',
        isActive  ? 'ife-zone-item--active'  : '',
        isEdited  ? 'ife-zone-item--edited'  : '',
        editing   ? 'ife-zone-item--editing' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => !editing && onSelect(zone)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && !editing) onSelect(zone); }}
      aria-label={`Zone ${zone.readingOrder ?? index + 1}: ${zone.label}`}
    >
      <span
        className="ife-zone-icon"
        style={{
          background: c.bg,
          border: `1.5px ${c.dash ? 'dashed' : 'solid'} ${c.border}`,
          color: c.border,
          fontWeight: 700,
          fontSize: 11,
        }}
      >
        {zone.readingOrder ?? (index + 1)}
      </span>

      <span className="ife-zone-item-body">
        {editing ? (
          <>
            <textarea
              ref={textareaRef}
              className="ife-zone-edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              rows={2}
              disabled={saving}
              aria-label="Edit zone label"
              onClick={(e) => e.stopPropagation()}
            />
            {saveError && (
              <span className="ife-zone-edit-error">{saveError}</span>
            )}
            <span className="ife-zone-edit-hint">
              {saving ? 'Saving…' : 'Enter to save · Esc to cancel'}
            </span>
          </>
        ) : (
          <>
            <span className="ife-zone-item-name">
              {zone.label}
              {isEdited && <span className="ife-zone-edited-dot" title="Edited" />}
            </span>
            <span className="ife-zone-item-meta">{zone.type} · page</span>
          </>
        )}
      </span>

      {/* Edit pencil button — only for FXL, only when not already editing */}
      {canEdit && !editing && (
        <button
          className="ife-zone-edit-btn"
          onClick={startEdit}
          title="Edit label (double-click also works)"
          aria-label="Edit zone label"
          tabIndex={-1}
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
});

/* ─── Right panel: zones list ─────────────────────────────────── */
const ZonesList = ({
  zones,
  editedZoneIds,
  selectedZone,
  onSelect,
  onSaveLabel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentPage,
  jobType,
  zonesLoading,
}) => {
  const canEdit = jobType === 'FXL';

  return (
    <div className="ife-zones-panel">
      {/* Header row with title + undo/redo */}
      <div className="ife-zones-title">
        <span>
          ZONES ON THIS PAGE
          {zones.length > 0 && (
            <span className="ife-zones-count">{zones.length}</span>
          )}
        </span>
        {canEdit && (
          <span className="ife-zones-undo-row">
            <button
              className="ife-zones-undo-btn"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 size={13} />
            </button>
            <button
              className="ife-zones-undo-btn"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <Redo2 size={13} />
            </button>
          </span>
        )}
      </div>

      <div className="ife-zones-list">
        {zonesLoading ? (
          <div className="ife-zones-loading">
            <Loader2 size={18} className="ife-zones-spinner" />
            <span>Loading zones…</span>
          </div>
        ) : !canEdit ? (
          <div className="ife-zones-empty">
            <AlertCircle size={20} style={{ color: '#f59e0b', marginBottom: 6 }} />
            <strong>No zones available</strong>
            <span>
              This is a <strong>{jobType || 'REFLOW'}</strong> job.
              Zones are only generated for FXL jobs.
            </span>
          </div>
        ) : zones.length === 0 ? (
          <div className="ife-zones-empty">
            <Layers size={20} style={{ color: '#9ca3af', marginBottom: 6 }} />
            <strong>No zones on page {currentPage}</strong>
            <span>This page has no detected zones.</span>
          </div>
        ) : null}

        {!zonesLoading && canEdit && zones.map((z, index) => (
          <ZoneEditRow
            key={z.id || index}
            zone={z}
            index={index}
            isActive={selectedZone?.id === z.id}
            isEdited={editedZoneIds.has(z.id)}
            canEdit={canEdit}
            onSelect={onSelect}
            onSaveLabel={onSaveLabel}
          />
        ))}
      </div>
    </div>
  );
};

/* ─── PDF Viewer ──────────────────────────────────────────────── */
const PdfViewer = ({ pdfUrl, currentPage, totalPages, onPageChange, onTotalPages, zoom, zones, selectedZone, onSelectZone }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const scrollRef             = useRef(null);

  const onDocLoad = useCallback(({ numPages }) => {
    setLoading(false);
    setError('');
    onTotalPages(numPages);
  }, [onTotalPages]);

  const onDocError = useCallback((err) => {
    setLoading(false);
    const msg = err?.message || 'Failed to load PDF';
    // InvalidPDFException means the file is corrupt or truncated — show a clear message
    if (msg.includes('Invalid PDF') || msg.includes('InvalidPDF')) {
      setError('The PDF file appears to be corrupted or has an invalid structure. Try re-running the conversion.');
    } else {
      setError(msg);
    }
  }, []);

  /* Scroll to the active page when currentPage changes */
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-page-number="${currentPage}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

  if (!pdfUrl) {
    return (
      <div className="ife-pdf-empty">
        <FileText size={48} />
        <p>No PDF selected</p>
      </div>
    );
  }

  return (
    <div className="ife-canvas-scroll" ref={scrollRef}>
      {loading && (
        <div className="ife-pdf-loading">
          <div className="ife-spinner" />
          <span>Loading PDF…</span>
        </div>
      )}
      {error && (
        <div className="ife-pdf-error">
          <X size={20} />
          <span>{error}</span>
        </div>
      )}
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocLoad}
        onLoadError={onDocError}
        loading={null}
        className="ife-pdf-document"
      >
        {Array.from({ length: totalPages || 1 }, (_, i) => i + 1).map(pageNum => (
          <div
            key={pageNum}
            className={`ife-pdf-page-wrap ${pageNum === currentPage ? 'ife-pdf-page-wrap--active' : ''}`}
            data-page-number={pageNum}
            onClick={() => onPageChange(pageNum)}
          >
            {/* Page number label */}
            <div className="ife-pdf-page-num">Page {pageNum}</div>

            {/* react-pdf Page */}
            <div className="ife-pdf-page-inner">
              <Page
                pageNumber={pageNum}
                scale={zoom / 100}
                renderTextLayer={true}
                renderAnnotationLayer={false}
                loading={
                  <div className="ife-pdf-page-skeleton">
                    <div className="ife-thumb--skeleton" style={{ width: '100%', height: '100%', borderRadius: 4 }} />
                  </div>
                }
              />
              {/* Zone overlays only on active page */}
              {pageNum === currentPage && (
                <ZoneOverlay zones={zones} selectedZone={selectedZone} onSelect={onSelectZone} />
              )}
            </div>
          </div>
        ))}
      </Document>
    </div>
  );
};

/* ─── Job selector ────────────────────────────────────────────── */
const JobSelector = ({ jobs, onSelect, loading }) => {
  const [tab, setTab] = useState('FXL');

  const fxlJobs    = jobs.filter(j => j.jobType === 'FXL');
  const reflowJobs = jobs.filter(j => j.jobType !== 'FXL');
  const visible    = tab === 'FXL' ? fxlJobs : reflowJobs;

  return (
    <div className="ife-selector-root">
      <div className="ife-selector-header">
        <h2 className="ife-selector-title">Image Editor &amp; FXL Studio</h2>
        <p className="ife-selector-sub">
          Select a completed FXL job to view zones overlaid on the PDF.
          Reflow jobs are also available but do not have zone data.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="ife-selector-tabs">
        <button
          className={`ife-selector-tab ${tab === 'FXL' ? 'ife-selector-tab--active' : ''}`}
          onClick={() => setTab('FXL')}
        >
          <Layers size={14} />
          FXL Jobs
          <span className="ife-selector-tab-count">{fxlJobs.length}</span>
        </button>
        <button
          className={`ife-selector-tab ${tab === 'REFLOW' ? 'ife-selector-tab--active' : ''}`}
          onClick={() => setTab('REFLOW')}
        >
          <FileText size={14} />
          Reflow Jobs
          <span className="ife-selector-tab-count">{reflowJobs.length}</span>
        </button>
      </div>

      {/* FXL info banner */}
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
          {visible.map(job => {
            const jobId = job.id ?? job.jobId;
            const pdfId = job.pdfDocumentId ?? job.pdfId;
            const isFxl = job.jobType === 'FXL';
            return (
              <button key={jobId} className="ife-job-card" onClick={() => onSelect(job)}>
                <div className="ife-job-card-thumb-wrap">
                  <IfeJobCardThumb jobId={jobId} pdfId={pdfId} />
                  {isFxl && (
                    <span className="ife-job-card-zones-badge">
                      <Layers size={10} /> Zones
                    </span>
                  )}
                </div>
                <div className="ife-job-card-body">
                  <div className="ife-job-card-id">Job #{jobId}</div>
                  <div className="ife-job-card-name">{job.pdfFilename || `PDF ${pdfId}`}</div>
                  <div className="ife-job-card-meta">
                    <span className={`ife-type-pill ${isFxl ? 'ife-type-fxl' : 'ife-type-reflow'}`}>
                      {isFxl ? 'FXL' : 'Reflow'}
                    </span>
                    <span className="ife-status-pill">✓ Completed</span>
                  </div>
                </div>
                <span className="ife-job-card-open">
                  {isFxl ? 'Open with Zones →' : 'Open Editor →'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ─── Main component ──────────────────────────────────────────── */
const ImageFxlEditor = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params   = useParams();

  const [selectedJob, setSelectedJob]     = useState(null);
  /* PDF viewer state */
  const [pdfUrl, setPdfUrl]               = useState('');
  const [currentPage, setCurrentPage]     = useState(1);
  const [totalPages, setTotalPages]       = useState(0);
  const [zoom, setZoom]                   = useState(100);
  /**
   * activeTool: "zone" | "image" | "ocr" | "autofix"
   * Controls which view is rendered in the canvas and right panel.
   */
  const [activeTool, setActiveTool]       = useState('zone');
  /* Zones keyed by 1-based page number */
  const [zonesByPage, setZonesByPage]     = useState({});   // { [pageNumber]: Zone[] }
  const [zonesFetched, setZonesFetched]   = useState(false); // guard: fetch only once per job
  const [zonesLoading, setZonesLoading]   = useState(false);
  const [selectedZone, setSelectedZone]   = useState(null);
  /* Undo/redo for the current page's zones */
  const {
    zones,
    setZones,
    resetZones,
    updateZone,
    undo: undoZones,
    redo: redoZones,
    canUndo,
    canRedo,
  } = useZoneUndoRedo([]);
  /* Track which zone ids have been locally edited (for highlight) */
  const [editedZoneIds, setEditedZoneIds] = useState(() => new Set());
  /* OCR / autofix data (fetched lazily) */
  const [ocrData, setOcrData]             = useState(null);
  const [ocrLoading, setOcrLoading]       = useState(false);
  const [autofixData, setAutofixData]     = useState(null);
  const [autofixLoading, setAutofixLoading] = useState(false);
  /* UI state */
  const [studioLoading, setStudioLoading] = useState(false);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [error, setError]                 = useState('');

  /* ── Image gallery state (for REFLOW image tool) ── */
  const [galleryImages, setGalleryImages]       = useState([]);
  const [galleryLoading, setGalleryLoading]     = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const fileInputRef                            = useRef(null);

  /* ── Read completed jobs from the shared React Query cache ── */
  // allJobs and jobsLoading are derived directly — no setState, no infinite loop.
  const { jobs: allJobs, isLoading: jobsLoading } = useConversionsQuery({
    statusFilter: 'COMPLETED',
  });

  // Auto-select a job from URL params / navigation state — runs only once when
  // the job list first loads (jobsLoading flips false). Uses a ref guard so it
  // never re-runs on subsequent React Query background refetches.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (jobsLoading || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    const stateJobId = location.state?.jobId ?? params?.jobId;
    if (!stateJobId) return;
    const found = allJobs.find(j => String(j.id ?? j.jobId) === String(stateJobId));
    if (found) setSelectedJob(found);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsLoading]); // intentionally only on loading flip — not on allJobs reference changes

  /* ── Load PDF for selected job: axios + blob URL (react-pdf cannot rely on /api relative URLs) ── */
  useEffect(() => {
    if (!selectedJob) {
      setPdfUrl('');
      return;
    }
    const pdfId = selectedJob.pdfDocumentId ?? selectedJob.pdfId;
    if (!pdfId) {
      setError('No PDF associated with this job');
      setPdfUrl('');
      return;
    }

    setStudioLoading(true);
    setCurrentPage(1);
    setTotalPages(0);
    setZonesByPage({});
    setZonesFetched(false);
    resetZones([]);
    setZonesLoading(false);
    setSelectedZone(null);
    setEditedZoneIds(new Set());
    setOcrData(null);
    setAutofixData(null);
    setError('');
    setActiveTool(selectedJob.jobType === 'FXL' ? 'zone' : 'image');
    setPdfUrl('');

    let alive = true;
    let blobUrlToRevoke = null;

    (async () => {
      try {
        const res = await api.get(`/pdfs/${encodeURIComponent(pdfId)}/view`, {
          responseType: 'arraybuffer',
          headers: { Accept: 'application/pdf' },
        });
        const bytes = res.data;
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 8) {
          throw new Error('Empty or invalid PDF response from server.');
        }

        // Check for non-PDF responses (HTML error pages, JSON errors) using raw bytes.
        // We check the first 512 bytes as a Latin-1 string (1:1 byte→char, no corruption).
        const headStr = String.fromCharCode(...new Uint8Array(bytes).slice(0, 512));
        const headTrimmed = headStr.trimStart();
        if (headTrimmed.startsWith('<!') || headTrimmed.startsWith('<html') || headTrimmed.startsWith('{')) {
          throw new Error('Server returned a non-PDF response (often HTML or JSON). Check API base URL and login.');
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        blobUrlToRevoke = objectUrl;
        setPdfUrl(objectUrl);
      } catch (err) {
        if (!alive) return;
        let msg = err.message || 'Failed to load PDF';
        if (err.response?.status === 401) msg = 'Session expired or not authorized to open this PDF.';
        else if (err.response?.status === 404) msg = 'PDF file not found.';
        else if (err.response?.data && typeof err.response.data === 'object' && err.response.data.error) {
          msg = err.response.data.error;
        }
        setError(msg);
        setPdfUrl('');
      } finally {
        if (alive) setStudioLoading(false);
      }
    })();

    console.log(`[IFE] Job selected — id=${selectedJob.id ?? selectedJob.jobId} type=${selectedJob.jobType}`);

    return () => {
      alive = false;
      if (blobUrlToRevoke) {
        // Evict thumbnail cache entries for this blob URL to free memory
        for (const key of thumbCache.keys()) {
          if (key.startsWith(blobUrlToRevoke)) thumbCache.delete(key);
        }
        URL.revokeObjectURL(blobUrlToRevoke);
        blobUrlToRevoke = null;
      }
    };
  }, [selectedJob]);

  /* ── Fetch zones lazily when activeTool = "zone" ── */
  useEffect(() => {
    if (activeTool !== 'zone') return;
    if (!selectedJob) return;
    if (zonesFetched) return;                          // already fetched for this job
    if (selectedJob.jobType !== 'FXL') return;         // REFLOW has no zones

    const jobId = selectedJob.id ?? selectedJob.jobId;
    console.log(`[IFE] Fetching zones for job ${jobId}…`);
    setZonesLoading(true);

    api.get(`/kitaboo/ready/${jobId}`)
      .then(res => {
        const payload = res.data?.data ?? res.data;
        console.log('[IFE] /kitaboo/ready response:', JSON.stringify(payload, null, 2));

        if (!payload?.ready) {
          console.warn('[IFE] ready=false — job not yet processed through kitaboo pipeline');
          return;
        }
        if (!Array.isArray(payload.pages) || payload.pages.length === 0) {
          console.warn('[IFE] ready=true but pages array is empty');
          return;
        }

        /* Build zonesByPage: { pageNumber(1-based): Zone[] } */
        const byPage = {};
        payload.pages.forEach(page => {
          const pn   = page.pageNumber;
          const dims = page.dimensions ?? null;
          const normalized = (page.zones ?? []).map((z, i) => normalizeZone(z, i, dims));
          byPage[pn] = normalized;
          console.log(`[IFE] page ${pn}: ${normalized.length} zones (dims: ${dims?.width}×${dims?.height})`);
        });

        console.log('[IFE] zonesByPage keys:', Object.keys(byPage));
        setZonesByPage(byPage);
        resetZones(byPage[currentPage] ?? []);
      })
      .catch(err => {
        console.error('[IFE] Failed to fetch zones:', err.message, err.response?.data);
        setError('Failed to load zones: ' + (err.response?.data?.message || err.message));
      })
      .finally(() => {
        setZonesLoading(false);
        setZonesFetched(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedJob, zonesFetched]);

  /* ── Update visible zones when currentPage changes ── */
  useEffect(() => {
    if (!selectedJob) return;
    setSelectedZone(null);
    if (activeTool === 'zone') {
      const pageZones = zonesByPage[currentPage] ?? [];
      console.log(`[IFE] currentPage=${currentPage}, zones:`, pageZones);
      // resetZones instead of setZones — page navigation must not pollute the
      // undo stack with cross-page state; each page gets a fresh history.
      resetZones(pageZones);
    }
  }, [currentPage, zonesByPage, selectedJob, activeTool]);

  /* ── Tool change handler ── */
  const handleToolChange = (tool) => {
    setActiveTool(tool);
    setSelectedZone(null);
    // When switching to zone tool, zones will be fetched by the lazy effect above.
    // When switching away, clear active zone selection but keep cached data.
    if (tool === 'zone' && zonesFetched) {
      // Already fetched — just re-sync current page zones (no history entry)
      resetZones(zonesByPage[currentPage] ?? []);
    }
  };

  /* ── Keyboard: Ctrl+Z / Ctrl+Y for undo/redo ── */
  useEffect(() => {
    if (selectedJob?.jobType !== 'FXL') return;
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      // Don't intercept while a textarea is focused (let the browser handle it there)
      if (document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        undoZones();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redoZones();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedJob, undoZones, redoZones]);

  /**
   * handleSaveLabel — optimistic update + POST /kitaboo/save-zones/:jobId/:pageNumber
   *
   * The backend has no single-zone PATCH endpoint. Zone IDs like "p2_w5" are
   * synthetic frontend identifiers, not DB primary keys. The correct pattern
   * (same as KitabooZoningStudio) is to POST the full updated zones array for
   * the current page.
   *
   * After a successful save we also update zonesByPage so that navigating away
   * and back to this page does not revert the label to the stale cached value.
   */
  const handleSaveLabel = useCallback(async (zoneId, newLabel) => {
    const prevLabel = zones.find(z => z.id === zoneId)?.label ?? newLabel;

    // 1. Build the updated zones array BEFORE the optimistic state update so we
    //    have a stable snapshot to send to the API and to write into zonesByPage.
    const updatedZones = zones.map(z =>
      z.id === zoneId ? { ...z, label: newLabel, content: newLabel } : z
    );

    // 2. Optimistic update — immediately reflect in the undo/redo state and overlay
    updateZone(zoneId, { label: newLabel, content: newLabel });
    setEditedZoneIds(prev => new Set([...prev, zoneId]));

    // 3. Keep zonesByPage in sync so page navigation doesn't revert the label
    setZonesByPage(prev => ({
      ...prev,
      [currentPage]: updatedZones,
    }));

    // 4. Persist to the API — POST full page zones (same as KitabooZoningStudio.handleSave)
    try {
      const jId = selectedJob?.id ?? selectedJob?.jobId;
      await api.post(`/kitaboo/save-zones/${encodeURIComponent(jId)}/${currentPage}`, {
        zones: updatedZones.map(z => ({
          id:           z.id,
          type:         z.type,
          content:      z.label,   // backend stores text as "content"
          label:        z.label,
          x:            z.x,
          y:            z.y,
          w:            z.w,
          h:            z.h,
          readingOrder: z.readingOrder,
        })),
      });
    } catch (err) {
      // Roll back both the undo/redo state and the zonesByPage cache
      updateZone(zoneId, { label: prevLabel, content: prevLabel });
      setZonesByPage(prev => ({
        ...prev,
        [currentPage]: zones, // restore original snapshot
      }));
      setEditedZoneIds(prev => {
        const next = new Set(prev);
        next.delete(zoneId);
        return next;
      });
      // Re-throw so ZoneEditRow can show the inline error
      throw err;
    }
  }, [updateZone, zones, selectedJob, currentPage, setZonesByPage]);

  /* ── Load images for the selected job ── */
  const loadGalleryImages = useCallback(async () => {
    if (!selectedJob) return;
    const jId = selectedJob.id ?? selectedJob.jobId;
    setGalleryLoading(true);
    try {
      /* server images */
      const res        = await api.get(`/conversions/${jId}/images`);
      const serverList = res.data?.data ?? [];
      const baseURL    = api.defaults.baseURL || '';

      const withUrls = serverList.map(img => {
        let url = img.url || '';
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          if (url.startsWith('/api/')) url = `${baseURL}${url.substring(4)}`;
          else if (url.startsWith('/'))  url = `${baseURL}${url}`;
          else                           url = `${baseURL}/conversions/${jId}/images/${url}`;
        }
        return { ...img, url: withAuthImageQuery(url), originalUrl: img.url };
      });

      /* local (IndexedDB) images */
      const localList = await getLocalImages(jId);
      setGalleryImages([...withUrls, ...localList]);
    } catch (err) {
      console.error('[IFE] Failed to load gallery images:', err.message);
    } finally {
      setGalleryLoading(false);
    }
  }, [selectedJob]);

  /* Load gallery when image tool becomes active */
  useEffect(() => {
    if (activeTool === 'image' && selectedJob) {
      loadGalleryImages();
    }
  }, [activeTool, selectedJob, loadGalleryImages]);

  /* ── Upload images ── */
  const handleImageUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !selectedJob) return;
    const jId = selectedJob.id ?? selectedJob.jobId;
    setGalleryUploading(true);
    try {
      /* try server upload */
      try {
        const formData = new FormData();
        files.forEach(f => formData.append('images', f));
        await conversionService.uploadJobImages(jId, formData);
        await loadGalleryImages();
      } catch {
        /* fallback: IndexedDB */
        const reads = files.map((file, i) =>
          new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = ev => resolve({
              fileName: file.name,
              url: ev.target.result,
              isLocal: true,
              uploadedAt: Date.now(),
              id: `local_${Date.now()}_${i}`,
            });
            reader.readAsDataURL(file);
          })
        );
        const resolved = await Promise.all(reads);
        const existing = await getLocalImages(jId);
        await saveLocalImages(jId, [...existing, ...resolved]);
        await loadGalleryImages();
      }
    } catch (err) {
      setError('Failed to upload images: ' + err.message);
    } finally {
      setGalleryUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [selectedJob, loadGalleryImages]);

  /* ── Remove a local image ── */
  const handleRemoveLocalImage = useCallback(async (imgId) => {
    if (!selectedJob) return;
    const jId = selectedJob.id ?? selectedJob.jobId;
    const existing = await getLocalImages(jId);
    await saveLocalImages(jId, existing.filter(i => i.id !== imgId));
    await loadGalleryImages();
  }, [selectedJob, loadGalleryImages]);

  /* ── Clear all local images ── */
  const handleClearLocalImages = useCallback(async () => {
    if (!selectedJob) return;
    if (!window.confirm('Clear all locally stored images? This cannot be undone.')) return;
    const jId = selectedJob.id ?? selectedJob.jobId;
    await deleteLocalImages(jId);
    await loadGalleryImages();
  }, [selectedJob, loadGalleryImages]);

  /* ── Zoom helpers ── */
  const zoomIn  = () => setZoom(z => Math.min(z + 25, 200));
  const zoomOut = () => setZoom(z => Math.max(z - 25, 50));
  const zoomFit = () => setZoom(100);

  /* ── Page navigation ── */
  const prevPage = () => setCurrentPage(p => Math.max(p - 1, 1));
  const nextPage = () => setCurrentPage(p => Math.min(p + 1, totalPages || p));

  const handlePageInput = (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) setCurrentPage(val);
  };

  /* ── Save ── */
  const handleSave = async () => {
    if (!selectedJob) return;
    setSaving(true);
    try {
      await new Promise(r => setTimeout(r, 600));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    await handleSave();
    navigate('/conversions/audio-sync', { state: { jobId: selectedJob?.id ?? selectedJob?.jobId } });
  };

  /* ── No job selected → show selector ── */
  if (!selectedJob) {
    return (
      <DndProvider backend={HTML5Backend}>
      <div className="ife-root">
        <div className="ife-topbar">
          <div className="ife-topbar-left">
            <h1 className="ife-topbar-title">Image Editor &amp; FXL Studio</h1>
          </div>
          <div className="ife-topbar-right">
            <button className="ife-back-btn" onClick={() => navigate('/conversions')}>
              <ArrowLeft size={15} /> Back to jobs
            </button>
          </div>
        </div>
        <WorkflowStepper activeStep={1} jobId={null} onStepClick={s => navigate(s.path)} />
        <JobSelector jobs={allJobs} onSelect={setSelectedJob} loading={jobsLoading} />
      </div>
      </DndProvider>
    );
  }

  const jobId = selectedJob.id ?? selectedJob.jobId;
  const pdfId = selectedJob.pdfDocumentId ?? selectedJob.pdfId;

  return (
    <DndProvider backend={HTML5Backend}>
    <div className="ife-root ife-root--studio">

      {/* ── Top bar ── */}
      <div className="ife-topbar">
        <div className="ife-topbar-left">
          <h1 className="ife-topbar-title">Image Editor &amp; FXL Studio</h1>
          <span className="ife-job-chip">Job #{jobId}</span>
          {selectedJob.pdfFilename && (
            <span className="ife-pdf-name-chip" title={selectedJob.pdfFilename}>
              {selectedJob.pdfFilename.replace(/\.pdf$/i, '')}
            </span>
          )}
        </div>
        <div className="ife-topbar-right">
          {saved && <span className="ife-saved-toast">✓ Saved</span>}
          <button className="ife-back-btn" onClick={() => setSelectedJob(null)}>
            <ArrowLeft size={15} /> Back to jobs
          </button>
          <button className="ife-save-btn" onClick={handleSaveAndContinue} disabled={saving}>
            {saving
              ? <><div className="ife-btn-spinner" /> Saving…</>
              : <><Check size={15} /> Save &amp; continue</>}
          </button>
        </div>
      </div>

      {/* ── Stepper ── */}
      <WorkflowStepper activeStep={1} jobId={jobId} onStepClick={s => navigate(s.path)} />

      {/* ── Debug info bar (remove once zones confirmed working) ── */}
      {import.meta.env.DEV && (
        <div style={{ background: '#1e293b', color: '#94a3b8', fontSize: 11, padding: '4px 14px', fontFamily: 'monospace', flexShrink: 0, display: 'flex', gap: 16 }}>
          <span>jobType: <strong style={{ color: '#38bdf8' }}>{selectedJob.jobType ?? 'unknown'}</strong></span>
          <span>activeTool: <strong style={{ color: '#38bdf8' }}>{activeTool}</strong></span>
          <span>page: <strong style={{ color: '#38bdf8' }}>{currentPage}</strong></span>
          <span>zones on page: <strong style={{ color: zones.length > 0 ? '#4ade80' : '#f87171' }}>{zones.length}</strong></span>
          <span>zonesByPage keys: <strong style={{ color: '#38bdf8' }}>[{Object.keys(zonesByPage).join(', ') || 'none'}]</strong></span>
          <span>zonesFetched: <strong style={{ color: zonesFetched ? '#4ade80' : '#f87171' }}>{String(zonesFetched)}</strong></span>
        </div>
      )}

      {error && (
        <div className="ife-error-bar">
          {error}
          <button onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      {/* ── Studio layout ── */}
      <div className="ife-studio">

        {/* LEFT: page thumbnails */}
        <aside className="ife-pages-panel">
          <div className="ife-pages-header">
            PAGES
            <span className="ife-pages-count">{totalPages || '…'}</span>
          </div>
          <div className="ife-pages-list">
            {studioLoading
              ? Array.from({ length: 6 }, (_, i) => <div key={i} className="ife-thumb ife-thumb--skeleton" />)
              : totalPages > 0
                ? Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                    <PageThumb
                      key={pageNum}
                      pageNumber={pageNum}
                      pdfUrl={pdfUrl}
                      isActive={pageNum === currentPage}
                      onClick={() => setCurrentPage(pageNum)}
                    />
                  ))
                : <div className="ife-pages-loading"><div className="ife-spinner" /></div>
            }
          </div>
        </aside>

        {/* CENTER: PDF viewer */}
        <main className="ife-canvas-area">

          {/* ── Toolbar ── */}
          <div className="ife-toolbar">
            {/* Tool buttons */}
            <div className="ife-toolbar-modes">
              {[
                { key: 'zone',    label: 'Zone',     Icon: LayoutGrid },
                { key: 'image',   label: 'Image',    Icon: Image      },
                { key: 'ocr',     label: 'OCR',      Icon: FileText   },
                { key: 'autofix', label: 'Auto-fix', Icon: RefreshCw  },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`ife-mode-btn ${activeTool === key ? 'ife-mode-btn--active' : ''}`}
                  onClick={() => handleToolChange(key)}
                  title={label}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Page navigation — center */}
            <div className="ife-toolbar-pager">
              <button
                className="ife-pager-btn"
                onClick={prevPage}
                disabled={currentPage <= 1}
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <input
                className="ife-pager-input"
                type="number"
                min={1}
                max={totalPages || 1}
                value={currentPage}
                onChange={handlePageInput}
                aria-label="Current page"
              />
              <span className="ife-pager-sep">/ {totalPages || '…'}</span>
              <button
                className="ife-pager-btn"
                onClick={nextPage}
                disabled={currentPage >= totalPages}
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Zoom controls */}
            <div className="ife-toolbar-zoom">
              <button className="ife-zoom-btn" onClick={zoomOut} title="Zoom out" disabled={zoom <= 50}>
                <ZoomOut size={15} />
              </button>
              <span className="ife-zoom-val">{zoom}%</span>
              <button className="ife-zoom-btn" onClick={zoomIn} title="Zoom in" disabled={zoom >= 200}>
                <ZoomIn size={15} />
              </button>
              <button className="ife-zoom-btn" onClick={zoomFit} title="Reset zoom">
                <Maximize2 size={15} />
              </button>
            </div>
          </div>

          {/* ── PDF viewer + tool overlays ── */}
          <div className="ife-canvas-content">
            {/* PDF viewer (always visible as the base layer) */}
            <PdfViewer
              pdfUrl={pdfUrl}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onTotalPages={setTotalPages}
              zoom={zoom}
              zones={activeTool === 'zone' ? zones : []}
              selectedZone={activeTool === 'zone' ? selectedZone : null}
              onSelectZone={activeTool === 'zone' ? setSelectedZone : () => {}}
            />

            {/* OCR overlay */}
            {activeTool === 'ocr' && (
              <div className="ife-tool-overlay">
                {ocrLoading ? (
                  <div className="ife-tool-overlay-loading">
                    <Loader2 size={22} className="ife-zones-spinner" />
                    <span>Loading OCR data…</span>
                  </div>
                ) : ocrData ? (
                  <div className="ife-ocr-content">
                    <pre className="ife-ocr-pre">{JSON.stringify(ocrData, null, 2)}</pre>
                  </div>
                ) : (
                  <div className="ife-tool-overlay-empty">
                    <FileText size={36} style={{ color: '#9ca3af', marginBottom: 10 }} />
                    <strong>No OCR data available</strong>
                    <span>OCR processing has not been run for this job yet.</span>
                  </div>
                )}
              </div>
            )}

            {/* Auto-fix overlay */}
            {activeTool === 'autofix' && (
              <div className="ife-tool-overlay">
                {autofixLoading ? (
                  <div className="ife-tool-overlay-loading">
                    <Loader2 size={22} className="ife-zones-spinner" />
                    <span>Loading processed data…</span>
                  </div>
                ) : autofixData ? (
                  <div className="ife-autofix-content">
                    <pre className="ife-ocr-pre">{JSON.stringify(autofixData, null, 2)}</pre>
                  </div>
                ) : (
                  <div className="ife-tool-overlay-empty">
                    <RefreshCw size={36} style={{ color: '#9ca3af', marginBottom: 10 }} />
                    <strong>No auto-fix data available</strong>
                    <span>Run auto-fix processing to see corrected layout data here.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* RIGHT: context panel — content depends on activeTool */}
        <aside className="ife-right-panel">
          {activeTool === 'zone' && (
            <ZonesList
              zones={zones}
              editedZoneIds={editedZoneIds}
              selectedZone={selectedZone}
              onSelect={setSelectedZone}
              onSaveLabel={handleSaveLabel}
              onUndo={undoZones}
              onRedo={redoZones}
              canUndo={canUndo}
              canRedo={canRedo}
              currentPage={currentPage}
              jobType={selectedJob.jobType}
              zonesLoading={zonesLoading}
            />
          )}

          {activeTool === 'image' && (
            <div className="ife-zones-panel ife-image-panel">
              <div className="ife-zones-title">
                <span>
                  IMAGE GALLERY
                  {galleryImages.length > 0 && (
                    <span className="ife-zones-count">{galleryImages.length}</span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {galleryImages.some(i => i.isLocal) && (
                    <button
                      className="ife-zones-undo-btn"
                      onClick={handleClearLocalImages}
                      title="Clear all local images"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <button
                    className="ife-zones-undo-btn"
                    onClick={loadGalleryImages}
                    title="Refresh gallery"
                    disabled={galleryLoading}
                  >
                    <RefreshCw size={12} className={galleryLoading ? 'ife-zones-spinner' : ''} />
                  </button>
                </div>
              </div>

              {/* Upload button */}
              <div className="ife-gallery-upload-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageUpload}
                />
                <button
                  className="ife-gallery-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={galleryUploading}
                >
                  <Upload size={13} />
                  {galleryUploading ? 'Uploading…' : 'Upload Images'}
                </button>
              </div>

              {/* Gallery grid */}
              <div className="ife-gallery-list">
                {galleryLoading ? (
                  <div className="ife-zones-loading">
                    <Loader2 size={18} className="ife-zones-spinner" />
                    <span>Loading images…</span>
                  </div>
                ) : galleryImages.length === 0 ? (
                  <div className="ife-zones-empty">
                    <Image size={20} style={{ color: '#9ca3af', marginBottom: 6 }} />
                    <strong>No images yet</strong>
                    <span>Upload images to use in this job.</span>
                  </div>
                ) : (
                  <div className="ife-gallery-grid">
                    {galleryImages.map((img, idx) => (
                      <div key={img.id ?? idx} className="ife-gallery-item-wrap">
                        <IfeGalleryImage
                          image={img}
                          onClick={() => {}}
                        />
                        {/* Local image indicator */}
                        {img.isLocal && (
                          <span className="ife-gallery-local-badge" title="Stored locally in browser">
                            💾
                          </span>
                        )}
                        {/* Remove local image button */}
                        {img.isLocal && (
                          <button
                            className="ife-gallery-remove-btn"
                            onClick={() => handleRemoveLocalImage(img.id)}
                            title="Remove local image"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTool === 'ocr' && (
            <div className="ife-zones-panel">
              <div className="ife-zones-title">OCR</div>
              <div className="ife-zones-list">
                {ocrLoading ? (
                  <div className="ife-zones-loading">
                    <Loader2 size={18} className="ife-zones-spinner" />
                    <span>Loading OCR…</span>
                  </div>
                ) : ocrData ? (
                  <div className="ife-tool-panel-info">
                    <FileText size={20} style={{ color: '#2563eb', marginBottom: 6 }} />
                    <strong>OCR results loaded</strong>
                    <span>Scroll the canvas to review extracted text.</span>
                  </div>
                ) : (
                  <div className="ife-zones-empty">
                    <FileText size={20} style={{ color: '#9ca3af', marginBottom: 6 }} />
                    <strong>No OCR data</strong>
                    <span>OCR has not been run for this job.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTool === 'autofix' && (
            <div className="ife-zones-panel">
              <div className="ife-zones-title">AUTO-FIX</div>
              <div className="ife-zones-list">
                {autofixLoading ? (
                  <div className="ife-zones-loading">
                    <Loader2 size={18} className="ife-zones-spinner" />
                    <span>Loading…</span>
                  </div>
                ) : autofixData ? (
                  <div className="ife-tool-panel-info">
                    <RefreshCw size={20} style={{ color: '#10b981', marginBottom: 6 }} />
                    <strong>Auto-fix data loaded</strong>
                    <span>Processed layout corrections are shown on the canvas.</span>
                  </div>
                ) : (
                  <div className="ife-zones-empty">
                    <RefreshCw size={20} style={{ color: '#9ca3af', marginBottom: 6 }} />
                    <strong>No auto-fix data</strong>
                    <span>Run auto-fix processing to see results here.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <button className="ife-continue-btn" onClick={handleSaveAndContinue} disabled={saving}>
            {saving ? 'Saving…' : 'Continue to Audio Sync'}
          </button>
        </aside>

      </div>
    </div>
    </DndProvider>
  );
};

export default ImageFxlEditor;
