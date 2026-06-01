/**
 * ImageFxlEditor — job selector page at /conversions/fxl-editor
 *
 * Clicking a card navigates to the dedicated editor:
 *   FXL   → /conversions/fxl-editor/:jobId  → KitabooZoningStudio
 *   Reflow → /conversions/image-editor/:jobId → EpubImageEditorPage
 */
import { useMemo, memo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, FileText, Layers } from 'lucide-react';
import WorkflowStepper from '../../components/WorkflowStepper';
import { useListScope } from '../../context/ListScopeContext';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { isFixedLayout, useWorkflowNavigation } from '../../hooks/useWorkflowNavigation';
import { useConversionActions } from '../../hooks/useConversionActions';
import JobCard, { JobGrid } from '../../components/JobCard';
import ConfirmModal from '../../components/Loadingmodal';
import './ImageFxlEditor.css';

/* ─── Job selector grid ───────────────────────────────────────── */
const JobSelector = ({ jobs, onSelect, onDelete, loading, listScope }) => {
  const ITEMS_PER_PAGE = 9;
  const [tab, setTab] = useState('FXL');

  const fxlJobs    = jobs.filter(j => isFixedLayout(j));
  const reflowJobs = jobs.filter(j => !isFixedLayout(j));
  const visible    = tab === 'FXL' ? fxlJobs : reflowJobs;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visible.length / ITEMS_PER_PAGE));
  const paginatedVisible = visible.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
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
    setCurrentPage(1);
  }, [tab]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="ife-selector-root">
      <div className="ife-selector-header">
        <h2 className="ife-selector-title">Image Editor &amp; FXL Studio</h2>
        <p className="ife-selector-sub">
          {listScope === 'own'
            ? 'Select one of your completed jobs to view zones overlaid on the PDF.'
            : 'Select a completed FXL job to view zones overlaid on the PDF.'}{' '}
          Reflow jobs are also available but do not have zone data.
        </p>
      </div>

      <div className="ife-selector-tabs">
        <button
          type="button"
          className={`ife-selector-tab${tab === 'FXL' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('FXL')}
        >
          <Layers size={14} />
          FXL Jobs
          <span className="ife-selector-tab-count">{fxlJobs.length}</span>
        </button>
        <button
          type="button"
          className={`ife-selector-tab${tab === 'REFLOW' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('REFLOW')}
        >
          <FileText size={14} />
          Reflow Jobs
          <span className="ife-selector-tab-count">{reflowJobs.length}</span>
        </button>
      </div>

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
        <JobGrid className="ife-job-grid">
          {paginatedVisible.map((job) => {
            const jobId = job.id ?? job.jobId;
            return (
              <div
                key={jobId}
                className="ife-selector-card-wrap"
              >
                <JobCard
                  job={job}
                  isSelected={false}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onOpenEditor={onSelect}
                />
              </div>
            );
          })}
        </JobGrid>
      )}
      {visible.length > ITEMS_PER_PAGE && !loading && (
        <div className="ife-pagination" role="navigation" aria-label="Jobs pagination">
          <div className="ife-pagination-shell">
            <button
              type="button"
              className="ife-pagination-nav"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <span aria-hidden>←</span> Previous
            </button>
            <div className="ife-pagination-pages">
              {pageNumbers.map((page, idx) =>
                typeof page === 'string' ? (
                  <span key={`${page}-${idx}`} className="ife-pagination-ellipsis" aria-hidden>
                    …
                  </span>
                ) : (
                  <button
                    key={page}
                    type="button"
                    className={`ife-pagination-page ${currentPage === page ? 'is-active' : ''}`}
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
              className="ife-pagination-nav"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next <span aria-hidden>→</span>
            </button>
          </div>
         
        </div>
      )}
    </div>
  );
};

/* ─── Page component ──────────────────────────────────────────── */
const ImageFxlEditor = () => {
  const navigate = useNavigate();
  const { goToEditor } = useWorkflowNavigation();
  const listScope = useListScope();
  const { prepareDelete, confirmDelete: runConfirmDelete } = useConversionActions();
  const [deleteModal, setDeleteModal] = useState({ open: false, job: null, loading: false });

  const { jobs: allJobs, isLoading: jobsLoading } = useConversionsQuery({
    statusFilter: 'COMPLETED',
    excludeEpubImports: true,
  });

  const handleSelect = (job) => {
    goToEditor(job);
  };

  const handleDelete = useCallback(
    (job) => {
      prepareDelete(job);
      setDeleteModal({ open: true, job, loading: false });
    },
    [prepareDelete],
  );

  const confirmDelete = useCallback(async () => {
    setDeleteModal((prev) => ({ ...prev, loading: true }));
    try {
      await runConfirmDelete();
    } finally {
      setDeleteModal({ open: false, job: null, loading: false });
    }
  }, [runConfirmDelete]);

  return (
    <div className="ife-root">
      <div className="ife-topbar">
        <div className="ife-topbar-left">
          <h1 className="ife-topbar-title">Image Editor &amp; FXL Studio</h1>
        </div>
        <div className="ife-topbar-right">
          <button type="button" className="ife-back-btn" onClick={() => navigate('/conversions')}>
            <ArrowLeft size={15} /> Back to jobs
          </button>
        </div>
      </div>

      <WorkflowStepper activeStep={1} jobId={null} onStepClick={(s) => navigate(s.path)} />

      <JobSelector
        jobs={allJobs}
        onSelect={handleSelect}
        onDelete={handleDelete}
        loading={jobsLoading}
        listScope={listScope}
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

export default ImageFxlEditor;
