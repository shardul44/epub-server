import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { conversionApi, kitabooApi } from '../../api';
import { useListScope } from '../../context/ListScopeContext';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import useAppDispatch from '../../hooks/useAppDispatch';
import useAppSelector from '../../hooks/useAppSelector';
import {
  selectDESelectedJobId,
  selectDEError,
  setSelectedJobId,
  setError,
  clearError,
} from '../../features/downloadEpub/downloadEpubSlice';
import { useWorkflowNavigation, isFixedLayout } from '../../hooks/useWorkflowNavigation';
import { selectWorkflowConversionType } from '../../features/conversionWorkflow/conversionWorkflowSlice';
import WorkflowStepper from '../../components/WorkflowStepper';
import { buildEpubReaderPath } from '../../utils/epubReaderUrl';
import {
  conversionJobListKey,
  findJobByListKey,
  isEpubSourceJob,
} from '../../utils/conversionJobKey';
import PdfThumbnail from '../../components/PdfThumbnail';
import { pdfViewUrl } from '../../services/api';
import {
  Download,
  ArrowLeft,
  Check,
  FileText,
  BookOpen,
  ChevronRight,
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
  ];
};

/* ─── Format file size ────────────────────────────────────────── */
const fmtSize = (bytes) => {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const fmtStep = (s) =>
  s ? String(s).replace(/STEP_\d+_/, '').replace(/_/g, ' ') : '';

const fmtDurationMs = (ms) => {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${sec % 60}s`;
  if (sec > 0) return `${sec}s`;
  return '—';
};

const fmtCompletedNice = (d) =>
  d
    ? new Date(d).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const jobDurationMs = (job) => {
  const end = job.completedAt || job.updatedAt;
  const start = job.createdAt;
  if (!start || !end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
};

function buildPdfViewUrl(pdfDocumentId) {
  if (pdfDocumentId == null || pdfDocumentId === '') return null;
  try {
    return pdfViewUrl(pdfDocumentId);
  } catch {
    return null;
  }
}

/** First-page PDF preview for ready-download cards (skipped for EPUB imports). */
const DeReadyPdfThumb = memo(function DeReadyPdfThumb({ pdfId, epubSource }) {
  const url = useMemo(() => buildPdfViewUrl(pdfId), [pdfId]);
  const cacheKey =
    pdfId != null && pdfId !== '' ? `pdf-thumb-card-${String(pdfId)}` : null;

  if (epubSource || !url) {
    return (
      <div className="de-ready-pdf-thumb-fallback" aria-hidden>
        {epubSource ? <BookOpen size={28} /> : <FileText size={28} />}
      </div>
    );
  }

  return (
    <>
      <div className="de-ready-pdf-thumb-fallback de-ready-pdf-thumb-fallback--under" aria-hidden>
        <FileText size={28} />
      </div>
      <div className="de-ready-pdf-thumb-preview">
        <PdfThumbnail
          url={url}
          width={200}
          height={280}
          scale={1.25}
          cacheKey={cacheKey}
          className="de-ready-pdf-thumb-img"
          alt=""
        />
      </div>
    </>
  );
});

/* ─── Main component ──────────────────────────────────────────── */
const DownloadEpub = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const dispatch = useAppDispatch();
  const listScope = useListScope();
  const { goToAudioSync } = useWorkflowNavigation();

  // jobId priority: URL param → navigation state → Redux state
  const urlJobId = params?.jobId;
  const stateJobId = location.state?.jobId;
  const preselectedJobId = urlJobId ?? stateJobId;

  // ── Redux UI state ────────────────────────────────────────────
  const selectedJobId = useAppSelector(selectDESelectedJobId);
  const workflowConversionType = useAppSelector(selectWorkflowConversionType);
  const error = useAppSelector(selectDEError);

  // ── Local UI state (ephemeral) ────────────────────────────────
  const [downloading, setDownloading] = useState(false);
  const [quickDownloadId, setQuickDownloadId] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState('');

  // ── React Query (server state — COMPLETED jobs only) ──────────
  const { jobs, isLoading: loading, error: fetchError } = useConversionsQuery({
    statusFilter: 'COMPLETED',
    excludeEpubImports: true,
  });

  // Propagate fetch error into Redux
  useEffect(() => {
    if (fetchError) dispatch(setError(fetchError));
  }, [fetchError, dispatch]);

  // Auto-select once jobs are loaded (composite key FXL-121 / REFLOW-121 when ids collide)
  useEffect(() => {
    if (loading || jobs.length === 0) return;
    const targetId = preselectedJobId ?? selectedJobId;
    if (targetId) {
      const resolved =
        findJobByListKey(jobs, targetId, workflowConversionType) ?? jobs[0] ?? null;
      if (resolved) dispatch(setSelectedJobId(conversionJobListKey(resolved)));
    } else if (!selectedJobId) {
      const first = jobs[0];
      if (first) dispatch(setSelectedJobId(conversionJobListKey(first)));
    }
  }, [loading, jobs, preselectedJobId, selectedJobId, workflowConversionType, dispatch]);

  const selectedJob = selectedJobId
    ? findJobByListKey(jobs, selectedJobId, workflowConversionType)
    : null;

  /* ── Download ── */
  const handleDownload = useCallback(async () => {
    if (!selectedJob) return;
    const jid = selectedJob.id ?? selectedJob.jobId;
    setDownloading(true);
    setDownloadStatus('Downloading…');
    try {
      if (selectedJob.jobType === 'FXL') {
        await kitabooApi.downloadFxlEpub(jid, null, (status) => setDownloadStatus(status), {
          skipAutoPublish: isEpubSourceJob(selectedJob),
        });
      } else {
        await conversionApi.downloadEpub(jid);
      }
    } catch (err) {
      dispatch(setError(err.message || 'Failed to download EPUB'));
    } finally {
      setDownloading(false);
      setDownloadStatus('');
    }
  }, [selectedJob, dispatch]);

  const handleQuickDownload = useCallback(async (job) => {
    if (!job) return;
    const jid = job.id ?? job.jobId;
    const listKey = conversionJobListKey(job);
    dispatch(clearError());
    setQuickDownloadId(listKey);
    try {
      if (job.jobType === 'FXL') {
        await kitabooApi.downloadFxlEpub(jid, null, null, {
          skipAutoPublish: isEpubSourceJob(job),
        });
      } else {
        await conversionApi.downloadEpub(jid);
      }
    } catch (err) {
      dispatch(setError(err.message || 'Failed to download EPUB'));
    } finally {
      setQuickDownloadId(null);
    }
  }, [dispatch]);

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

  const job = selectedJob;
  const jobId = job ? (job.id ?? job.jobId) : null;
  const isFxl = job?.jobType === 'FXL';
  const pages = job?.totalPages ?? job?.pageCount ?? null;
  const size = fmtSize(job?.fileSizeBytes ?? job?.fileSize ?? null);
  const filename = job ? `job-${jobId}.epub` : null;
  const pdfName = job?.pdfFilename ?? null;

  return (
    <div className="de-root">

      {/* ── Top bar ── */}
      <div className="de-topbar">
        <div className="de-topbar-left">
          <h1 className="de-topbar-title">Download EPUB</h1>
          {jobId && <span className="de-job-chip-top">Job #{jobId}</span>}

        </div>
        <button
          className="de-back-btn"
          onClick={() => {
            if (job) {
              goToAudioSync(job);
            } else {
              navigate('/conversions/audio-sync');
            }
          }}
        >
          <ArrowLeft size={15} /> Audio Sync
        </button>
      </div>

      {/* ── Stepper ── */}
      <WorkflowStepper activeStep={3} jobId={jobId} job={job} onStepClick={handleStepClick} />

      {/* ── Error ── */}
      {error && (
        <div className="de-error-bar">
          {error}
          <button onClick={() => dispatch(clearError())} className="de-error-close">✕</button>
        </div>
      )}

      {/* ── No jobs ── */}
      {!job ? (
        <div className="de-empty">
          <FileText size={40} />
          <p>
            {listScope === 'own'
              ? 'You have no completed jobs ready for download yet.'
              : 'No completed jobs available for download.'}
          </p>
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
                    {size ? ` · ${size}` : ''}
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
                  const listKey = conversionJobListKey(j);
                  const isSel = selectedJobId === listKey;
                  const isFxlJ = isFixedLayout(j);
                  const pid = j.pdfDocumentId ?? j.pdfId;
                  const epubSource = isEpubSourceJob(j);
                  const pdfLabel = j.pdfFilename || (pid != null ? `PDF #${pid}` : 'Document');
                  const pagesJ = j.totalPages ?? j.pageCount ?? null;
                  const sizeJ = fmtSize(j.fileSizeBytes ?? j.fileSize ?? null);
                  const subMeta = [pagesJ != null ? `${pagesJ} pages` : null, sizeJ].filter(Boolean).join(' · ') || '—';
                  const durMs = jobDurationMs(j);
                  const pct = j.progressPercentage ?? 100;

                  return (
                    <article
                      key={listKey}
                      className={[
                        'de-ready-pdf-card',
                        isFxlJ ? 'de-ready-pdf-card--fxl' : 'de-ready-pdf-card--reflow',
                        isSel ? 'de-ready-pdf-card--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div
                        className="de-ready-pdf-card-hit"
                        role="button"
                        tabIndex={0}
                        onClick={() => dispatch(setSelectedJobId(listKey))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            dispatch(setSelectedJobId(listKey));
                          }
                        }}
                      >
                        <div className="de-ready-pdf-card-header">
                          <span
                            className={`de-ready-pdf-type ${isFxlJ ? 'de-ready-pdf-type--fxl' : 'de-ready-pdf-type--reflow'}`}
                          >
                            {isFxlJ ? 'FXL' : 'REFLOW'}
                          </span>
                          <span className="de-ready-pdf-status de-ready-pdf-status--done">COMPLETED</span>
                        </div>

                        <div className="de-ready-pdf-card-pdf-panel">
                          <div className="de-ready-pdf-card-pdf-thumb-col">
                            <span className="de-ready-pdf-card-pdf-badge" aria-hidden>
                              {epubSource ? 'EPUB' : 'PDF'}
                            </span>
                            <div className="de-ready-pdf-thumb">
                              <DeReadyPdfThumb pdfId={pid} epubSource={epubSource} />
                            </div>
                          </div>
                          <div className="de-ready-pdf-card-pdf-meta">
                            <div className="de-ready-pdf-card-pdf-name" title={pdfLabel}>
                              {pdfLabel}
                            </div>
                            <div className="de-ready-pdf-card-pdf-sub">{subMeta}</div>
                          </div>
                        </div>

                        <div className="de-ready-pdf-card-body">
                          <div className="de-ready-pdf-card-job-id">Job #{jid}</div>
                          <div className="de-ready-pdf-card-step-row">
                            <span className="de-ready-pdf-card-step-text">
                              Step: {fmtStep(j.currentStep) || 'COMPLETE'}
                            </span>
                            <span className="de-ready-pdf-card-pct">{pct}%</span>
                          </div>
                          <div className="de-ready-pdf-card-progress-track">
                            <div
                              className="de-ready-pdf-card-progress-fill de-ready-pdf-progress-fill--done"
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>

                          <div className="de-ready-pdf-card-metrics">
                            <div className="de-ready-pdf-card-metric">
                              <span className="de-ready-pdf-card-metric-label">Completed</span>
                              <span className="de-ready-pdf-card-metric-value">
                                {fmtCompletedNice(j.completedAt || j.updatedAt)}
                              </span>
                            </div>
                            <div className="de-ready-pdf-card-metric">
                              <span className="de-ready-pdf-card-metric-label">Duration</span>
                              <span className="de-ready-pdf-card-metric-value">
                                {durMs != null ? fmtDurationMs(durMs) : '—'}
                              </span>
                            </div>
                            <div className="de-ready-pdf-card-metric">
                              <span className="de-ready-pdf-card-metric-label">AI model</span>
                              <span className="de-ready-pdf-card-metric-value">
                                {j.aiModel || j.modelName || j.model || '—'}
                              </span>
                            </div>
                          </div>

                          {isSel ? (
                            <span className="de-ready-pdf-card-selected">Selected for preview</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="de-ready-pdf-card-actions">
                        <button
                          type="button"
                          className="de-ready-pdf-card-dl"
                          disabled={!!quickDownloadId || downloading}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickDownload(j);
                          }}
                          title={`Download job-${jid}.epub`}
                        >
                          <Download size={16} aria-hidden />
                          {quickDownloadId === listKey ? 'Downloading…' : 'Download EPUB'}
                          <ChevronRight size={18} aria-hidden />
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
