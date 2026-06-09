const jobs = new Map();
export const pdfPipelineJobStore = {
    create(job) {
        const now = new Date().toISOString();
        const record = {
            ...job,
            createdAt: job.createdAt || now,
            updatedAt: now,
        };
        jobs.set(job.id, record);
        return record;
    },
    get(id) {
        return jobs.get(id) || null;
    },
    update(id, patch) {
        const job = jobs.get(id);
        if (!job)
            return null;
        Object.assign(job, patch, { updatedAt: new Date().toISOString() });
        return job;
    },
    complete(id, result) {
        return pdfPipelineJobStore.update(id, {
            status: 'COMPLETED',
            progress: 100,
            step: 'Conversion complete',
            coordsPath: result.coordsPath,
            epubPath: result.epubPath,
            pageCount: result.pageCount,
            wordCount: result.wordCount,
            sentenceCount: result.sentenceCount,
        });
    },
    fail(id, error) {
        return pdfPipelineJobStore.update(id, {
            status: 'FAILED',
            step: 'Failed',
            error,
        });
    },
    list() {
        return Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    /** Check if job ID belongs to pdf pipeline (UUID format) */
    isPipelineJobId(id) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    },
};
//# sourceMappingURL=pdfPipelineJobStore.js.map