/** localStorage key prefix — shared by JobCard (Conversions) and ImageFxlEditor job picker */
export const JOB_CARD_THUMB_PREFIX = 'cjCardThumb:v1:';

export function loadStoredJobThumb(jobId) {
  if (jobId == null || jobId === '') return null;
  try {
    return localStorage.getItem(`${JOB_CARD_THUMB_PREFIX}${jobId}`) || null;
  } catch {
    return null;
  }
}

export function saveStoredJobThumb(jobId, dataUrl) {
  if (jobId == null || jobId === '') return;
  try {
    if (dataUrl) localStorage.setItem(`${JOB_CARD_THUMB_PREFIX}${jobId}`, dataUrl);
    else localStorage.removeItem(`${JOB_CARD_THUMB_PREFIX}${jobId}`);
  } catch (e) {
    console.warn('Could not persist job card thumbnail', e);
  }
}
