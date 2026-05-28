import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { jobFromKitabooStart, upsertConversionJobInCache } from '../lib/syncConversionCaches';
import { useListScope } from '../context/ListScopeContext';
import { useAuth } from '../context/AuthContext';
import { hasFeature } from '../utils/features';
import usePdfs from '../hooks/usePdfs';
import ConfirmModal from './Loadingmodal';
import PdfCard from './PdfCard';
import PdfThumbnail from './PdfThumbnail';
import { formatFileSize } from './PdfCard';
import { kitabooService } from '../services/kitabooService';
import { pdfService } from '../services/pdfService';
import { mediaUrl } from '../utils/mediaUrl';
import { pdfViewUrl } from '../services/api';
import { isEpubImportStub } from '../utils/pdfDocumentSource';
import { resolveSyncStudioJobForPdf } from '../utils/resolveSyncStudioJob';
import { useConversionsQuery } from '../hooks/queries/useConversionsQuery';
import { audioSyncPath } from '../hooks/useWorkflowNavigation';
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Eye,
  Download,
  FileText,
  Trash2,
  Sparkles,
  Play,
  ChevronLeft,
  ChevronRight,
  X,
  Type,
  TextQuote,
  Check,
  Loader2,
  Info,
} from 'lucide-react';
import './UploadedPdfsList.css';

const FILTER_OPTIONS = [
  { value: 'All', label: 'All layouts' },
  { value: 'Reflow', label: 'Reflowable' },
  { value: 'Fixed', label: 'Fixed layout' },
];

const COPY = {
  pdf: {
    ariaLabel: 'Your uploaded PDFs',
    title: 'Your Uploaded PDFs',
    fileWord: 'file',
    searchPlaceholder: 'Search PDFs…',
    searchAria: 'Search PDFs',
    emptyTitle: 'No PDFs yet',
    emptyHint: 'Upload a PDF above to see it here.',
    previewTitle: 'Preview PDF',
    downloadTitle: 'Download PDF',
    deleteMessage: 'Are you sure you want to delete this PDF? This action cannot be undone.',
  },
  epub: {
    ariaLabel: 'Your uploaded EPUBs',
    title: 'Your Uploaded EPUBs',
    fileWord: 'file',
    searchPlaceholder: 'Search EPUBs…',
    searchAria: 'Search EPUBs',
    emptyTitle: 'No EPUBs yet',
    emptyHint: 'Import an EPUB above to see it here.',
    previewTitle: 'Open sync studio',
    downloadTitle: 'Download EPUB',
    deleteMessage: 'Are you sure you want to delete this EPUB? This action cannot be undone.',
  },
};

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

function formatUploaded(createdAt) {
  if (!createdAt) return { date: '—', time: '' };
  const d = new Date(createdAt);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

const EpubThumbPlaceholder = () => (
  <div className="upl-thumb upl-thumb-epub" aria-hidden="true">
    <span className="upl-thumb-epub-label">EPUB</span>
  </div>
);

const RowThumbnail = memo(({ pdfId, epubOnly = false }) => {
  const idKey = pdfId != null ? String(pdfId) : '';
  const cacheKey = idKey ? `pdf-thumb-card-${idKey}` : null;
  const pdfUrl = useMemo(
    () => (!epubOnly && idKey ? pdfViewUrl(idKey) : null),
    [idKey, epubOnly],
  );

  if (epubOnly) {
    return <EpubThumbPlaceholder />;
  }

  if (!pdfUrl) {
    return (
      <div className="upl-thumb upl-thumb-fallback">
        <FileText size={20} />
      </div>
    );
  }

  return (
    <div className="upl-thumb">
      <PdfThumbnail
        url={pdfUrl}
        width={44}
        height={56}
        scale={1}
        cacheKey={cacheKey}
        alt=""
        fallback={
          <div className="upl-thumb upl-thumb-fallback">
            <FileText size={20} />
          </div>
        }
      />
    </div>
  );
});
RowThumbnail.displayName = 'RowThumbnail';

const PdfTableRow = memo(({
  pdf,
  isHighlight,
  rowRef,
  onPreview,
  onDownload,
  onConvert,
  onHifi,
  onOpenEpubImport,
  onDelete,
  epubOnly = false,
}) => {
  const isFixed = pdf.layoutType === 'FIXED_LAYOUT';
  const isEpubStub = isEpubImportStub(pdf);
  const { date, time } = formatUploaded(pdf.createdAt);

  return (
    <tr ref={rowRef} className={isHighlight ? 'upl-row--highlight' : ''}>
      <td>
        <div className="upl-name-cell">
          <RowThumbnail pdfId={pdf.id} epubOnly={epubOnly} />
          <div className="upl-name-text">
            <p className="upl-name" title={pdf.originalFileName}>{pdf.originalFileName || 'Unnamed PDF'}</p>
            <p className="upl-id">ID #{pdf.id}</p>
          </div>
        </div>
      </td>
      <td className="upl-pages">
        <span className="upl-pages-num">{pdf.totalPages || 0}</span>
        <span className="upl-pages-label">pages</span>
      </td>
      <td className="upl-size">{formatFileSize(pdf.fileSize)}</td>
      <td className="upl-uploaded">
        <span className="upl-uploaded-date">{date}</span>
        {time && <span className="upl-uploaded-time">{time}</span>}
      </td>
      <td>
        <span className={`upl-layout-badge ${isFixed ? 'upl-layout-badge--fixed' : 'upl-layout-badge--reflow'}`}>
          {isFixed ? 'Fixed' : 'Reflowable'}
        </span>
      </td>
      <td>
        <div className="upl-actions">
          <button
            type="button"
            className="upl-action-btn"
            title={epubOnly ? 'Open sync studio' : 'Preview PDF'}
            onClick={() => (epubOnly ? onOpenEpubImport?.(pdf) : onPreview?.(pdf))}
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            className="upl-action-btn"
            title={epubOnly ? 'Download EPUB' : 'Download PDF'}
            onClick={() => onDownload?.(pdf)}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="upl-action-btn upl-action-btn--delete"
            title={epubOnly ? 'Delete EPUB' : 'Delete PDF'}
            onClick={() => onDelete?.(pdf.id)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
      <td>
        {!epubOnly && !isFixed && !isEpubStub ? (
          <button
            type="button"
            className="upl-convert-btn"
            onClick={() => onConvert?.(pdf)}
            title="Start Reflowable conversion"
          >
            <Play size={15} />
            Convert
          </button>
        ) : null}
        {!epubOnly && isFixed && !isEpubStub ? (
          <button
            type="button"
            className="upl-convert-btn"
            onClick={() => onHifi?.(pdf)}
            title="Start Hi-Fi FXL conversion"
          >
            <Sparkles size={15} />
            Hi-Fi FXL
          </button>
        ) : null}
        {(epubOnly || isEpubStub) && (
          <span className="upl-convert-empty">—</span>
        )}
      </td>
    </tr>
  );
});
PdfTableRow.displayName = 'PdfTableRow';

export default function UploadedPdfsList({
  highlightId = null,
  highlightName = '',
  epubOnly = false,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const listScope = useListScope();
  const { pdfs, loading, error: fetchError, refetch: loadPdfs, removePdf, deleteMutation } = usePdfs();
  const canReflowConvert = hasFeature(user, 'conversion.basic');
  const canFxlConvert = hasFeature(user, 'kitaboo.import');
  const copy = COPY[epubOnly ? 'epub' : 'pdf'];

  // Warm conversion job cache so Sync Studio can resolve EPUB import rows.
  useConversionsQuery({ enabled: epubOnly, excludeEpubImports: false });

  const libraryPdfs = useMemo(
    () => (epubOnly ? pdfs.filter(isEpubImportStub) : pdfs.filter((p) => !isEpubImportStub(p))),
    [pdfs, epubOnly],
  );

  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [hifiModalPdf, setHifiModalPdf] = useState(null);
  const [hifiZoneLevel, setHifiZoneLevel] = useState('word');
  const [hifiTocEndPage, setHifiTocEndPage] = useState('');
  const [hifiSubmitting, setHifiSubmitting] = useState(false);
  const [deleteModal, setDeleteModal] = useState({ open: false, pdfId: null });
  const [previewPdf, setPreviewPdf] = useState(null);
  const [syncOpeningId, setSyncOpeningId] = useState(null);
  const filterRef = useRef(null);
  const rowRefs = useRef({});
  const deleteModalRef = useRef(null);
  deleteModalRef.current = deleteModal;

  useEffect(() => {
    if (fetchError) setError(fetchError);
  }, [fetchError]);

  useEffect(() => {
    setPage(1);
  }, [search, filter, rowsPerPage]);

  useEffect(() => {
    if (!filterOpen) return undefined;
    const close = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  useEffect(() => {
    if (loading || highlightId == null) return undefined;
    const el = rowRefs.current[highlightId];
    if (el?.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return undefined;
  }, [loading, highlightId, libraryPdfs]);

  useEffect(() => {
    if (!previewPdf) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPreviewPdf(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewPdf]);

  useEffect(() => {
    if (!hifiModalPdf || hifiSubmitting) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setHifiModalPdf(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hifiModalPdf, hifiSubmitting]);

  const filtered = useMemo(() => libraryPdfs.filter((p) => {
    const matchSearch = !search || (p.originalFileName || '').toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'All' ||
      (filter === 'Fixed' && p.layoutType === 'FIXED_LAYOUT') ||
      (filter === 'Reflow' && p.layoutType !== 'FIXED_LAYOUT');
    return matchSearch && matchFilter;
  }), [libraryPdfs, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * rowsPerPage;
  const pageItems = filtered.slice(pageStart, pageStart + rowsPerPage);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const handleDelete = (id) => setDeleteModal({ open: true, pdfId: id });

  const confirmDelete = () => {
    const { pdfId } = deleteModalRef.current;
    if (!pdfId) return;
    setError('');
    deleteMutation.mutate(pdfId, {
      onSuccess: () => {
        setDeleteModal({ open: false, pdfId: null });
        try {
          localStorage.removeItem(`pdf-thumb-card-${pdfId}`);
          localStorage.removeItem(`pdf-thumb-card-hd-${pdfId}`);
        } catch (_) { /* ignore */ }
      },
      onError: (err) => {
        setDeleteModal({ open: false, pdfId: null });
        setError(err.message || 'Failed to delete PDF.');
        setTimeout(() => setError(''), 6000);
        loadPdfs();
      },
    });
  };

  const handleConvert = (pdf) => {
    if (!canReflowConvert) {
      setError('Current plan does not include Reflowable PDF to EPUB conversion.');
      setTimeout(() => setError(''), 6000);
      return;
    }
    navigate(`/chapter-plan/${pdf.id}`);
  };

  const handleHifi = (pdf) => {
    if (!canFxlConvert) {
      setError('Current plan does not include Hi-fi FXL PDF to EPUB conversion.');
      setTimeout(() => setError(''), 6000);
      return;
    }
    if (isEpubImportStub(pdf)) {
      handleOpenEpubImport(pdf);
      return;
    }
    setHifiModalPdf(pdf);
    setHifiZoneLevel('word');
    setHifiTocEndPage('');
  };

  const handleOpenEpubImport = useCallback(async (pdf) => {
    if (!pdf?.id) return;
    setSyncOpeningId(pdf.id);
    setError('');
    try {
      const resolved = await resolveSyncStudioJobForPdf(pdf, { queryClient, listScope });
      if (resolved?.job) {
        const jobForNav = {
          ...resolved.job,
          jobType: resolved.isFxl ? 'FXL' : 'REFLOW',
          layoutType: pdf.layoutType,
        };
        navigate(audioSyncPath(jobForNav));
        return;
      }
      setError(
        'No sync job found for this EPUB. Upload it again with the form above, or check Conversion Jobs.',
      );
      setTimeout(() => setError(''), 8000);
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Could not open Sync Studio.';
      setError(msg);
      setTimeout(() => setError(''), 8000);
    } finally {
      setSyncOpeningId(null);
    }
  }, [queryClient, listScope, navigate]);

  const handlePreview = useCallback((pdf) => {
    if (pdf?.id) setPreviewPdf(pdf);
  }, []);

  const handleDownload = useCallback(async (pdf) => {
    if (!pdf?.id) return;
    setError('');
    try {
      await pdfService.downloadPdf(pdf.id, pdf.originalFileName || pdf.fileName);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Download failed.');
      setTimeout(() => setError(''), 6000);
    }
  }, []);

  const previewSrc = useMemo(
    () => (previewPdf?.id ? mediaUrl(`/api/pdfs/${previewPdf.id}/view`) : ''),
    [previewPdf?.id],
  );

  const filterLabel = FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? 'Filter';
  const showingFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const showingTo = Math.min(pageStart + rowsPerPage, filtered.length);

  return (
    <section className="upl-section" aria-label={copy.ariaLabel}>
      <div className="upl-card">
        <div className="upl-header">
          <div className="upl-header-left">
            <h2 className="upl-title">{copy.title}</h2>
            <span className="upl-count-badge">
              {loading ? '…' : `${libraryPdfs.length} ${copy.fileWord}${libraryPdfs.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="upl-header-right">
            <div className="upl-search-wrap">
              <Search className="upl-search-icon" size={16} />
              <input
                className="upl-search"
                type="search"
                placeholder={copy.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={copy.searchAria}
              />
            </div>
            <div className="upl-filter-wrap" ref={filterRef}>
              <button
                type="button"
                className={`upl-filter-btn${filterOpen ? ' upl-filter-btn--open' : ''}${filter !== 'All' ? ' upl-filter-btn--open' : ''}`}
                onClick={() => setFilterOpen((o) => !o)}
                aria-expanded={filterOpen}
                aria-haspopup="listbox"
              >
                <SlidersHorizontal size={16} />
                {filter === 'All' ? 'Filter' : filterLabel}
              </button>
              {filterOpen && (
                <div className="upl-filter-menu" role="listbox">
                  {FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={filter === opt.value}
                      className={`upl-filter-option${filter === opt.value ? ' upl-filter-option--active' : ''}`}
                      onClick={() => {
                        setFilter(opt.value);
                        setFilterOpen(false);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="upl-view-toggle">
              <button
                type="button"
                className={`upl-view-btn${viewMode === 'list' ? ' upl-view-btn--active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
                aria-pressed={viewMode === 'list'}
              >
                <List size={17} />
              </button>
              <button
                type="button"
                className={`upl-view-btn${viewMode === 'grid' ? ' upl-view-btn--active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid view"
                aria-pressed={viewMode === 'grid'}
              >
                <LayoutGrid size={17} />
              </button>
            </div>
          </div>
        </div>

        {highlightId != null && highlightName && (
          <div className="pld-highlight-banner" style={{ margin: '0 22px 12px' }}>
            <strong>Just uploaded</strong> — {highlightName} (ID #{highlightId}).
          </div>
        )}

        {error && <div className="upl-error" role="alert">{error}</div>}

        {loading ? (
          <div className="upl-table-wrap">
            <table className="upl-table">
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="upl-skeleton-row">
                    <td colSpan={7}><div className="upl-skeleton-block" style={{ width: '100%' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filtered.length === 0 ? (
          <div className="upl-empty">
            <FileText size={40} strokeWidth={1.25} />
            <h3>{search || filter !== 'All' ? 'No results found' : copy.emptyTitle}</h3>
            <p>{search || filter !== 'All' ? 'Try a different search or filter.' : copy.emptyHint}</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="upl-grid-wrap">
            <div className="pld-grid">
              {pageItems.map((pdf) => (
                <PdfCard
                  key={pdf.id}
                  pdf={pdf}
                  onConvert={handleConvert}
                  onHifi={handleHifi}
                  onDelete={handleDelete}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onOpenEpubImport={handleOpenEpubImport}
                  onFileNotFound={() => {
                    try {
                      localStorage.removeItem(`pdf-thumb-card-${pdf.id}`);
                      localStorage.removeItem(`pdf-thumb-card-hd-${pdf.id}`);
                    } catch (_) { /* ignore */ }
                    removePdf(pdf.id);
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="upl-table-wrap">
            <table className="upl-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th >Pages</th>
                  <th>Size</th>
                  <th>Uploaded on</th>
                  <th>Layout</th>
                  <th>Actions</th>
                  <th>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((pdf) => (
                  <PdfTableRow
                    key={pdf.id}
                    pdf={pdf}
                    isHighlight={highlightId != null && pdf.id === highlightId}
                    rowRef={(el) => { if (el) rowRefs.current[pdf.id] = el; }}
                    onPreview={handlePreview}
                    onDownload={handleDownload}
                    onConvert={handleConvert}
                    onHifi={handleHifi}
                    onOpenEpubImport={handleOpenEpubImport}
                    onDelete={handleDelete}
                    epubOnly={epubOnly}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <footer className="upl-footer">
            <p className="upl-footer-summary">
              Showing {showingFrom} to {showingTo} of {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </p>
            <div className="upl-pagination">
              <button
                type="button"
                className="upl-page-btn"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="upl-page-num">{safePage}</span>
              <button
                type="button"
                className="upl-page-btn"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <label className="upl-rows-per-page">
              Rows per page
              <select
                className="upl-rows-select"
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {ROWS_PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </footer>
        )}
      </div>

      {previewPdf && (
        <div className="pld-preview-overlay" onClick={() => setPreviewPdf(null)} role="presentation">
          <div
            className="pld-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upl-preview-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pld-preview-header">
              <span id="upl-preview-title" className="pld-preview-title" title={previewPdf.originalFileName}>
                {previewPdf.originalFileName || 'Unnamed PDF'}
                <span className="pld-preview-meta">
                  {' '}
                  · ID #{previewPdf.id}
                  {previewPdf.totalPages ? ` · ${previewPdf.totalPages} pages` : ''}
                </span>
              </span>
              <button type="button" className="pld-preview-close" onClick={() => setPreviewPdf(null)} aria-label="Close preview">
                <X size={16} />
              </button>
            </div>
            <iframe className="pld-preview-iframe" src={previewSrc} title={`Preview: ${previewPdf.originalFileName || 'PDF'}`} />
          </div>
        </div>
      )}

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
            aria-labelledby="upl-hifi-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="hifi-modal-header">
              <div className="hifi-modal-header-icon" aria-hidden>
                <Sparkles size={22} strokeWidth={2} />
              </div>
              <div className="hifi-modal-header-text">
                <h4 id="upl-hifi-title">Hi-Fi FXL</h4>
                <p className="hifi-modal-tagline">Glyph-level extraction · Zoning Studio zones</p>
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
                <span className="hifi-file-chip-name">{hifiModalPdf.originalFileName || hifiModalPdf.fileName || 'Unknown file'}</span>
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
                <span className="hifi-zone-option-icon"><Type size={20} strokeWidth={2} /></span>
                <span className="hifi-zone-option-copy">
                  <strong>Word level</strong>
                  <span>One zone per word</span>
                </span>
                {hifiZoneLevel === 'word' && (
                  <span className="hifi-zone-option-check" aria-hidden><Check size={18} strokeWidth={2.5} /></span>
                )}
              </button>
              <button
                type="button"
                className={`hifi-zone-option${hifiZoneLevel === 'sentence' ? ' hifi-zone-option--active' : ''}`}
                onClick={() => setHifiZoneLevel('sentence')}
                aria-pressed={hifiZoneLevel === 'sentence'}
              >
                <span className="hifi-zone-option-icon"><TextQuote size={20} strokeWidth={2} /></span>
                <span className="hifi-zone-option-copy">
                  <strong>Sentence level</strong>
                  <span>One zone per sentence</span>
                </span>
                {hifiZoneLevel === 'sentence' && (
                  <span className="hifi-zone-option-check" aria-hidden><Check size={18} strokeWidth={2.5} /></span>
                )}
              </button>
            </div>
            {hifiZoneLevel === 'sentence' && (
              <div className="hifi-toc-panel">
                <div className="hifi-toc-inner">
                  <label className="hifi-toc-label" htmlFor="upl-hifi-toc-end-page">
                    Last TOC page <span className="hifi-toc-optional">(optional)</span>
                  </label>
                  <div className="hifi-toc-controls">
                    <input
                      id="upl-hifi-toc-end-page"
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
              <button type="button" className="hifi-btn hifi-btn--ghost" onClick={() => setHifiModalPdf(null)} disabled={hifiSubmitting}>
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
                    if (hifiZoneLevel === 'sentence' && tocNum != null && !Number.isNaN(tocNum) && tocNum > 0) {
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
                    setError(err.response?.data?.message || err.message || 'Failed to start High-Fidelity FXL');
                  } finally {
                    setHifiSubmitting(false);
                  }
                }}
              >
                {hifiSubmitting ? (
                  <>
                    <Loader2 size={18} className="hifi-btn-spinner" aria-hidden />
                    Starting…
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

      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, pdfId: null })}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message={copy.deleteMessage}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </section>
  );
}
