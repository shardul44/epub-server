/**
 * Shared workflow chrome: top bar + 4-step WorkflowStepper + optional page heading.
 * Reuses AudioSyncStudio.css (ass-*) for visual parity with /conversions/audio-sync.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import WorkflowStepper from './WorkflowStepper';
import '../pages/org/AudioSyncStudio.css';
import './WorkflowStudioChrome.css';

export default function WorkflowStudioChrome({
  activeStep,
  jobId,
  job,
  topTitle,
  headingTitle,
  headingSub,
  backTo,
  onBack,
  rightActions,
}) {
  const navigate = useNavigate();
  const handleBack = onBack ?? (() => navigate(backTo));
  const handleStepClick = useCallback((step) => {
    navigate(step.path);
  }, [navigate]);

  const jid = jobId != null && jobId !== ''
    ? (typeof jobId === 'number' ? jobId : Number(jobId))
    : null;
  const safeJobId = jid != null && !Number.isNaN(jid) ? jid : null;

  return (
    <div className="wsc-chrome">
      <div className="ass-topbar">
        <button type="button" className="ass-back-btn" onClick={handleBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <h1 className="ass-topbar-title">{topTitle}</h1>
      </div>
      <WorkflowStepper
        activeStep={activeStep}
        jobId={safeJobId}
        job={job}
        onStepClick={handleStepClick}
      />
      {(headingTitle || headingSub) && (
        <div className="ass-selector-header wsc-page-heading">
          <div className="wsc-page-heading-main">
            {headingTitle ? <h2 className="ass-selector-title">{headingTitle}</h2> : null}
            {headingSub ? <p className="ass-selector-sub">{headingSub}</p> : null}
          </div>
          {rightActions ? (
            <div className="wsc-page-heading-actions">
              {rightActions}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
