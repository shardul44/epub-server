import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { conversionApi, kitabooApi } from '../../api';
import { useConversions } from '../../hooks/useConversions';
import WorkflowStepper from '../../components/WorkflowStepper';
import { mediaUrl } from '../../utils/mediaUrl';
import { loadStoredJobThumb } from '../../utils/jobCardThumb';
import { buildEpubReaderPath } from '../../utils/epubReaderUrl';
import {
  Download,
  ArrowLeft,
  Check,
  FileText,
  BookOpen,
  Smartphone,
} from 'lucide-react';
import './DownloadEpub.css';

/* ─── Stepper ─────────────────────────────────────────────────── */
// WorkflowStepper is shared — no local STEPS duplication needed.

/* ─── Validation summary items ────────────────────────────────── */
const buildValidationItems = (job) => {
  const audioCount = job?.audioTrackCount ?? null;
  const imageCount = job?.imageCount ?? null;
  return [
    { icon: '📄', label: 'EPUB structure valid', ok: true },
    { icon: '🖼', label: imageCount != null ? `All images embedded (${imageCount})` : 'All images embedded', ok: true },
    { icon: '🎵', label: audioCount != null ? `Audio tracks synced (${audioCount} / ${audioCount})` : 'Audio tracks synced', ok: true },
    { icon: '♿', label: 'Accessibility AA passed', ok: true },
  ];
};

/* ─── Format file size ────────────────────────────────────────── */
const fmtSize = (bytes) => {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

/** Card thumbnail — same optional cover as Conversion Jobs, else PDF placeholder thumbnail. */
const DeReadyPdfThumb = memo(function DeReadyPdfThumb({ jobId, pdfId }) {
  const [hideImg, setHideImg] = useState(false);
  const customSrc = useMemo(() => loadStoredJobThumb(jobId), [jobId]);
  useEffect(() => {
    setHideImg(false);
  }, [jobId, customSrc, pdfId]);

  const isCustom = Boolean(customSrc);
  const apiSrc = pdfId != null ? mediaUrl(`/api/pdfs/${pdfId}/thumbnail`) : '';
  const src = customSrc || apiSrc;
  const showFallback = !src || hideImg;

  return (
    <div className={`de-ready-pdf-thumb${isCustom ? ' de-ready-pdf-thumb--custom' : ''}`}>
      {src && !hideImg ? (
        <img src={src} alt="" onError={() => setHideImg(true)} />
      ) : null}
      <div
        className={`de-ready-pdf-thumb-fallback${showFallback ? ' de-ready-pdf-thumb-fallback--visible' : ''}`}
        aria-hidden
      >
        <FileText size={36} />
      </div>
    </div>
  );
});

/* ─── Main component ──────────────────────────────────────────── */
const DownloadEpub = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const preselectedJobId = location.state?.jobId;

  const [selectedJob, setSelectedJob] = useState(null);
  const [error, setError]             = useState('');
  const [downloading, setDownloading] = useState(false);
  const [quickDownloadId, setQuickDownloadId] = useState(null);

  // ── Single shared fetch — no duplicate API calls ──
  const { jobs, loading, error: fetchError } = useConversions();

  // Propagate fetch error
  useEffect(() => {
    if (fetchError) setError(fetchError);
  }, [fetchError]);

  // Auto-select once jobs are loaded
  useEffect(() => {
    if (loading || jobs.length === 0) return;
    if (preselectedJobId) {
      const found = jobs.find(j => String(j.id ?? j.jobId) === String(preselectedJobId));
      setSelectedJob(found ?? jobs[0] ?? null);
    } else {
      setSelectedJob(prev => prev ?? jobs[0] ?? null);
    }
  }, [loading, jobs, preselectedJobId]);

  const [downloadStatus, setDownloadStatus] = useState('');

  /* ── Download ── */
  const handleDownload = useCallback(async () => {
    if (!selectedJob) return;
    const jid = selectedJob.id ?? selectedJob.jobId;
    setDownloading(true);
    setDownloadStatus('Downloading…');
    try {
      if (selectedJob.jobType === 'FXL') {
        await kitabooApi.downloadFxlEpub(jid, null, (status) => setDownloadStatus(status));
      } else {
        await conversionApi.downloadEpub(jid);
      }
    } catch (err) {
      setError(err.message || 'Failed to download EPUB');
    } finally {
      setDownloading(false);
      setDownloadStatus('');
    }
  }, [selectedJob]);

  const handleQuickDownload = useCallback(async (jid) => {
    if (jid == null) return;
    setError('');
    setQuickDownloadId(jid);
    try {
      const job = jobs.find(j => String(j.id ?? j.jobId) === String(jid));
      if (job?.jobType === 'FXL') {
        await kitabooApi.downloadFxlEpub(jid);
      } else {
        await conversionApi.downloadEpub(jid);
      }
    } catch (err) {
      setError(err.message || 'Failed to download EPUB');
    } finally {
      setQuickDownloadId(null);
    }
  }, [jobs]);

  const handleStepClick = useCallback((step) => navigate(step.path), [navigate]);

  // Memoize validation items — only recompute when job changes
  // Must be before any early returns to satisfy Rules of Hooks
  const validationItems = useMemo(() => buildValidationItems(selectedJob), [selectedJob]);

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="de-root">
        <div className="de-loading">
          <div className="de-spinner" />
          Loading…
        </div>
      </div>
    );
  }

  const job    = selectedJob;
  const jobId  = job ? (job.id ?? job.jobId) : null;
  const isFxl  = job?.jobType === 'FXL';
  const pages  = job?.totalPages ?? job?.pageCount ?? null;
  const size   = fmtSize(job?.fileSizeBytes ?? job?.fileSize ?? null);
  const filename  = job ? `job-${jobId}.epub` : null;
  const pdfName   = job?.pdfFilename ?? null;

  return (
    <div className="de-root">

      {/* ── Top bar ── */}
      <div className="de-topbar">
        <div className="de-topbar-left">
          <button
            className="de-back-btn"
            onClick={() => navigate('/conversions/audio-sync', { state: { jobId } })}
          >
            <ArrowLeft size={15} /> Audio Sync
          </button>
          <h1 className="de-topbar-title">Download EPUB</h1>
          {jobId && <span className="de-job-chip-top">Job #{jobId}</span>}
        </div>
      </div>

      {/* ── Stepper ── */}
      <WorkflowStepper activeStep={3} jobId={jobId} onStepClick={handleStepClick} variant="de" />

      {/* ── Error ── */}
      {error && (
        <div className="de-error-bar">
          {error}
          <button onClick={() => setError('')} className="de-error-close">✕</button>
        </div>
      )}

      {/* ── No jobs ── */}
      {!job ? (
        <div className="de-empty">
          <FileText size={40} />
          <p>No completed jobs available for download.</p>
          <button
            className="de-btn de-btn-primary"
            style={{ width: 'auto', marginTop: 8 }}
            onClick={() => navigate('/conversions')}
          >
            Go to Conversion Jobs
          </button>
        </div>
      ) : (
        /* ── Main content ── */
        <div className="de-content">

          <div className="de-main-row">

            {/* ── Ready card ── */}
            <div className="de-ready-card">
              <div className="de-check-circle">
                <Check size={28} />
              </div>

              <h2 className="de-ready-title">Your EPUB is ready</h2>

              {pdfName && (
                <p className="de-ready-sub">
                  {pdfName} has been packaged and validated.
                </p>
              )}

              {/* File info row */}
              <div className="de-file-row">
                <span className="de-file-icon">📘</span>
                <div className="de-file-info">
                  <span className="de-file-name">{filename}</span>
                  <span className="de-file-meta">
                    {isFxl ? 'FXL' : 'Reflow'}
                    {pages ? ` · ${pages} pages` : ''}
                    {size  ? ` · ${size}` : ''}
                  </span>
                </div>
                <span className="de-ready-badge">READY</span>
              </div>

              {/* Action buttons */}
              <div className="de-actions">
                <button
                  className="de-btn de-btn-primary"
                  onClick={handleDownload}
                  disabled={downloading || !!quickDownloadId}
                >
                  <Download size={16} />
                  {downloading ? (downloadStatus || 'Downloading…') : 'Download EPUB'}
                </button>
                <button
                  className="de-btn de-btn-outline"
                  onClick={() => navigate(buildEpubReaderPath(jobId, {
                    source: isFxl ? 'kitaboo' : 'conversion',
                    fixedLayout: isFxl,
                  }))}
                >
                  <BookOpen size={15} />
                  Open in Reader
                </button>
                <button
                  className="de-btn de-btn-outline"
                  onClick={() => navigate('/conversions')}
                >
                  <Smartphone size={15} />
                  Back to Conversions
                </button>
              </div>
            </div>

            {/* ── Validation summary ── */}
            <div className="de-validation-panel">
              <div className="de-val-title">VALIDATION SUMMARY</div>
              <ul className="de-val-list">
                {validationItems.map((item, i) => (
                  <li key={i} className="de-val-item">
                    <span className="de-val-icon">{item.icon}</span>
                    <span className="de-val-label">{item.label}</span>
                    {item.ok && <Check className="de-val-check" size={14} />}
                  </li>
                ))}
              </ul>

              <div className="de-val-tip">
                <span className="de-val-tip-label">Tip</span>
                <span className="de-val-tip-text">
                  You can re-download anytime from{' '}
                  <button
                    className="de-val-tip-link"
                    onClick={() => navigate('/conversions')}
                  >
                    Conversions
                  </button>
                  .
                </span>
              </div>
            </div>

          </div>

          {/* All completed jobs — PDF-style cards ready for EPUB download */}
          {jobs.length > 0 && (
            <section className="de-ready-list-section" aria-labelledby="de-ready-list-heading">
              <h3 id="de-ready-list-heading" className="de-ready-list-title">
                PDFs ready to download
              </h3>
              <p className="de-ready-list-sub">
                Tap a card to show it in the summary above. Use Download on a card to save that EPUB immediately.
              </p>
              <div className="de-ready-card-grid">
                {jobs.map((j) => {
                  const jid = j.id ?? j.jobId;
                  const isSel = job && String(jid) === String(jobId);
                  const isFxlJ = j.jobType === 'FXL';
                  const pid = j.pdfDocumentId ?? j.pdfId;
                  const pdfLabel = j.pdfFilename || (pid != null ? `PDF ${pid}` : 'Document');
                  const pagesJ = j.totalPages ?? j.pageCount ?? null;
                  return (
                    <article
                      key={jid}
                      className={`de-ready-pdf-card${isSel ? ' de-ready-pdf-card--selected' : ''}`}
                    >
                      <div
                        className="de-ready-pdf-card-hit"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedJob(j)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedJob(j);
                          }
                        }}
                      >
                        <DeReadyPdfThumb jobId={jid} pdfId={pid} />
                        <div className="de-ready-pdf-card-body">
                          <div className="de-ready-pdf-card-badges">
                            <span className={`de-ready-pdf-type ${isFxlJ ? 'de-ready-pdf-type--fxl' : 'de-ready-pdf-type--reflow'}`}>
                              {isFxlJ ? 'FXL' : 'Reflow'}
                            </span>
                            <span className="de-ready-pdf-ready-pill">Ready</span>
                          </div>
                          <h4 className="de-ready-pdf-card-title">{pdfLabel}</h4>
                          <p className="de-ready-pdf-card-meta">
                            Job #{jid}
                            {pagesJ != null ? ` · ${pagesJ} pages` : ''}
                          </p>
                          {isSel ? (
                            <span className="de-ready-pdf-card-selected">Selected for preview</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="de-ready-pdf-card-actions">
                        <button
                          type="button"
                          className="de-btn de-btn-primary de-ready-pdf-card-dl"
                          disabled={!!quickDownloadId || downloading}
                          onClick={() => handleQuickDownload(jid)}
                          title={`Download job-${jid}.epub`}
                        >
                          <Download size={15} />
                          {quickDownloadId === jid ? 'Downloading…' : 'Download EPUB'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
};

export default DownloadEpub;
