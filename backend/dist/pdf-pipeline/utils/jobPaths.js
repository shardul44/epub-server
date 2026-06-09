import path from 'path';
export function getJobDirectoryLayout(jobRoot) {
    return {
        root: jobRoot,
        sourcePdf: path.join(jobRoot, 'source.pdf'),
        html: path.join(jobRoot, 'html'),
        css: path.join(jobRoot, 'css'),
        images: path.join(jobRoot, 'images'),
        fonts: path.join(jobRoot, 'fonts'),
        coords: path.join(jobRoot, 'coords.json'),
        epub: path.join(jobRoot, 'epub'),
        smil: path.join(jobRoot, 'smil'),
        outputEpub: path.join(jobRoot, 'output.epub'),
        meta: path.join(jobRoot, 'job_meta.json'),
    };
}
export const JOB_SUBDIRS = ['html', 'css', 'images', 'fonts', 'epub', 'smil'];
//# sourceMappingURL=jobPaths.js.map