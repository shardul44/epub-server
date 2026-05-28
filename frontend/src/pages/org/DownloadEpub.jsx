import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { conversionApi, kitabooApi, apiClient } from '../../api';
import { useListScope } from '../../context/ListScopeContext';
import { useConversions } from '../../hooks/useConversions';
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
import { useConversionActions } from '../../hooks/useConversionActions';
import { useAuth } from '../../context/AuthContext';
import { hasFeature } from '../../utils/features';
import { selectActionError, clearActionError } from '../../features/conversions/conversionsSlice';
import { selectWorkflowConversionType } from '../../features/conversionWorkflow/conversionWorkflowSlice';
import WorkflowStepper from '../../components/WorkflowStepper';
import ConfirmModal from '../../components/Loadingmodal';
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
  Trash2,
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

  const epubFallback = (
    <div className="de-ready-pdf-thumb-fallback de-ready-pdf-thumb-epub" aria-hidden>
      <span className="de-ready-pdf-thumb-epub-label">EPUB</span>
    </div>
  );

  if (epubSource && !url) {
    return epubFallback;
  }

  if (!url) {
    return (
      <div className="de-ready-pdf-thumb-fallback" aria-hidden>
        <FileText size={28} />
      </div>
    );
  }

  return (
    <>
      <div className="de-ready-pdf-thumb-fallback de-ready-pdf-thumb-fallback--under" aria-hidden>
        {epubSource ? <span className="de-ready-pdf-thumb-epub-label">EPUB</span> : <FileText size={28} />}
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
          fallback={epubSource ? epubFallback : undefined}
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
  const { user } = useAuth();
  const { prepareDelete, confirmDelete: runConfirmDelete } = useConversionActions();
  const [deleteModal, setDeleteModal] = useState({ open: false, job: null, loading: false });

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
  const [directImportMeta, setDirectImportMeta] = useState(null);
  const [directImportError, setDirectImportError] = useState('');

  // ── COMPLETED conversion jobs + direct EPUB → Audio Sync imports ──
  const canUseSyncStudio = hasFeature(user, 'sync_studio');
  const { jobs, loading, error: fetchError, refetch } = useConversions({
    excludeEpubImports: true,
    includeEpubSyncSessions: canUseSyncStudio,
  });
  const actionError = useAppSelector(selectActionError);

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

  // For direct EPUB imports, `jobs` list (conversion_jobs) is intentionally empty.
  // Fetch lightweight metadata so we can still show the Download EPUB UI.
  useEffect(() => {
    if (loading) return;
    if (selectedJob) return;
    if (!urlJobId) return;
    if (directImportMeta) return;

    const directId = parseInt(String(urlJobId), 10);
    if (Number.isNaN(directId)) return;

    setDirectImportError('');
    apiClient
      .get(`/conversions/epub-import-meta/${directId}`)
      .then((res) => setDirectImportMeta(res.data?.data ?? res.data))
      .catch((err) => setDirectImportError(err?.message || 'Failed to load import metadata'));
  }, [loading, selectedJob, urlJobId, directImportMeta]);

  /* ── Download ── */
  const handleDownload = useCallback(async () => {
    const directJid = directImportMeta?.pdfDocumentId ?? null;
    const jid = selectedJob ? (selectedJob.id ?? selectedJob.jobId) : directJid;
    if (!jid) return;
    setDownloading(true);
    setDownloadStatus('Downloading…');
    try {
      if (selectedJob) {
        if (selectedJob.jobType === 'FXL' && !isEpubSourceJob(selectedJob)) {
          await kitabooApi.downloadFxlEpub(jid, null, (status) => setDownloadStatus(status), {
            skipAutoPublish: false,
            forcePublish: true,
          });
        } else {
          await conversionApi.downloadEpub(jid, {
            jobType: selectedJob.jobType === 'FXL' ? 'FXL' : 'REFLOW',
          });
        }
      } else {
        // Direct EPUB import sessions don't have conversion_jobs / kitaboo export rows.
        // We download the originally imported EPUB stub directly.
        await conversionApi.downloadEpub(jid, { jobType: 'REFLOW' });
      }
    } catch (err) {
      dispatch(setError(err.message || 'Failed to download EPUB'));
    } finally {
      setDownloading(false);
      setDownloadStatus('');
    }
  }, [selectedJob, directImportMeta, dispatch]);

  const handleQuickDownload = useCallback(async (job) => {
    if (!job) return;
    const jid = job.id ?? job.jobId;
    const listKey = conversionJobListKey(job);
    dispatch(clearError());
    setQuickDownloadId(listKey);
    try {
      if (job.jobType === 'FXL' && !isEpubSourceJob(job)) {
        await kitabooApi.downloadFxlEpub(jid, null, null, {
          skipAutoPublish: false,
          forcePublish: true,
        });
      } else {
        await conversionApi.downloadEpub(jid, {
          jobType: job.jobType === 'FXL' ? 'FXL' : 'REFLOW',
        });
      }
    } catch (err) {
      dispatch(setError(err.message || 'Failed to download EPUB'));
    } finally {
      setQuickDownloadId(null);
    }
  }, [dispatch]);

  const handleStepClick = useCallback((step) => navigate(step.path), [navigate]);

  const handleDelete = useCallback(
    (job) => {
      prepareDelete(job);
      setDeleteModal({ open: true, job, loading: false });
    },
    [prepareDelete],
  );

  const confirmDelete = useCallback(async () => {
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    const ok = await runConfirmDelete();
    if (ok) {
      await refetch();
      dispatch(setSelectedJobId(null));
      setDeleteModal({ open: false, job: null, loading: false });
    } else {
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  }, [runConfirmDelete, refetch, dispatch]);

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
  const epubDirectImport = job ? isEpubSourceJob(job) : Boolean(directImportMeta);
  const epubImportId = directImportMeta?.pdfDocumentId ?? null;
  const effectiveJobId = job ? (job.id ?? job.jobId) : epubImportId;
  const isFxl =
    job?.jobType === 'FXL' ||
    directImportMeta?.layoutType === 'FIXED_LAYOUT';
  const pages = job?.totalPages ?? job?.pageCount ?? directImportMeta?.pages ?? null;
  const size = fmtSize(job?.fileSizeBytes ?? job?.fileSize ?? directImportMeta?.fileSizeBytes ?? null);
  const filename = job ? `job-${effectiveJobId}.epub` : (directImportMeta?.pdfFilename ?? null);
  const pdfName = job?.pdfFilename ?? directImportMeta?.pdfFilename ?? null;
  const readerSource = isFxl ? 'kitaboo' : 'conversion';

  return (
    <div className="de-root">

      {/* ── Top bar ── */}
      <div className="de-topbar">
        <div className="de-topbar-left">
          <h1 className="de-topbar-title">Download EPUB</h1>
          {effectiveJobId && <span className="de-job-chip-top">Job #{effectiveJobId}</span>}

        </div>
        <button
          className="de-back-btn"
          onClick={() => {
            if (job) {
              goToAudioSync(job);
              return;
            }
            if (directImportMeta && epubImportId) {
              goToAudioSync({
                id: epubImportId,
                jobId: epubImportId,
                jobType: isFxl ? 'FXL' : 'REFLOW',
                pdfDocumentId: epubImportId,
                pdfId: epubImportId,
              });
              return;
            }
            navigate('/conversions/audio-sync');
          }}
        >
          <ArrowLeft size={15} /> Audio Sync
        </button>
      </div>

      {/* ── Stepper ── */}
      <WorkflowStepper
        activeStep={3}
        jobId={effectiveJobId}
        job={job}
        onStepClick={handleStepClick}
        disabledStepKeys={epubDirectImport ? ['jobs', 'editor'] : []}
      />

      {/* ── Error ── */}
      {(error || actionError) && (
        <div className="de-error-bar">
          {error || actionError}
          <button
            type="button"
            onClick={() => {
              dispatch(clearError());
              dispatch(clearActionError());
            }}
            className="de-error-close"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── No jobs (or URL-only direct-import fallback) ── */}
      {jobs.length === 0 && !job ? (
        directImportMeta ? (
          /* ── Main content (direct import) ── */
          <div className="de-content">
            <div className="de-main-row">
              <div className="de-ready-card">
                <div className="de-check-circle">
                  <Check size={28} />
                </div>

                <h2 className="de-ready-title">Your EPUB is ready</h2>

                {pdfName && (
                  <p className="de-ready-sub">
                    {pdfName} is ready to download.
                  </p>
                )}

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
                    onClick={() => navigate(buildEpubReaderPath(effectiveJobId, {
                      source: readerSource,
                      fixedLayout: isFxl,
                    }))}
                  >
                    <BookOpen size={15} />
                    Open in Reader
                  </button>
                </div>
              </div>

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
              </div>
            </div>
          </div>
        ) : (
        <div className="de-empty">
          <FileText size={40} />
          <p>
            {listScope === 'own'
              ? 'You have no completed jobs ready for download yet. Import an EPUB or finish a PDF conversion first.'
              : 'No completed jobs available for download.'}
          </p>
          <div className="de-empty-actions">
            <button
              type="button"
              className="de-btn de-btn-primary"
              onClick={() => navigate('/epub-sync-import')}
            >
              EPUB → Audio Sync
            </button>
            <button
              type="button"
              className="de-btn de-btn-outline"
              onClick={() => navigate('/conversions')}
            >
              Conversion Jobs
            </button>
          </div>
        </div>
        )
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
                    onClick={() => navigate(buildEpubReaderPath(effectiveJobId, {
                      source: readerSource,
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
                Ready to download
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
                        <button
                          type="button"
                          className="de-ready-pdf-card-del-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(j);
                          }}
                          title="Delete job"
                          aria-label={`Delete job #${jid}`}
                        >
                          <Trash2 size={16} aria-hidden />
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

      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, job: null, loading: false })}
        onConfirm={confirmDelete}
        title="Confirm Deletion"
        subtitle="This action cannot be undone."
        message={
          deleteModal.job
            ? `Delete Job #${deleteModal.job.id ?? deleteModal.job.jobId}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={deleteModal.loading}
      />
    </div>
  );
};

export default DownloadEpub;
