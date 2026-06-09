import type { PdfPipelineJob } from '../types.js';
export declare const pdfPipelineJobStore: {
    create(job: PdfPipelineJob): PdfPipelineJob;
    get(id: string): PdfPipelineJob | null;
    update(id: string, patch: Partial<Omit<PdfPipelineJob, "id" | "createdAt">>): PdfPipelineJob | null;
    complete(id: string, result: {
        coordsPath: string;
        epubPath: string;
        pageCount: number;
        wordCount: number;
        sentenceCount: number;
    }): PdfPipelineJob | null;
    fail(id: string, error: string): PdfPipelineJob | null;
    list(): PdfPipelineJob[];
    /** Check if job ID belongs to pdf pipeline (UUID format) */
    isPipelineJobId(id: string): boolean;
};
//# sourceMappingURL=pdfPipelineJobStore.d.ts.map