import api from './api';

const unwrap = (res) => res.data?.data ?? res.data;

/**
 * PDF → Fixed Layout EPUB pipeline (pdf2htmlEX + word/sentence IDs + SMIL).
 */
export const pdfPipelineService = {
  /** Upload PDF — returns { jobId, status, ... } */
  uploadPdf(file) {
    const form = new FormData();
    form.append('pdf', file);
    return api
      .post('/pdf/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      })
      .then(unwrap);
  },

  /** Start async conversion */
  convert({ jobId, title, author, language, splitPages = true }) {
    return api
      .post('/pdf/convert', { jobId, title, author, language, splitPages }, { timeout: 60000 })
      .then(unwrap);
  },

  /** Poll job status */
  getJob(jobId) {
    return api.get(`/jobs/${jobId}`).then(unwrap);
  },

  /** Fetch coords.json (words + sentences) */
  getCoords(jobId) {
    return api.get(`/jobs/${jobId}/coords`).then(unwrap);
  },

  /** Download output.epub as Blob */
  downloadEpub(jobId) {
    return api
      .get(`/jobs/${jobId}/epub`, {
        responseType: 'blob',
        timeout: 300000,
        validateStatus: (s) => s === 200 || s === 400 || s === 404,
      })
      .then((res) => {
        if (res.status !== 200 || !(res.data instanceof Blob)) {
          throw new Error('EPUB is not ready yet. Wait for conversion to complete.');
        }
        const name =
          res.headers['content-disposition']?.match(/filename="?([^";]+)"?/)?.[1] ||
          `fxl_${jobId}.epub`;
        return { blob: res.data, filename: name };
      });
  },
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const PIPELINE_JOB_STORAGE_KEY = 'pdfPipelineActiveJob';
