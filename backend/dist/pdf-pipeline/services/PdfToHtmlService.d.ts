import type { JobDirectoryLayout } from '../utils/jobPaths.js';
export interface PdfToHtmlResult {
    mainHtmlPath: string;
    htmlFiles: string[];
    cssFiles: string[];
    imageFiles: string[];
    fontFiles: string[];
}
export declare class PdfToHtmlService {
    static readonly DOCKER_IMAGE: string;
    /**
     * Convert PDF to HTML using pdf2htmlEX inside Docker.
     * Assets are organized into job subdirectories after conversion.
     */
    static convert(layout: JobDirectoryLayout, options?: {
        splitPages?: boolean;
    }): Promise<PdfToHtmlResult>;
    private static runDocker;
    private static organizeOutput;
}
//# sourceMappingURL=PdfToHtmlService.d.ts.map