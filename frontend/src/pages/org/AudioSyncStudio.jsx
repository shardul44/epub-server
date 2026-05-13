import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useConversions } from '../../hooks/useConversions';
import { useWorkflowNavigation, isFixedLayout, audioSyncPath } from '../../hooks/useWorkflowNavigation';
import WorkflowStepper from '../../components/WorkflowStepper';
import ThumbnailImage from '../../components/ThumbnailImage';
import { ArrowLeft, FileText, X } from 'lucide-react';
import './AudioSyncStudio.css';

/* ─── Job selector ────────────────────────────────────────────── */
const JobSelector = ({ jobs, loading, primeAudioSyncWorkflow }) => (
  <div className="ass-selector-root">
    <div className="ass-selector-header">
      <h2 className="ass-selector-title">Audio Sync Studio</h2>
      <p className="ass-selector-sub">Select a completed conversion job to add narration and sync audio</p>
    </div>
    {loading ? (
      <div className="ass-selector-loading"><div className="ass-spinner" /> Loading jobs…</div>
    ) : jobs.length === 0 ? (
      <div className="ass-selector-empty">
        <FileText size={40} />
        <p>No completed jobs available. Complete a conversion first.</p>
      </div>
    ) : (
      <div className="ass-selector-grid">
        {jobs.map(job => {
          const jobId = job.id ?? job.jobId;
          const fxl = isFixedLayout(job);
          const to = audioSyncPath(job);
          return (
            <Link
              key={`${fxl ? 'FXL' : 'REFLOW'}-${jobId}`}
              to={to}
              className="ass-job-card"
              onClick={() => primeAudioSyncWorkflow(job)}
            >
              <div className="ass-job-card-thumb">
                <ThumbnailImage
                  pdfId={job.pdfDocumentId ?? job.pdfId}
                  alt="PDF preview"
                  fallback={<div className="ass-job-card-fallback"><FileText size={32} /></div>}
                />
              </div>
              <div className="ass-job-card-body">
                <div className="ass-job-card-id">Job #{jobId}</div>
                <div className="ass-job-card-name">{job.pdfFilename || `PDF ${job.pdfDocumentId ?? job.pdfId}`}</div>
                <div className="ass-job-card-meta">
                  <span className={`ass-type-pill ${fxl ? 'ass-type-pill--fxl' : ''}`}>
                    {fxl ? 'FXL' : 'Reflow'}
                  </span>
                  <span className="ass-status-pill">✓ Completed</span>
                </div>
              </div>
              <span className="ass-job-card-open">Open Audio Sync →</span>
            </Link>
          );
        })}
      </div>
    )}
  </div>
);

/* ─── Main component ──────────────────────────────────────────── */
const AudioSyncStudio = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const params    = useParams();
  const [error, setError] = useState('');

  const { jobs: allJobs, loading: jobsLoading, error: jobsError } = useConversions();
  const { goToAudioSync, primeAudioSyncWorkflow } = useWorkflowNavigation();

  useEffect(() => {
    if (jobsError) setError(jobsError);
  }, [jobsError]);

  // Auto-redirect when a jobId is in the URL or navigation state.
  // Handles /conversions/audio-sync/:jobId (legacy), canonical /sync-studio/:id and /fxl-sync-studio/:id.
  useEffect(() => {
    if (jobsLoading) return;
    const stateJobId = location.state?.jobId ?? params?.jobId;
    if (!stateJobId) return;
    const found = allJobs.find(j => String(j.id ?? j.jobId) === String(stateJobId));
    if (found) {
      handleSelectJob(found);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsLoading, allJobs, location.state, params?.jobId]);

  const handleSelectJob = useCallback((job) => {
    // Use the workflow navigation hook for correct FXL/Reflow routing
    goToAudioSync(job);
  }, [goToAudioSync]);

  const handleStepClick = useCallback((step) => {
    navigate(step.path);
  }, [navigate]);

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

      {error && (
        <div className="ass-error-bar">
          {error}
          <button onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      <JobSelector jobs={allJobs} loading={jobsLoading} primeAudioSyncWorkflow={primeAudioSyncWorkflow} />
    </div>
  );
};

export default AudioSyncStudio;
