export interface JobDirectoryLayout {
    root: string;
    sourcePdf: string;
    html: string;
    css: string;
    images: string;
    fonts: string;
    coords: string;
    epub: string;
    smil: string;
    outputEpub: string;
    meta: string;
}
export declare function getJobDirectoryLayout(jobRoot: string): JobDirectoryLayout;
export declare const JOB_SUBDIRS: readonly ["html", "css", "images", "fonts", "epub", "smil"];
//# sourceMappingURL=jobPaths.d.ts.map