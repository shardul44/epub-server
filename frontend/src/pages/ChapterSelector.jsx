import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useListScope } from '../context/ListScopeContext';
import { jobFromReflowStart, upsertConversionJobInCache } from '../lib/syncConversionCaches';
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Trash2,
  Play,
  FileText,
  ChevronDown,
  AlertCircle,
  Loader2,
  GripVertical,
  Hash,
  AlignLeft,
} from 'lucide-react';
import { pdfService } from '../services/pdfService';
import { conversionService } from '../services/conversionService';
import { pdfViewUrl } from '../services/api';
import './ChapterSelector.css';

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const PAGE_TYPE_LABELS = {
  regular: 'Regular Chapter',
  cover:   'Cover Page',
  toc:     'Table of Contents',
  back:    'Back Cover',
};

const PAGE_TYPE_COLORS = {
  regular: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  cover:   { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  toc:     { bg: '#fefce8', color: '#a16207', border: '#fde68a' },
  back:    { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
};

const buildDefaultPlan = (totalPages, count = 3) => {
  if (!totalPages || totalPages < 1) {
    return [{ title: 'Chapter 1', startPage: 1, endPage: 1, pageType: 'regular' }];
  }
  const plan = [];
  const perChapter = Math.max(1, Math.floor(totalPages / count));
  let cursor = 1;
  for (let i = 0; i < count && cursor <= totalPages; i++) {
    const startPage = cursor;
    const endPage = i === count - 1
      ? totalPages
      : Math.min(totalPages, cursor + perChapter - 1);
    plan.push({
      title: `Chapter ${i + 1}`,
      startPage,
      endPage: Math.max(endPage, startPage),
      pageType: 'regular',
    });
    cursor = endPage + 1;
  }
  if (plan.length === 0) {
    plan.push({ title: 'Chapter 1', startPage: 1, endPage: totalPages, pageType: 'regular' });
  }
  return plan;
};

/* ─────────────────────────────────────────────
   ChapterRow
───────────────────────────────────────────── */
const ChapterRow = ({ chapter, index, total, totalPages, onChange, onRemove }) => {
  const typeStyle = PAGE_TYPE_COLORS[chapter.pageType] || PAGE_TYPE_COLORS.regular;
  const pageCount = Math.max(0, (chapter.endPage || 0) - (chapter.startPage || 0) + 1);

  return (
    <div className="cs-chapter-row">
      {/* Drag handle + index */}
      <div className="cs-chapter-grip">
        <GripVertical size={14} className="cs-grip-icon" />
        <span className="cs-chapter-num">{index + 1}</span>
      </div>

      {/* Fields */}
      <div className="cs-chapter-fields">
        {/* Title */}
        <div className="cs-field cs-field--title">
          <label className="cs-label">
            <AlignLeft size={11} /> Title
          </label>
          <input
            className="cs-input"
            type="text"
            value={chapter.title}
            onChange={(e) => onChange(index, 'title', e.target.value)}
            placeholder="Chapter title…"
          />
        </div>

        {/* Start page */}
        <div className="cs-field cs-field--page">
          <label className="cs-label">
            <Hash size={11} /> Start
          </label>
          <input
            className="cs-input cs-input--num"
            type="number"
            min={1}
            max={totalPages}
            value={chapter.startPage}
            onChange={(e) => onChange(index, 'startPage', e.target.value)}
          />
        </div>

        {/* End page */}
        <div className="cs-field cs-field--page">
          <label className="cs-label">
            <Hash size={11} /> End
          </label>
          <input
            className="cs-input cs-input--num"
            type="number"
            min={1}
            max={totalPages}
            value={chapter.endPage}
            onChange={(e) => onChange(index, 'endPage', e.target.value)}
          />
        </div>

        {/* Page type */}
        <div className="cs-field cs-field--type">
          <label className="cs-label">
            <BookOpen size={11} /> Type
          </label>
          <div className="cs-select-wrap">
            <select
              className="cs-select"
              value={chapter.pageType || 'regular'}
              onChange={(e) => onChange(index, 'pageType', e.target.value)}
              style={{
                background: typeStyle.bg,
                color: typeStyle.color,
                borderColor: typeStyle.border,
              }}
            >
              {Object.entries(PAGE_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="cs-select-chevron" style={{ color: typeStyle.color }} />
          </div>
        </div>
      </div>

      {/* Page count badge */}
      <div className="cs-page-badge" title={`${pageCount} page${pageCount !== 1 ? 's' : ''}`}>
        {pageCount}p
      </div>

      {/* Remove */}
      <button
        className="cs-remove-btn"
        type="button"
        onClick={() => onRemove(index)}
        disabled={total <= 1}
        title="Remove chapter"
        aria-label="Remove chapter"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
const ChapterSelector = () => {
  const { pdfId } = useParams();
  const navigate  = useNavigate();
  const queryClient = useQueryClient();
  const listScope = useListScope();

  const [pdf,        setPdf]        = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [chapters,   setChapters]   = useState([]);
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);

  const previewSrc = useMemo(
    () => (pdfId ? pdfViewUrl(pdfId, previewPage) : ''),
    [pdfId, previewPage],
  );

  /* Load PDF */
  useEffect(() => {
    if (!pdfId) return;
    setLoading(true);
    pdfService.getPdfById(pdfId)
      .then((data) => {
        setPdf(data);
        setChapters(buildDefaultPlan(data?.totalPages || 1, 3));
      })
      .catch((err) => setError(err.message || 'Failed to load PDF'))
      .finally(() => setLoading(false));
  }, [pdfId]);

  /* Chapter handlers */
  const handleChange = useCallback((index, field, value) => {
    setChapters((prev) => prev.map((ch, i) => {
      if (i !== index) return ch;
      const processed = (field === 'startPage' || field === 'endPage')
        ? Number(value) || 0
        : value;
      return { ...ch, [field]: processed };
    }));
  }, []);

  const addChapter = useCallback(() => {
    const totalPages = pdf?.totalPages || 1;
    const last = chapters[chapters.length - 1];
    const nextStart = Math.min(totalPages, Math.max((last?.endPage || 0) + 1, 1));
    if (nextStart > totalPages) return;
    setChapters((prev) => [
      ...prev,
      {
        title: `Chapter ${prev.length + 1}`,
        startPage: nextStart,
        endPage: Math.min(totalPages, nextStart + Math.max(Math.floor((totalPages - nextStart + 1) / 2), 4) - 1),
        pageType: 'regular',
      },
    ]);
  }, [chapters, pdf]);

  const removeChapter = useCallback((index) => {
    if (chapters.length <= 1) return;
    setChapters((prev) => prev.filter((_, i) => i !== index));
  }, [chapters]);

  /* Validation */
  const validatePlan = () => {
    const totalPages = Number(pdf?.totalPages);
    for (const ch of chapters) {
      const start = Number(ch.startPage) || 0;
      const end   = Number(ch.endPage)   || 0;
      if (start < 1 || end < 1 || start > end)
        return 'Each chapter must have valid start and end pages.';
      if (Number.isFinite(totalPages) && totalPages > 1 && (start > totalPages || end > totalPages))
        return `Each chapter must be within 1–${totalPages}.`;
    }
    return '';
  };

  /* Submit */
  const handleSubmit = async () => {
    const msg = validatePlan();
    if (msg) { setError(msg); return; }
    setSubmitting(true);
    setError('');
    try {
      const data = await conversionService.startConversion(pdfId, {
        chapterPlan: chapters.map((ch) => ({
          title:     ch.title,
          startPage: ch.startPage,
          endPage:   ch.endPage,
          pageType:  ch.pageType || 'regular',
        })),
      });
      const job = jobFromReflowStart(data, {
        pdfId,
        filename: pdf?.originalFileName || pdf?.name || '',
      });
      if (job) {
        upsertConversionJobInCache(queryClient, listScope, job);
        navigate('/conversions', { state: { focusJobId: job.jobId } });
      } else {
        navigate('/conversions');
      }
    } catch (err) {
      setError(err.message || 'Failed to start conversion');
    } finally {
      setSubmitting(false);
    }
  };

  /* Derived */
  const totalPagesInPlan = chapters.reduce(
    (sum, ch) => sum + Math.max(0, (ch.endPage || 0) - (ch.startPage || 0) + 1), 0
  );

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="cs-page">
        <div className="cs-navbar">
          <button className="cs-back-btn" onClick={() => navigate('/pdfs/upload')}>
            <ArrowLeft size={16} /> Upload PDF
          </button>
        </div>
        <div className="cs-loading">
          <Loader2 size={32} className="cs-spinner" />
          <p>Loading PDF details…</p>
        </div>
      </div>
    );
  }

  /* ── Not found ── */
  if (!pdf) {
    return (
      <div className="cs-page">
        <div className="cs-navbar">
          <button className="cs-back-btn" onClick={() => navigate('/pdfs/upload')}>
            <ArrowLeft size={16} /> Upload PDF
          </button>
        </div>
        <div className="cs-empty">
          <FileText size={48} />
          <h3>PDF not found</h3>
          <p>The requested PDF could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cs-page">

      {/* ── Navbar ── */}
      <div className="cs-navbar">
         <span className="cs-navbar-title">Chapter Plan</span>
        <button className="cs-back-btn" onClick={() => navigate('/pdfs/upload')}>
          <ArrowLeft size={15} />
          <span>Upload PDF</span>
        </button>
      </div>

      {/* ── Page header ── */}
      <div className="cs-header">
        <div className="cs-header-left">
          <div className="cs-header-icon">
            <BookOpen size={20} />
          </div>
          <div>
            <h1 className="cs-title" title={pdf.originalFileName}>
              {pdf.originalFileName}
            </h1>
            <p className="cs-subtitle">
              {pdf.totalPages} pages · Define chapter ranges before starting conversion
            </p>
          </div>
        </div>

        <button
          className="cs-convert-btn"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <><Loader2 size={15} className="cs-spinner" /> Starting…</>
            : <><Play size={15} /> Start Conversion</>
          }
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="cs-error">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="cs-body">

        {/* ── Left: PDF preview ── */}
        <div className="cs-preview-panel">
          <div className="cs-panel-header">
            <span className="cs-panel-title">PDF Preview</span>
            <div className="cs-page-nav">
              <button
                className="cs-page-nav-btn"
                disabled={previewPage <= 1}
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
              >‹</button>
              <span className="cs-page-nav-label">
                Page {previewPage} / {pdf.totalPages}
              </span>
              <button
                className="cs-page-nav-btn"
                disabled={previewPage >= pdf.totalPages}
                onClick={() => setPreviewPage((p) => Math.min(pdf.totalPages, p + 1))}
              >›</button>
            </div>
          </div>
          <div className="cs-preview-body">
            <iframe
              key={previewPage}
              className="cs-iframe"
              title={`PDF Preview — page ${previewPage}`}
              src={previewSrc}
            />
          </div>
        </div>

        {/* ── Right: Chapter plan ── */}
        <div className="cs-plan-panel">

          {/* Panel header */}
          <div className="cs-panel-header">
            <span className="cs-panel-title">
              Chapters
              <span className="cs-chapter-count">{chapters.length}</span>
            </span>
            <div className="cs-plan-stats">
              <span className="cs-plan-stat">{totalPagesInPlan} pages planned</span>
            </div>
          </div>

          {/* Chapter list */}
          <div className="cs-chapter-list">
            {chapters.map((ch, i) => (
              <ChapterRow
                key={i}
                chapter={ch}
                index={i}
                total={chapters.length}
                totalPages={pdf.totalPages}
                onChange={handleChange}
                onRemove={removeChapter}
              />
            ))}
          </div>

          {/* Add chapter */}
          <button className="cs-add-btn" type="button" onClick={addChapter}>
            <Plus size={15} /> Add Chapter
          </button>

          {/* Actions */}
          <div className="cs-actions">
            <button
              className="cs-convert-btn cs-convert-btn--full"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <><Loader2 size={15} className="cs-spinner" /> Starting conversion…</>
                : <><Play size={15} /> Start Conversion</>
              }
            </button>
            <button
              className="cs-cancel-btn"
              type="button"
              onClick={() => navigate('/pdfs/upload')}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChapterSelector;
