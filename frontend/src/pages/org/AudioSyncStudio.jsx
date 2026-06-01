import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useListScope } from '../../context/ListScopeContext';
import { useConversions } from '../../hooks/useConversions';
import { useWorkflowNavigation, isFixedLayout, audioSyncPath } from '../../hooks/useWorkflowNavigation';
import { isEpubSourceJob } from '../../utils/conversionJobKey';
import { useConversionActions } from '../../hooks/useConversionActions';
import useAppSelector from '../../hooks/useAppSelector';
import { selectActionError, clearActionError } from '../../features/conversions/conversionsSlice';
import useAppDispatch from '../../hooks/useAppDispatch';
import WorkflowStepper from '../../components/WorkflowStepper';
import PdfThumbnail from '../../components/PdfThumbnail';
import JobCard, { JobGrid } from '../../components/JobCard';
import ConfirmModal from '../../components/Loadingmodal';
import { pdfViewUrl } from '../../services/api';
import { ArrowLeft, FileText, X, Mic2, ChevronRight, Trash2 } from 'lucide-react';
import './AudioSyncStudio.css';

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

const fmtTimeShort = (d) =>
  d
    ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '—';

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

const estimateEta = (job) => {
  const pct = job.progressPercentage ?? 0;
  if (pct <= 0 || pct >= 100) return '—';
  const start = new Date(job.createdAt || job.updatedAt).getTime();
  if (!Number.isFinite(start)) return '—';
  const elapsed = Date.now() - start;
  if (elapsed < 4000) return '—';
  const remaining = (elapsed / pct) * (100 - pct);
  return fmtDurationMs(remaining);
};

const jobDurationMs = (job) => {
  const end = job.completedAt || job.updatedAt;
  const start = job.createdAt;
  if (!start || !end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
};

const formatFileSize = (bytes) => {
  if (bytes == null || bytes === 0) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

function buildPdfViewUrl(pdfDocumentId) {
  if (pdfDocumentId == null || pdfDocumentId === '') return null;
  try {
    return pdfViewUrl(pdfDocumentId);
  } catch {
    return null;
  }
}

const STATUS_BADGE = {
  PENDING:     'ass-status-pill--info',
  IN_PROGRESS: 'ass-status-pill--running',
  COMPLETED:   'ass-status-pill--done',
  FAILED:      'ass-status-pill--fail',
  CANCELLED:   'ass-status-pill--fail',
};

const statusLabel = (status) => {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return 'RUNNING';
  return String(status || '').replace(/_/g, ' ');
};

const AssEpubThumbLabel = () => (
  <span className="ass-job-card-thumb-epub-label">EPUB</span>
);

const AssPdfThumb = memo(function AssPdfThumb({ pdfId, epubSource = false }) {
  const url = useMemo(() => buildPdfViewUrl(pdfId), [pdfId]);
  const cacheKey =
    pdfId != null && pdfId !== '' ? `pdf-thumb-card-${String(pdfId)}` : null;

  const epubFallback = (
    <div className="ass-job-card-thumb-fallback ass-job-card-thumb-epub" aria-hidden>
      <AssEpubThumbLabel />
    </div>
  );

  if (!url) {
    if (epubSource) return epubFallback;
    return (
      <div className="ass-job-card-thumb-fallback" aria-hidden>
        <FileText size={28} />
      </div>
    );
  }

  return (
    <>
      <div className="ass-job-card-thumb-fallback ass-job-card-thumb-fallback--under" aria-hidden>
        {epubSource ? <AssEpubThumbLabel /> : <FileText size={28} />}
      </div>
      <div className="ass-job-card-thumb-preview">
        <PdfThumbnail
          url={url}
          width={200}
          height={280}
          scale={1.25}
          cacheKey={cacheKey}
          className="ass-job-card-pdf-thumb"
          alt=""
          fallback={epubSource ? epubFallback : undefined}
        />
      </div>
    </>
  );
});

/* ─── Job selector ────────────────────────────────────────────── */
const JobSelector = ({ jobs, loading, primeAudioSyncWorkflow, listScope, onSelect, onDelete }) => {
  const ITEMS_PER_PAGE = 9;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(jobs.length / ITEMS_PER_PAGE));
  const paginatedJobs = jobs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, idx) => idx + 1);
    }

    const pages = [1];
    const windowStart = Math.max(2, currentPage - 1);
    const windowEnd = Math.min(totalPages - 1, currentPage + 1);

    if (windowStart > 2) pages.push('ellipsis-left');
    for (let p = windowStart; p <= windowEnd; p += 1) pages.push(p);
    if (windowEnd < totalPages - 1) pages.push('ellipsis-right');
    pages.push(totalPages);

    return pages;
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="ass-selector-root">
      <div className="ass-selector-header">
        <h2 className="ass-selector-title">Audio Sync Studio</h2>
        <p className="ass-selector-sub">
          {listScope === 'own'
            ? 'Select one of your completed jobs to add narration and sync audio'
            : 'Select a completed conversion job to add narration and sync audio'}
        </p>
      </div>
      {loading ? (
        <div className="ass-selector-loading">
          <div className="ass-spinner" /> Loading jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="ass-selector-empty">
          <FileText size={40} />
          <p>
            No completed jobs available. Import an EPUB from{' '}
            <Link to="/epub-sync-import">EPUB → Audio Sync</Link> or complete a PDF conversion first.
          </p>
        </div>
      ) : (
        <>
          <JobGrid className="ass-job-grid">
            {paginatedJobs.map((job) => {
              const jobId = job.id ?? job.jobId;
              const to = audioSyncPath(job);

              const handleCardActivate = () => {
                primeAudioSyncWorkflow(job);
                onSelect(to);
              };

              return (
                <div key={`${isFixedLayout(job) ? 'FXL' : 'REFLOW'}-${jobId}`} className="ass-selector-card-wrap">
                  <JobCard
                    job={job}
                    isSelected={false}
                    onSelect={handleCardActivate}
                    onOpenEditor={handleCardActivate}
                    onDelete={onDelete}
                  />
                </div>
              );
            })}
          </JobGrid>
          {jobs.length > ITEMS_PER_PAGE && (
            <div className="ass-pagination" role="navigation" aria-label="Jobs pagination">
              <div className="ass-pagination-shell">
                <button
                  type="button"
                  className="ass-pagination-nav"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <span aria-hidden>←</span> Previous
                </button>
                <div className="ass-pagination-pages">
                  {pageNumbers.map((page, idx) =>
                    typeof page === 'string' ? (
                      <span key={`${page}-${idx}`} className="ass-pagination-ellipsis" aria-hidden>
                        …
                      </span>
                    ) : (
                      <button
                        key={page}
                        type="button"
                        className={`ass-pagination-page ${currentPage === page ? 'is-active' : ''}`}
                        onClick={() => setCurrentPage(page)}
                        aria-current={currentPage === page ? 'page' : undefined}
                      >
                        {page}
                      </button>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  className="ass-pagination-nav"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next <span aria-hidden>→</span>
                </button>
              </div>
          
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ─── Main component ──────────────────────────────────────────── */
const AudioSyncStudio = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const dispatch = useAppDispatch();
  const listScope = useListScope();
  const [error, setError] = useState('');
  const [deleteModal, setDeleteModal] = useState({ open: false, job: null, loading: false });

  const { jobs: allJobs, loading: jobsLoading, error: jobsError, refetch } = useConversions({
    excludeEpubImports: true,
    includeEpubSyncSessions: true,
  });
  const actionError = useAppSelector(selectActionError);
  const { goToAudioSync, primeAudioSyncWorkflow } = useWorkflowNavigation();
  const { prepareDelete, confirmDelete: runConfirmDelete } = useConversionActions();

  useEffect(() => {
    if (jobsError) setError(jobsError);
  }, [jobsError]);

  const handleSelectJob = useCallback(
    (job) => {
      goToAudioSync(job);
    },
    [goToAudioSync],
  );

  const handleStepClick = useCallback(
    (step) => {
      navigate(step.path);
    },
    [navigate],
  );

  const handleCardSelect = useCallback(
    (to) => {
      navigate(to);
    },
    [navigate],
  );

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
      setDeleteModal({ open: false, job: null, loading: false });
    } else {
      setDeleteModal((prev) => ({ ...prev, loading: false }));
    }
  }, [runConfirmDelete, refetch]);

  useEffect(() => {
    if (jobsLoading) return;
    const stateJobId = location.state?.jobId ?? params?.jobId;
    if (!stateJobId) return;
    const found = allJobs.find((j) => String(j.id ?? j.jobId) === String(stateJobId));
    if (found) {
      handleSelectJob(found);
    }
   
  }, [jobsLoading, allJobs, location.state, params?.jobId]);

  return (
    <div className="ass-root">
      <div className="ass-topbar">
        <h1 className="ass-topbar-title ass-topbar-title--grow">Audio Sync Studio</h1>
        <div className="ass-topbar-right">
          <button type="button" className="ass-back-btn" onClick={() => navigate('/conversions')}>
            <ArrowLeft size={15} /> Back to conversions
          </button>
        </div>
      </div>

      <WorkflowStepper activeStep={2} jobId={null} onStepClick={handleStepClick} />

      {(error || actionError) && (
        <div className="ass-error-bar">
          {error || actionError}
          <button
            type="button"
            onClick={() => {
              setError('');
              dispatch(clearActionError());
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <JobSelector
        jobs={allJobs}
        loading={jobsLoading}
        primeAudioSyncWorkflow={primeAudioSyncWorkflow}
        listScope={listScope}
        onSelect={handleCardSelect}
        onDelete={handleDelete}
      />

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

export default AudioSyncStudio;
