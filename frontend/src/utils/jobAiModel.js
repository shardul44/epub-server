/**
 * Resolve the AI model name shown on job cards.
 * Jobs rarely store model on the row; fall back to platform active config via useActiveAiModel().
 */

export function resolveAiModel(job) {
  if (!job) return null;
  const direct =
    job.aiModel ||
    job.ai_model ||
    job.modelName ||
    job.model ||
    job.llmModel ||
    null;
  if (direct) return direct;
  try {
    const raw = job.intermediateData ?? job.intermediate_data;
    if (raw) {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data?.modelName) return data.modelName;
      if (data?.aiModel) return data.aiModel;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Job-specific model, else platform default, else em dash. */
export function displayAiModel(job, platformModelName) {
  return resolveAiModel(job) || platformModelName || '—';
}
