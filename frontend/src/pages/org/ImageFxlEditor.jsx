/**
 * ImageFxlEditor — job selector page at /conversions/fxl-editor
 *
 * Clicking a card navigates to the dedicated editor:
 *   FXL   → /conversions/fxl-editor/:jobId  → KitabooZoningStudio
 *   Reflow → /conversions/image-editor/:jobId → EpubImageEditorPage
 *
 * All studio logic (PDF loading, zones, OCR, gallery, undo/redo, save,
 * keyboard shortcuts) has been removed — those pages handle it themselves.
 */
import { useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, FileText, Layers } from 'lucide-react';
import WorkflowStepper from '../../components/WorkflowStepper';
import { useConversionsQuery } from '../../hooks/queries/useConversionsQuery';
import { isFixedLayout, useWorkflowNavigation } from '../../hooks/useWorkflowNavigation';
import { loadStoredJobThumb } from '../../utils/jobCardThumb';
import ThumbnailImage from '../../components/ThumbnailImage';
import './ImageFxlEditor.css';

/* ─── Job card thumbnail ──────────────────────────────────────── */
const IfeJobCardThumb = memo(function IfeJobCardThumb({ jobId, pdfId }) {
  const customSrc = loadStoredJobThumb(jobId);

  if (customSrc) {
    return (
      <div className="ife-job-card-thumb ife-job-card-thumb--custom">
        <img src={customSrc} alt="" />
      </div>
    );
  }

  return (
    <div className="ife-job-card-thumb">
      <ThumbnailImage
        pdfId={pdfId}
        fallback={<div className="ife-job-card-fallback"><FileText size={32} /></div>}
      />
    </div>
  );
});

/* ─── Job selector grid ───────────────────────────────────────── */
const JobSelector = ({ jobs, onSelect, loading }) => {
  const [tab, setTab] = useState('FXL');

  const fxlJobs    = jobs.filter(j => isFixedLayout(j));
  const reflowJobs = jobs.filter(j => !isFixedLayout(j));
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
          className={`ife-selector-tab${tab === 'FXL' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('FXL')}
        >
          <Layers size={14} />
          FXL Jobs
          <span className="ife-selector-tab-count">{fxlJobs.length}</span>
        </button>
        <button
          className={`ife-selector-tab${tab === 'REFLOW' ? ' ife-selector-tab--active' : ''}`}
          onClick={() => setTab('REFLOW')}
        >
          <FileText size={14} />
          Reflow Jobs
          <span className="ife-selector-tab-count">{reflowJobs.length}</span>
        </button>
      </div>

      {/* Info banner */}
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
            const fxl   = isFixedLayout(job);
            return (
              <button key={jobId} className="ife-job-card" onClick={() => onSelect(job)}>
                <div className="ife-job-card-thumb-wrap">
                  <IfeJobCardThumb jobId={jobId} pdfId={pdfId} />
                  {fxl && (
                    <span className="ife-job-card-zones-badge">
                      <Layers size={10} /> Zones
                    </span>
                  )}
                </div>
                <div className="ife-job-card-body">
                  <div className="ife-job-card-id">Job #{jobId}</div>
                  <div className="ife-job-card-name">{job.pdfFilename || `PDF ${pdfId}`}</div>
                  <div className="ife-job-card-meta">
                    <span className={`ife-type-pill${fxl ? ' ife-type-fxl' : ' ife-type-reflow'}`}>
                      {fxl ? 'FXL' : 'Reflow'}
                    </span>
                    <span className="ife-status-pill">✓ Completed</span>
                  </div>
                </div>
                <span className="ife-job-card-open">
                  {fxl ? 'Open with Zones →' : 'Open Editor →'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ─── Page component ──────────────────────────────────────────── */
const ImageFxlEditor = () => {
  const navigate = useNavigate();
  const { goToEditor } = useWorkflowNavigation();

  const { jobs: allJobs, isLoading: jobsLoading } = useConversionsQuery({
    statusFilter: 'COMPLETED',
  });

  const handleSelect = (job) => {
    goToEditor(job);
  };

  return (
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

      <JobSelector jobs={allJobs} onSelect={handleSelect} loading={jobsLoading} />
    </div>
  );
};

export default ImageFxlEditor;
