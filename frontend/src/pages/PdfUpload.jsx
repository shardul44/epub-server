import { useState, useRef, useCallback, useEffect } from 'react';
import useAppDispatch from '../hooks/useAppDispatch';
import useAppSelector from '../hooks/useAppSelector';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { upsertPdfInListCache } from '../lib/syncPdfCaches';
import { useListScope } from '../context/ListScopeContext';
import { UploadLoadingModal } from '../components/Loadingmodal';
import UploadedPdfsList from '../components/UploadedPdfsList';
import {
  uploadPdf as uploadPdfThunk,
  selectUploadStatus,
  selectUploadProgress,
  selectUploadError,
  selectLastUploadedDoc,
  setUploadProgress,
  resetUpload,
} from '../features/epub/epubSlice';
import { getApiBase } from '../services/api';
import {
  Upload,
  FileText,
  X,
  ShieldCheck,
  Info,
  CheckCircle,
  Image,
  Music,
  Download,
  RefreshCw,
} from 'lucide-react';
import './PdfUpload.css';

/* ─── Step indicator ──────────────────────────────────────────── */
const STEPS = ['Upload', 'Image / FXL Editor', 'Audio Sync', 'Download EPUB'];

const StepBadge = () => (
  <div className="pu-step-badge">Step 1 of 4</div>
);

/* ─── What happens next sidebar ──────────────────────────────── */
const NEXT_STEPS = [
  { icon: <RefreshCw size={16} />,  label: 'Conversion',         sub: 'Pages parsed & structured' },
  { icon: <Image size={16} />,      label: 'Image / FXL Editor', sub: 'Refine zones & layout' },
  { icon: <Music size={16} />,      label: 'Audio Sync',         sub: 'Optional narration alignment' },
  { icon: <Download size={16} />,   label: 'Download EPUB',      sub: 'Validated & ready to publish' },
];

const TIPS = [
  'Use text-based PDFs (not scans) when possible.',
  'Embed fonts in the source PDF for fidelity.',
  'Pick FXL only if exact layout matters.',
];

/* ─── Layout option card ──────────────────────────────────────── */
const LayoutCard = ({ value, selected, onSelect, title, tag, tagColor, icon, desc, recommended }) => (
  <button
    type="button"
    className={`pu-layout-card${selected ? ' pu-layout-card--active' : ''}`}
    onClick={() => onSelect(value)}
    aria-pressed={selected}
  >
    {recommended && <span className="pu-recommended">Recommended</span>}
    <div className="pu-layout-card-top">
      <span className="pu-layout-icon">{icon}</span>
      <span className="pu-layout-title">
        {title} <span className={`pu-layout-tag pu-layout-tag--${tagColor}`}>{tag}</span>
      </span>
    </div>
    <p className="pu-layout-desc">{desc}</p>
  </button>
);

/* ─── Main component ──────────────────────────────────────────── */
const PdfUpload = () => {
  const [file, setFile]             = useState(null);
  const [layoutType, setLayoutType] = useState('REFLOWABLE');
  const [localError, setLocalError] = useState('');
  const [dragOver, setDragOver]     = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [highlightPdf, setHighlightPdf] = useState({ id: null, name: '' });
  const fileInputRef                = useRef(null);
  const dispatch                    = useAppDispatch();
  const queryClient                 = useQueryClient();
  const listScope                   = useListScope();
  const tickerRef                   = useRef(null);

  // Redux upload state
  const uploadStatus  = useAppSelector(selectUploadStatus);
  const uploadProgress = useAppSelector(selectUploadProgress);
  const uploadError   = useAppSelector(selectUploadError);
  const lastDoc       = useAppSelector(selectLastUploadedDoc);

  const uploading = uploadStatus === 'loading';
  const progress  = uploadProgress;
  const error     = localError || uploadError || '';

  // Derive modal status from Redux upload state
  const uploadModalStatus =
    uploadStatus === 'succeeded' ? 'success' :
    uploadStatus === 'failed'    ? 'error'   :
    'uploading';

  // After successful upload: keep list cache hot for upload-page library actions.
  useEffect(() => {
    if (uploadStatus !== 'succeeded' || !lastDoc) return undefined;
    upsertPdfInListCache(queryClient, listScope, lastDoc);
    dispatch(setUploadProgress(100));
    setHighlightPdf({
      id: lastDoc.id,
      name: lastDoc.originalFileName || lastDoc.fileName || '',
    });
    return undefined;
  }, [uploadStatus, lastDoc, dispatch, queryClient, listScope]);

  const dismissUploadModal = () => {
    setUploadModalOpen(false);
    dispatch(resetUpload());
    clearFile();
  };

  // Auto-close success modal after 1 seconds and return to upload view.
  useEffect(() => {
    if (!uploadModalOpen || uploadModalStatus !== 'success') return undefined;
    const closeTimer = setTimeout(() => {
      dismissUploadModal();
    }, 1000);
    return () => clearTimeout(closeTimer);
  }, [uploadModalOpen, uploadModalStatus]);

  /* ── file helpers ── */
  const validateAndSet = (f) => {
    setLocalError('');
    if (!f) return;
    if (!f.type.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) {
      setLocalError('Please select a valid PDF file.');
      return;
    }
    if (f.size > 200 * 1024 * 1024) {
      setLocalError('File size must be under 200 MB.');
      return;
    }
    setFile(f);
  };

  const handleFileChange = (e) => validateAndSet(e.target.files[0]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    validateAndSet(e.dataTransfer.files[0]);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const clearFile = () => {
    setFile(null);
    setLocalError('');
    dispatch(resetUpload());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fmtSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /* ── submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setLocalError('Please select a PDF file.'); return; }

    setLocalError('');
    setUploadModalOpen(true);

    // Simulate progress ticks while the thunk runs
    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(() => {
      dispatch(setUploadProgress(
         
        Math.min(85, (uploadProgress || 0) + Math.random() * 12)
      ));
    }, 300);

    try {
      const result = await dispatch(uploadPdfThunk({ file, layoutType })).unwrap();
      // Kick off thumbnail generation in the background so it's ready when the user
      // navigates to the PDF list. Fire-and-forget — don't block the upload flow.
      if (result?.id) {
        const token = localStorage.getItem('token');
        fetch(`${getApiBase()}/pdfs/${result.id}/thumbnail`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => {/* ignore — thumbnail will be generated on first view */});
      }
    } catch {
      // error is already in Redux state via uploadError
    } finally {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  return (
    <div className="pu-page">

      {/* ── Top bar ── */}
      <div className="pu-topbar">
        <div className="pu-topbar-left">
          <h1 className="pu-topbar-title">Upload PDF</h1>
          <StepBadge />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="pu-content">

      {/* ── Body ── */}
      <div className="pu-body">

        {/* ── Left: form ── */}
        <div className="pu-main">
          <div className="pu-main-header">
            <h2 className="pu-main-title">Upload a PDF</h2>
            <p className="pu-main-sub">
              Add a PDF to your library. Open <strong>My PDFs</strong> and click <strong>Convert</strong> when you are ready to start.
            </p>
            <span className="pu-encrypted-badge">
              <ShieldCheck size={14} /> Encrypted upload
            </span>
          </div>

          <form onSubmit={handleSubmit} noValidate>

            {/* ── Drop zone ── */}
            <div className="pu-field">
              <label className="pu-field-label">
                PDF File <span className="pu-required">*</span>
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="pu-file-input"
                tabIndex={-1}
              />

              {!file ? (
                <div
                  className={`pu-dropzone${dragOver ? ' pu-dropzone--over' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                  aria-label="Upload PDF file"
                >
                  <Upload className="pu-dropzone-icon" />
                  <p className="pu-dropzone-title">Drag &amp; drop your PDF here</p>
                  <p className="pu-dropzone-sub">
                    or <span className="pu-dropzone-link">browse from your computer</span>
                  </p>
                  <div className="pu-dropzone-hints">
                    <span>PDF only</span>
                    <span className="pu-dot">·</span>
                    <span>Up to 200 MB</span>
                    <span className="pu-dot">·</span>
                    <span>Max 1000 pages</span>
                  </div>
                </div>
              ) : (
                <div className="pu-file-preview">
                  <span className="pu-file-preview-icon"><FileText size={22} /></span>
                  <div className="pu-file-preview-info">
                    <span className="pu-file-preview-name">{file.name}</span>
                    <span className="pu-file-preview-size">{fmtSize(file.size)}</span>
                    {uploading && (
                      <div className="pu-upload-progress">
                        <div
                          className="pu-upload-progress-bar"
                          style={{ width: `${progress.toFixed(0)}%` }}
                        />
                        <span className="pu-upload-progress-pct">{progress.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                  {!uploading && (
                    <button
                      type="button"
                      className="pu-file-remove"
                      onClick={clearFile}
                      aria-label="Remove file"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Layout type ── */}
            <div className="pu-field">
              <label className="pu-field-label">Layout Type</label>
              <div className="pu-layout-grid">
                <LayoutCard
                  value="REFLOWABLE"
                  selected={layoutType === 'REFLOWABLE'}
                  onSelect={setLayoutType}
                  title="Reflowable"
                  tag="EPUB 3"
                  tagColor="blue"
                  icon={<FileText size={20} />}
                  desc="Text reflows to fit any screen. Best for novels, reports, and long-form text."
                  recommended
                />
                <LayoutCard
                  value="FIXED_LAYOUT"
                  selected={layoutType === 'FIXED_LAYOUT'}
                  onSelect={setLayoutType}
                  title="Fixed Layout"
                  tag="FXL"
                  tagColor="purple"
                  icon={<Image size={20} />}
                  desc="Preserves exact page design. Best for cookbooks, atlases, and visual books."
                />
              </div>
            </div>

            {/* ── Error ── */}
            {error && (
              <div className="pu-error" role="alert">
                <X size={15} className="pu-error-icon" />
                {error}
              </div>
            )}

            {/* ── Footer actions ── */}
            <div className="pu-form-footer">
              <span className="pu-privacy-note">
                <Info size={14} /> Files are processed in your private workspace.
              </span>
              <div className="pu-form-actions">
                <button
                  type="button"
                  className="pu-btn pu-btn--ghost"
                  onClick={clearFile}
                  disabled={uploading}
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="pu-btn pu-btn--primary"
                  disabled={uploading || !file}
                >
                  {uploading ? (
                    <>
                      <span className="pu-spinner" aria-hidden="true" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Upload PDF
                    </>
                  )}
                </button>
              </div>
            </div>

          </form>
        </div>

        {/* ── Right: sidebar ── */}
        <aside className="pu-sidebar">

          {/* What happens next */}
          <div className="pu-sidebar-card">
            <h3 className="pu-sidebar-title">What happens next</h3>
            <ol className="pu-next-list">
              {NEXT_STEPS.map((s, i) => (
                <li key={i} className="pu-next-item">
                  <span className="pu-next-num">{i + 1}</span>
                  <div className="pu-next-body">
                    <span className="pu-next-label">{s.label}</span>
                    <span className="pu-next-sub">{s.sub}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Tips */}
          <div className="pu-sidebar-card pu-sidebar-card--tips">
            <h3 className="pu-sidebar-title pu-sidebar-title--tips">
              <Info size={15} className="pu-tips-icon" />
              Tips for best results
            </h3>
            <ul className="pu-tips-list">
              {TIPS.map((t, i) => (
                <li key={i} className="pu-tips-item">
                  <CheckCircle size={14} className="pu-tips-check" />
                  {t}
                </li>
              ))}
            </ul>
          </div>

        </aside>

      </div>{/* pu-body */}

      <div className="pu-pdfs-section">
        <UploadedPdfsList
          highlightId={highlightPdf.id}
          highlightName={highlightPdf.name}
        />
      </div>

      </div>{/* pu-content */}

      {/* ── Upload loading modal ── */}
      <UploadLoadingModal
        isOpen={uploadModalOpen}
        progress={progress}
        fileName={file?.name || lastDoc?.originalFileName || ''}
        status={uploadModalStatus}
        error={uploadError || ''}
        onClose={dismissUploadModal}
        onDismiss={dismissUploadModal}
      />

    </div>
  );
};

export default PdfUpload;
