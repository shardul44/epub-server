/**
 * WorkflowStepper — shared 4-step conversion workflow stepper.
 *
 * Used by: ConversionJobs, ImageFxlEditor, AudioSyncStudio, DownloadEpub.
 *
 * Props:
 *   activeStep  — 0-based index of the current step (0–3)
 *   jobId       — optional job ID shown as a chip
 *   onStepClick — (step: { key, label, sub, path }) => void
 *   variant     — 'cj' | 'ass' | 'de' — CSS prefix (default: 'cj')
 */

import React, { memo } from 'react';
import {
  Check,
  Lock,
  ChevronRight,
} from 'lucide-react';

export const WORKFLOW_STEPS = [
  { key: 'jobs',     label: 'Conversion Jobs',          sub: 'PDF processed',        path: '/conversions' },
  { key: 'editor',  label: 'Image Editor & FXL Studio', sub: 'Edit zones & layout',  path: '/conversions/fxl-editor' },
  { key: 'audio',   label: 'Audio Sync Studio',          sub: 'Add narration & sync', path: '/conversions/audio-sync' },
  { key: 'download',label: 'Download EPUB',              sub: 'Get your final file',  path: '/conversions/download' },
];

const WorkflowStepper = memo(({ activeStep, jobId, onStepClick, variant = 'cj' }) => (
  <div className={`${variant}-stepper`}>
    {WORKFLOW_STEPS.map((step, idx) => {
      const done   = idx < activeStep;
      const active = idx === activeStep;
      const locked = idx > activeStep;
      return (
        <button
          key={step.key}
          className={[
            `${variant}-step`,
            done   ? `${variant}-step--done`   : '',
            active ? `${variant}-step--active` : '',
            locked ? `${variant}-step--locked` : '',
          ].filter(Boolean).join(' ')}
          onClick={() => !locked && onStepClick(step)}
          disabled={locked}
          aria-current={active ? 'step' : undefined}
        >
          <span className={`${variant}-step-circle`}>
            {done   ? <Check size={12} /> :
             locked ? <Lock size={10} /> :
             <span>{idx + 1}</span>}
          </span>
          <span className={`${variant}-step-body`}>
            <span className={`${variant}-step-label`}>{step.label}</span>
            <span className={`${variant}-step-sub`}>{step.sub}</span>
          </span>
          {idx < WORKFLOW_STEPS.length - 1 && (
            <ChevronRight className={`${variant}-step-arrow`} size={13} />
          )}
        </button>
      );
    })}
    {jobId && <span className={`${variant}-job-chip`}>Job #{jobId}</span>}
  </div>
));

WorkflowStepper.displayName = 'WorkflowStepper';

export default WorkflowStepper;
