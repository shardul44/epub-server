import type { JobStatus, PdfPipelineJob } from '../types.js';

const jobs = new Map<string, PdfPipelineJob>();

export const pdfPipelineJobStore = {
  create(job: PdfPipelineJob): PdfPipelineJob {
    const now = new Date().toISOString();
    const record: PdfPipelineJob = {
      ...job,
      createdAt: job.createdAt || now,
      updatedAt: now,
    };
    jobs.set(job.id, record);
    return record;
  },

  get(id: string): PdfPipelineJob | null {
    return jobs.get(id) || null;
  },

  update(
    id: string,
    patch: Partial<Omit<PdfPipelineJob, 'id' | 'createdAt'>>
  ): PdfPipelineJob | null {
    const job = jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  },

  complete(
    id: string,
    result: {
      coordsPath: string;
      epubPath: string;
      pageCount: number;
      wordCount: number;
      sentenceCount: number;
    }
  ): PdfPipelineJob | null {
    return pdfPipelineJobStore.update(id, {
      status: 'COMPLETED' as JobStatus,
      progress: 100,
      step: 'Conversion complete',
      coordsPath: result.coordsPath,
      epubPath: result.epubPath,
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      sentenceCount: result.sentenceCount,
    });
  },

  fail(id: string, error: string): PdfPipelineJob | null {
    return pdfPipelineJobStore.update(id, {
      status: 'FAILED' as JobStatus,
      step: 'Failed',
      error,
    });
  },

  list(): PdfPipelineJob[] {
    return Array.from(jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  /** Check if job ID belongs to pdf pipeline (UUID format) */
  isPipelineJobId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  },
};
