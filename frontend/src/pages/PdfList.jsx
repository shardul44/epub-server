import { useEffect, useState, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { jobFromKitabooStart, upsertConversionJobInCache } from '../lib/syncConversionCaches';
import { useListScope } from '../context/ListScopeContext';
import usePdfs from '../hooks/usePdfs';
import ConfirmModal from '../components/Loadingmodal';
import {
  FileText,
  CloudUpload,
  Trash2,
  Play,
  Sparkles,
  Eye,
  Search,
  LayoutGrid,
  List,
  Database,
  X,
  Type,
  TextQuote,
  Check,
  Loader2,
  Info,
} from 'lucide-react';
import { kitabooService } from '../services/kitabooService';
import PdfCard, { formatFileSize, getGradient } from '../components/PdfCard';
import './PdfList.css';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Helpers
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const totalBytes = (pdfs) => pdfs.reduce((s, p) => s + (p.fileSize || 0), 0);

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   StatCard
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const StatCard = ({ icon, label, value, accent }) => (
  <div className="pld-stat-card" style={{ '--accent': accent }}>
    <div className="pld-stat-icon">{icon}</div>
    <div className="pld-stat-body">
      <span className="pld-stat-label">{label}</span>
      <span className="pld-stat-value">{value}</span>
    </div>
  </div>
);

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   PdfRow (list view)
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PdfRow = ({ pdf, onConvert, onHifi, onDelete, onPreview, isHighlight, rowRef }) => {
  const isFixed = pdf.layoutType === 'FIXED_LAYOUT';
  return (
    <tr
      ref={rowRef}
      className={`pld-row${isHighlight ? ' pld-row--highlight' : ''}`}
    >
      <td>
        <div className="pld-row-thumb" style={{ background: getGradient(pdf.id) }}>
          <FileText size={20} />
        </div>
      </td>
      <td>
        <div className="pld-row-name">{pdf.originalFileName || 'Unnamed PDF'}</div>
        <div className="pld-row-id">ID #{pdf.id}</div>
      </td>
      <td className="pld-row-center">{pdf.totalPages || 0}</td>
      <td className="pld-row-center">
        <span className={`pld-badge ${isFixed ? 'pld-badge-fxl' : 'pld-badge-reflow'}`}>
          {isFixed ? 'FXL' : 'REFLOW'}
        </span>
      </td>
      <td className="pld-row-center">{formatFileSize(pdf.fileSize)}</td>
      <td className="pld-row-date">
        {new Date(pdf.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </td>
      <td>
        <div className="pld-row-actions">
          <button
            type="button"
            className="pld-action-btn"
            onClick={() => onPreview?.(pdf)}
            title="Open PDF"
          >
            <Eye size={13} />
          </button>
          {!isFixed && (
            <button className="pld-action-btn pld-action-convert" onClick={() => onConvert(pdf)}>
              <Play size={13} /> Convert
            </button>
          )}
          {isFixed && (
            <button className="pld-action-btn pld-action-hifi" onClick={() => onHifi(pdf)}>
              <Sparkles size={13} /> Hi-Fi FXL
            </button>
          )}
          <button className="pld-action-btn pld-action-delete" onClick={() => onDelete(pdf.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Toolbar
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const Toolbar = ({ search, onSearch, filter, onFilter, viewMode, onViewMode }) => (
  <div className="pld-toolbar">
    <div className="pld-search-wrap">
      <Search className="pld-search-icon" />
      <input
        className="pld-search"
        placeholder="Search PDFs by nameâ€¦"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
    <div className="pld-filter-group">
      {['All', 'Reflow', 'Fixed'].map((f) => (
        <button
          key={f}
          className={`pld-filter-btn${filter === f ? ' active' : ''}`}
          onClick={() => onFilter(f)}
        >
          {f}
        </button>
      ))}
    </div>
    <div className="pld-view-toggle">
      <button
        className={`pld-view-btn${viewMode === 'grid' ? ' active' : ''}`}
        onClick={() => onViewMode('grid')}
        title="Grid view"
      >
        <LayoutGrid size={17} />
      </button>
      <button
        className={`pld-view-btn${viewMode === 'list' ? ' active' : ''}`}
        onClick={() => onViewMode('list')}
        title="List view"
      >
        <List size={17} />
      </button>
    </div>
  </div>
);

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Loading Skeleton
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const SkeletonCard = () => (
  <div className="pld-skeleton-card">
    <div className="pld-skeleton-visual pld-shimmer" />
    <div className="pld-skeleton-body">
      <div className="pld-skeleton-line pld-shimmer" style={{ width: '70%' }} />
      <div className="pld-skeleton-line pld-shimmer" style={{ width: '45%' }} />
    </div>
  </div>
);

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Empty State
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const EmptyState = ({ filtered }) => (
  <div className="pld-empty">
    <div className="pld-empty-icon">
      <FileText size={48} />
    </div>
    <h3>{filtered ? 'No results found' : 'No PDFs yet'}</h3>
    <p>{filtered ? 'Try a different search or filter.' : 'Upload your first PDF to get started.'}</p>
    {!filtered && (
      <Link to="/pdfs/upload" className="pld-upload-btn">
        <CloudUpload size={16} /> Upload PDF
      </Link>
    )}
  </div>
);

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Main Page
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PdfList = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const listScope = useListScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [hifiModalPdf, setHifiModalPdf] = useState(null);
  const [hifiZoneLevel, setHifiZoneLevel] = useState('word');
  const [hifiTocEndPage, setHifiTocEndPage] = useState('');
  const [hifiSubmitting, setHifiSubmitting] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, pdfId: null });

  // â”€â”€ Single source of truth for PDFs â€” no duplicate API calls â”€â”€
  const { pdfs, loading, error: fetchError, refetch: loadPdfs, removePdf, deleteMutation } = usePdfs();

  const highlightIdRaw = searchParams.get('highlight');
  const highlightId = highlightIdRaw != null && highlightIdRaw !== '' ? parseInt(highlightIdRaw, 10) : null;
  const highlightName = searchParams.get('name') || '';
  const rowRefs = useRef({});

  // NOTE: No manual refetch on ?highlight â€” mount already refetches via React Query.
  // A second loadPdfs() here would race and could overwrite fresh data with a stale response.

  // Merge fetch error into local error state for display
  useEffect(() => {
    if (fetchError) setError(fetchError);
  }, [fetchError]);

  // Refresh list when user returns to the tab after 2+ seconds away
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      if (document.visibilityState === 'visible' && hiddenAt && Date.now() - hiddenAt > 2000) loadPdfs();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadPdfs]);

  useEffect(() => {
    if (loading || highlightId == null || Number.isNaN(highlightId)) return;
    const el = rowRefs.current[highlightId];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [loading, highlightId, pdfs]);

  useEffect(() => {
    if (hifiModalPdf && !pdfs.some((p) => p.id === hifiModalPdf.id)) {
      setHifiModalPdf(null);
    }
  }, [pdfs, hifiModalPdf]);

  useEffect(() => {
    const openId = location.state?.openHifiForPdfId;
    if (!openId || loading) return;
    const target = pdfs.find((p) => String(p.id) === String(openId));
    if (target) {
      setHifiModalPdf(target);
      setHifiZoneLevel('word');
      setHifiTocEndPage('');
    }
    navigate('/pdfs', { replace: true, state: {} });
  }, [location.state, pdfs, loading, navigate]);

  const handleDelete = async (id) => {
    setDeleteModal({ open: true, pdfId: id });
  };

  // Ref so confirmDelete always reads the latest deleteModal without stale closure
  const deleteModalRef = useRef(null);
  deleteModalRef.current = deleteModal;

  const confirmDelete = () => {
    const { pdfId } = deleteModalRef.current;
    if (!pdfId) return;

    const id = pdfId;
    setError('');
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeleteModal({ open: false, pdfId: null });
        try {
          localStorage.removeItem(`pdf-thumb-card-${id}`);
        } catch (_) {
          /* ignore */
        }
      },
      onError: (err) => {
        const msg = err.message || 'Failed to delete PDF.';
        setDeleteModal({ open: false, pdfId: null });
        setError(msg);
        setTimeout(() => setError(''), 6000);
        loadPdfs();
      },
    });
  };

  const handleConvert = (pdf) => navigate(`/chapter-plan/${pdf.id}`);
  const handleHifi = (pdf) => {
    setHifiModalPdf(pdf);
    setHifiZoneLevel('word');
    setHifiTocEndPage('');
  };
  const handlePreview = (pdf) => navigate(`/pdfs/${pdf.id}`);

  useEffect(() => {
    if (!hifiModalPdf || hifiSubmitting) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setHifiModalPdf(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hifiModalPdf, hifiSubmitting]);

  /* Derived stats */
  const fixedCount = pdfs.filter((p) => p.layoutType === 'FIXED_LAYOUT').length;
  const totalPages = pdfs.reduce((s, p) => s + (p.totalPages || 0), 0);
  const storageUsed = formatFileSize(totalBytes(pdfs));

  /* Filtered list */
  const filtered = pdfs.filter((p) => {
    const matchSearch = !search || (p.originalFileName || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'All' ||
      (filter === 'Fixed' && p.layoutType === 'FIXED_LAYOUT') ||
      (filter === 'Reflow' && p.layoutType !== 'FIXED_LAYOUT');
    return matchSearch && matchFilter;
  });

  return (
    <div className="pld-page">

      {/* â”€â”€ Top Navbar â”€â”€ */}
      <div className="pld-navbar">
        <span className="pld-navbar-title">PDF Library</span>
      </div>

      {/* â”€â”€ Header â”€â”€ */}
      <div className="pld-header">
        <div className="pld-header-left">
          <h1 className="pld-title">PDF Library</h1>
          <p className="pld-subtitle">
            {listScope === 'own'
              ? 'Your uploaded PDFs â€” browse like a bookshelf.'
              : 'All source PDFs uploaded by your team â€” browse like a bookshelf.'}
          </p>
        </div>
        <Link to="/pdfs/upload" className="pld-upload-btn">
          <CloudUpload size={16} /> Upload PDF
        </Link>
      </div>

      {/* â”€â”€ Stat Cards â”€â”€ */}
      <div className="pld-stats">
        <StatCard
          icon={<FileText size={22} />}
          label="Total PDFs"
          value={pdfs.length}
          accent="#6366f1"
        />
        <StatCard
          icon={<List size={22} />}
          label="Total Pages"
          value={totalPages.toLocaleString()}
          accent="#0ea5e9"
        />
        <StatCard
          icon={<Database size={22} />}
          label="Storage Used"
          value={storageUsed}
          accent="#10b981"
        />
        <StatCard
          icon={<Sparkles size={22} />}
          label="Fixed Layout"
          value={fixedCount}
          accent="#f59e0b"
        />
      </div>

      {/* â”€â”€ Toolbar â”€â”€ */}
      <Toolbar
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />

      {/* â”€â”€ Error â”€â”€ */}
      {error && <div className="pld-error">{error}</div>}

      {/* â”€â”€ Highlight banner â”€â”€ */}
      {highlightId != null && !Number.isNaN(highlightId) && (
        <div className="pld-highlight-banner">
          <strong>Just uploaded</strong>
          {highlightName ? ` â€” ${highlightName}` : ''} (PDF ID <strong>{highlightId}</strong>).
          Use <strong>Hi-Fi FXL</strong> on this row â€” not an older document.{' '}
          <button type="button" className="pld-dismiss-btn" onClick={() => setSearchParams({})}>
            Dismiss
          </button>
        </div>
      )}

      {/* â”€â”€ Content â”€â”€ */}
      {loading ? (
        <div className="pld-grid">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filtered={search !== '' || filter !== 'All'} />
      ) : viewMode === 'grid' ? (
        <div className="pld-grid">
          {filtered.map((pdf) => {
            if (!pdf || !pdf.id) return null;
            return (
              <PdfCard
                key={pdf.id}
                pdf={pdf}
                onConvert={handleConvert}
                onHifi={handleHifi}
                onDelete={handleDelete}
                onPreview={handlePreview}
                onFileNotFound={() => {
                  // File is gone from disk â€” silently remove the orphaned card
                  // without a confirm modal (there's nothing to delete on disk).
                  try { localStorage.removeItem(`pdf-thumb-card-${pdf.id}`); } catch (_) { /* ignore */ }
                  removePdf(pdf.id);
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="pld-table-wrap">
          <table className="pld-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th className="pld-row-center">Pages</th>
                <th className="pld-row-center">Layout</th>
                <th className="pld-row-center">Size</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pdf) => {
                if (!pdf || !pdf.id) return null;
                const isHighlight = highlightId != null && !Number.isNaN(highlightId) && pdf.id === highlightId;
                return (
                  <PdfRow
                    key={pdf.id}
                    pdf={pdf}
                    isHighlight={isHighlight}
                    rowRef={(el) => { if (el) rowRefs.current[pdf.id] = el; }}
                    onConvert={handleConvert}
                    onHifi={handleHifi}
                    onDelete={handleDelete}
                    onPreview={handlePreview}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* â”€â”€ Hi-Fi Modal â”€â”€ */}
      {hifiModalPdf && (
        <div
          className="hifi-convert-modal-overlay"
          onClick={() => !hifiSubmitting && setHifiModalPdf(null)}
          role="presentation"
        >
          <div
            className="hifi-convert-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hifi-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="hifi-modal-header">
              <div className="hifi-modal-header-icon" aria-hidden>
                <Sparkles size={22} strokeWidth={2} />
              </div>
              <div className="hifi-modal-header-text">
                <h4 id="hifi-modal-title">Hi-Fi FXL</h4>
                <p className="hifi-modal-tagline">Glyph-level extraction Â· Zoning Studio zones</p>
              </div>
              <button
                type="button"
                className="hifi-modal-close"
                onClick={() => !hifiSubmitting && setHifiModalPdf(null)}
                disabled={hifiSubmitting}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </header>

            <div className="hifi-file-chip">
              <div className="hifi-file-chip-icon" aria-hidden>
                <FileText size={18} />
              </div>
              <div className="hifi-file-chip-body">
                <span className="hifi-file-chip-label">Document for this job</span>
                <span className="hifi-file-chip-name" title={hifiModalPdf.originalFileName || hifiModalPdf.fileName || ''}>
                  {hifiModalPdf.originalFileName || hifiModalPdf.fileName || 'Unknown file'}
                </span>
                <span className="hifi-file-chip-meta">PDF ID {hifiModalPdf.id}</span>
              </div>
            </div>
            <p className="hifi-hint">
              <Info size={14} aria-hidden />
              <span>If this is not the file you just uploaded, close and use Hi-Fi FXL on the correct row.</span>
            </p>

            <p className="hifi-desc">How should zones appear in Zoning Studio?</p>
            <div className="hifi-zone-options" role="group" aria-label="Zone granularity">
              <button
                type="button"
                className={`hifi-zone-option${hifiZoneLevel === 'word' ? ' hifi-zone-option--active' : ''}`}
                onClick={() => setHifiZoneLevel('word')}
                aria-pressed={hifiZoneLevel === 'word'}
              >
                <span className="hifi-zone-option-icon">
                  <Type size={20} strokeWidth={2} />
                </span>
                <span className="hifi-zone-option-copy">
                  <strong>Word level</strong>
                  <span>One zone per word</span>
                </span>
                {hifiZoneLevel === 'word' && (
                  <span className="hifi-zone-option-check" aria-hidden>
                    <Check size={18} strokeWidth={2.5} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`hifi-zone-option${hifiZoneLevel === 'sentence' ? ' hifi-zone-option--active' : ''}`}
                onClick={() => setHifiZoneLevel('sentence')}
                aria-pressed={hifiZoneLevel === 'sentence'}
              >
                <span className="hifi-zone-option-icon">
                  <TextQuote size={20} strokeWidth={2} />
                </span>
                <span className="hifi-zone-option-copy">
                  <strong>Sentence level</strong>
                  <span>One zone per sentence</span>
                </span>
                {hifiZoneLevel === 'sentence' && (
                  <span className="hifi-zone-option-check" aria-hidden>
                    <Check size={18} strokeWidth={2.5} />
                  </span>
                )}
              </button>
            </div>

            {hifiZoneLevel === 'sentence' && (
              <div className="hifi-toc-panel">
                <div className="hifi-toc-inner">
                  <label className="hifi-toc-label" htmlFor="hifi-toc-end-page">
                    Last TOC page <span className="hifi-toc-optional">(optional)</span>
                  </label>
                  <div className="hifi-toc-controls">
                    <input
                      id="hifi-toc-end-page"
                      type="number"
                      min={1}
                      placeholder="e.g. 3"
                      value={hifiTocEndPage}
                      onChange={(e) => setHifiTocEndPage(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                    <p className="hifi-toc-help">Pages 1 through N use rectangle zones when auto-detect fails.</p>
                  </div>
                </div>
              </div>
            )}

            <footer className="hifi-modal-footer">
              <button
                type="button"
                className="hifi-btn hifi-btn--ghost"
                onClick={() => setHifiModalPdf(null)}
                disabled={hifiSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hifi-btn hifi-btn--primary"
                disabled={hifiSubmitting}
                onClick={async () => {
                  const targetPdf = hifiModalPdf;
                  setHifiSubmitting(true);
                  setError('');
                  try {
                    const opts = { zoneLevel: hifiZoneLevel };
                    const tocNum = hifiTocEndPage.trim() ? parseInt(hifiTocEndPage, 10) : null;
                    if (hifiZoneLevel === 'sentence' && tocNum != null && !isNaN(tocNum) && tocNum > 0) {
                      opts.tocEndPage = tocNum;
                    }
                    const data = await kitabooService.startHighFidelity(targetPdf.id, opts);
                    const job = jobFromKitabooStart(data, {
                      pdfId: targetPdf.id,
                      filename: targetPdf.originalFileName || targetPdf.name || '',
                    });
                    if (job) {
                      upsertConversionJobInCache(queryClient, listScope, job);
                      setHifiModalPdf(null);
                      navigate('/conversions', { state: { focusJobId: job.jobId } });
                    } else {
                      setError('No job ID returned');
                    }
                  } catch (err) {
                    console.error('Failed to start High-Fidelity FXL:', err);
                    setError(err.response?.data?.message || err.message || 'Failed to start High-Fidelity FXL');
                  } finally {
                    setHifiSubmitting(false);
                  }
                }}
              >
                {hifiSubmitting ? (
                  <>
                    <Loader2 size={18} className="hifi-btn-spinner" aria-hidden />
                    Startingâ€¦
                  </>
                ) : (
                  <>
                    <Sparkles size={16} aria-hidden />
                    Start conversion
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      )}
      {/* â”€â”€ Delete confirmation modal â”€â”€ */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, pdfId: null })}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message="Are you sure you want to delete this PDF? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
};

export default PdfList;
