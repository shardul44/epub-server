/**
 * WorkflowStepper — shared 4-step conversion workflow stepper.
 *
 * Used by: ConversionJobs, ImageFxlEditor, AudioSyncStudio, DownloadEpub.
 *
 * Props:
 *   activeStep  — 0-based index of the current step (0–3)
 *   jobId       — optional job ID; when provided, editor/audio/download
 *                 steps navigate directly to the job-specific route.
 *   job         — optional full job object; used to determine FXL vs Reflow
 *                 for the audio-sync route. Falls back to jobId-only paths.
 *   onStepClick — (step: { key, label, sub, path }) => void
 */

import React, { memo } from 'react';
import { Check, Lock, ChevronRight } from 'lucide-react';
import { isFixedLayout } from '../hooks/useWorkflowNavigation';
import './WorkflowStepper.css';

/* ─── Base step definitions (paths are overridden when jobId is known) ── */
export const WORKFLOW_STEPS = [
  { key: 'jobs',     label: 'Conversion Jobs',          sub: 'PDF processed',        path: '/conversions' },
  { key: 'editor',  label: 'Image Editor & FXL Studio', sub: 'Edit zones & layout',  path: '/conversions/fxl-editor' },
  { key: 'audio',   label: 'Audio Sync Studio',          sub: 'Add narration & sync', path: '/conversions/audio-sync' },
  { key: 'download',label: 'Download EPUB',              sub: 'Get your final file',  path: '/conversions/download' },
];

/**
 * Build the concrete path for each step given the current jobId and job type.
 * When jobId is unknown we fall back to the selector pages.
 */
function buildStepPaths(jobId, job) {
  if (!jobId) return WORKFLOW_STEPS;

  const fxl = job ? isFixedLayout(job) : null; // null = unknown type

  return WORKFLOW_STEPS.map((step) => {
    switch (step.key) {
      case 'editor':
        // If we know the type, go directly; otherwise fall back to selector
        if (fxl === true)  return { ...step, path: `/conversions/fxl-editor/${jobId}` };
        if (fxl === false) return { ...step, path: `/conversions/image-editor/${jobId}` };
        return { ...step, path: `/conversions/fxl-editor/${jobId}` }; // best guess

      case 'audio':
        if (fxl === true)  return { ...step, path: `/fxl-sync-studio/${jobId}` };
        if (fxl === false) return { ...step, path: `/sync-studio/${jobId}` };
        return { ...step, path: `/conversions/audio-sync/${jobId}` }; // fallback

      case 'download':
        return { ...step, path: `/conversions/download/${jobId}` };

      default:
        return step;
    }
  });
}

const WorkflowStepper = memo(({ activeStep, jobId, job, onStepClick }) => {
  const steps = buildStepPaths(jobId, job);

  return (
    <div className="wf-stepper">
      {steps.map((step, idx) => {
        const done   = idx < activeStep;
        const active = idx === activeStep;
        const locked = idx > activeStep;
        return (
          <button
            key={step.key}
            type="button"
            className={[
              'wf-step',
              done   ? 'wf-step--done'   : '',
              active ? 'wf-step--active' : '',
              locked ? 'wf-step--locked' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => !locked && onStepClick(step)}
            disabled={locked}
            aria-current={active ? 'step' : undefined}
          >
            <span className="wf-step-circle">
              {done   ? <Check size={12} /> :
               locked ? <Lock size={10} /> :
               <span>{idx + 1}</span>}
            </span>
            <span className="wf-step-body">
              <span className="wf-step-label">{step.label}</span>
              <span className="wf-step-sub">{step.sub}</span>
            </span>
            {idx < steps.length - 1 && (
              <ChevronRight className="wf-step-arrow" size={13} />
            )}
          </button>
        );
      })}
      {jobId && <span className="wf-job-chip">Job #{jobId}</span>}
    </div>
  );
});

WorkflowStepper.displayName = 'WorkflowStepper';

export default WorkflowStepper;
