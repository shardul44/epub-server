/**
 * In-memory store for Kitaboo FXL conversion jobs.
 * Keys: jobId (string). Values: { jobId, pdfId, status, progressPercentage, currentStep, error?, pages?, createdAt }.
 * Multiple jobs can exist for the same PDF.
 */
const jobsByJobId = new Map();

const STATUS = { PENDING: 'PENDING', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', FAILED: 'FAILED' };

export const kitabooFxlJobStore = {
  get(jobId) {
    return jobsByJobId.get(String(jobId)) || null;
  },

  getByPdfId(pdfId) {
    const all = Array.from(jobsByJobId.values()).filter(j => String(j.pdfId) === String(pdfId));
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all;
  },

  /** Return all FXL jobs (for Conversions page listing). */
  listAll() {
    return Array.from(jobsByJobId.entries()).map(([jobId, job]) => ({
      ...job,
      jobId,
      pdfId: job.pdfId,
      pdfDocumentId: parseInt(job.pdfId, 10),
      jobType: 'FXL',
      id: jobId,
      createdAt: job.createdAt,
      completedAt: job.status === STATUS.COMPLETED ? job.updatedAt || job.createdAt : null
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /** Start a new job for the given PDF. Always creates a new job (multiple jobs per PDF allowed). */
  start(pdfId, jobId) {
    const now = new Date().toISOString();
    const job = {
      jobId,
      pdfId: String(pdfId),
      status: STATUS.IN_PROGRESS,
      progressPercentage: 0,
      currentStep: 'Starting...',
      error: null,
      pages: null,
      createdAt: now,
      updatedAt: now
    };
    jobsByJobId.set(String(jobId), job);
    return job;
  },

  updateProgress(jobId, { progressPercentage, currentStep }) {
    const job = jobsByJobId.get(String(jobId));
    if (!job) return;
    if (progressPercentage !== undefined) job.progressPercentage = Math.min(100, Math.max(0, progressPercentage));
    if (currentStep !== undefined) job.currentStep = currentStep;
    job.updatedAt = new Date().toISOString();
  },

  complete(jobId, pages, extractedFonts, extractionLevel) {
    const job = jobsByJobId.get(String(jobId));
    if (!job) return;
    job.status = STATUS.COMPLETED;
    job.progressPercentage = 100;
    job.currentStep = 'Complete';
    job.pages = pages;
    job.extractedFonts = extractedFonts || [];
    job.extractionLevel = extractionLevel || 'sentence';
    job.error = null;
    job.updatedAt = new Date().toISOString();
  },

  fail(jobId, errorMessage) {
    const job = jobsByJobId.get(String(jobId));
    if (!job) return;
    job.status = STATUS.FAILED;
    job.error = errorMessage || 'Unknown error';
    job.updatedAt = new Date().toISOString();
  },

  /** Remove a job from the store (used when deleting an FXL job). */
  remove(jobId) {
    jobsByJobId.delete(String(jobId));
  },

  /** Restore a completed job from DB (e.g. after server restart) so studio can open. */
  restore(jobId, pdfId) {
    const now = new Date().toISOString();
    const job = {
      jobId: String(jobId),
      pdfId: String(pdfId),
      status: STATUS.COMPLETED,
      progressPercentage: 100,
      currentStep: 'Complete',
      error: null,
      pages: null,
      createdAt: now,
      updatedAt: now
    };
    jobsByJobId.set(String(jobId), job);
    return job;
  }
};
