import api from './api';

/**
 * Kitaboo FXL and Classic FXL (layout-only) API helpers.
 */
export const kitabooService = {
  /** Start standard FXL conversion (AI zoning). POST /kitaboo/process/:pdfId */
  startFxlConversion: (pdfId) =>
    api.post(`/kitaboo/process/${pdfId}`, {}, { timeout: 15000 }).then(res => res.data?.data ?? res.data),

  /** Start layout-only (classic PDF→FXL) conversion — no AI zoning, PDF text coordinates only. */
  startLayoutOnly: (pdfId) =>
    api.post('/kitaboo/process-layout-only', { pdfId }, { timeout: 15000 }).then(res => res.data?.data ?? res.data),

  /** Start High-Fidelity FXL conversion (3-phase pipeline). Glyph extraction runs by default; zoneLevel controls Studio zones.
   * @param {number} pdfId
   * @param {{ zoneLevel?: 'word'|'sentence', tocEndPage?: number }} [options] - word/sentence; tocEndPage = last TOC page (1-based) for rectangle zones when auto-detect fails
   */
  startHighFidelity: (pdfId, options = {}) =>
    api.post('/kitaboo/process-high-fidelity', {
      pdfId,
      zoneLevel: options.zoneLevel || 'word',
      ...(options.tocEndPage != null && options.tocEndPage > 0 ? { tocEndPage: options.tocEndPage } : {})
    }, { timeout: 15000 }).then(res => res.data?.data ?? res.data),

  /** Get job status and pages. GET /kitaboo/job/:jobId */
  getJob: (jobId) =>
    api.get(`/kitaboo/job/${jobId}`).then(res => res.data?.data ?? res.data),

  /** Publish FXL EPUB (zone-based). */
  publishFxl: (jobId, options = {}) =>
    api.post(`/kitaboo/publish/${jobId}`, { ...options }).then(res => res.data?.data ?? res.data),

  /** Publish Classic FXL EPUB (layout fragments, CSS coordinate classes). */
  publishClassic: (jobId) =>
    api.post(`/kitaboo/publish/${jobId}`, { classicLayout: true }).then(res => res.data?.data ?? res.data),

  /** Download FXL EPUB file (blob) and trigger browser download. */
  downloadFxlEpub: async (jobId, filename = null) => {
    const baseUrl = api.defaults.baseURL ?? '';
    const pathOnly = `/kitaboo/download/${jobId}`;
    const url = pathOnly.startsWith('http') ? pathOnly : `${baseUrl.replace(/\/$/, '')}${pathOnly.startsWith('/') ? '' : '/'}${pathOnly}`;
    const res = await api.get(url, { responseType: 'blob' });
    if (res.status < 200 || res.status >= 300) throw new Error(res.status === 404 ? 'EPUB not found' : `Download failed (${res.status})`);
    const name = filename || res.headers['content-disposition']?.match(/filename="?([^";]+)"?/)?.[1] || `kitaboo_fxl_${jobId}.epub`;
    const blob = res.data;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return name;
  }
};
