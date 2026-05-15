/**
 * Shared workflow chrome: top bar + 4-step WorkflowStepper.
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
  backTo,
  onBack,
  conversionsPath = '/conversions',
  hideBackToConversions,
}) {
  const navigate = useNavigate();
  const handleBack = onBack ?? (() => navigate(backTo));
  const handleBackToConversions = useCallback(() => {
    navigate(conversionsPath);
  }, [navigate, conversionsPath]);
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
        <h1 className="ass-topbar-title ass-topbar-title--grow">{topTitle}</h1>
        {!hideBackToConversions ? (
          <div className="ass-topbar-right">
            <button type="button" className="ass-back-btn" onClick={handleBackToConversions}>
              <ArrowLeft size={15} /> Back to conversions
            </button>
          </div>
        ) : null}
      </div>
      <WorkflowStepper
        activeStep={activeStep}
        jobId={safeJobId}
        job={job}
        onStepClick={handleStepClick}
      />
    </div>
  );
}
