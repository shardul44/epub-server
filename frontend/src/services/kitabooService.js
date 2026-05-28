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

  /**
   * Fetch FXL EPUB as a Blob (e.g. Sync Studio reader). If the file is missing, runs publish then retries.
   * Uses validateStatus on GET so a missing file does not trip the global axios 404 handler.
   * @param {string} jobId
   * @param {(msg: string) => void} [onStatus]
   * @returns {Promise<{ blob: Blob, suggestedFilename: string }>}
   */
  fetchFxlEpubBlob: async (jobId, onStatus = null, options = {}) => {
    const getBlob = () =>
      api.get(`/kitaboo/download/${jobId}`, {
        responseType: 'blob',
        validateStatus: (s) => s === 200 || s === 404,
      });

    const skipAutoPublish = options.skipAutoPublish === true;
    const forcePublish = options.forcePublish === true;
    if (forcePublish && !skipAutoPublish) {
      if (onStatus) onStatus('Publishing EPUB…');
      await api.post(`/kitaboo/publish/${jobId}`, {}, { timeout: 300000 });
      if (onStatus) onStatus('Loading EPUB…');
    }
    let downloadRes = await getBlob();
    if (downloadRes.status === 404 && !skipAutoPublish) {
      if (onStatus) onStatus('Publishing EPUB…');
      await api.post(`/kitaboo/publish/${jobId}`, {}, { timeout: 300000 });
      if (onStatus) onStatus('Loading EPUB…');
      downloadRes = await getBlob();
    }
    if (downloadRes.status !== 200 || !(downloadRes.data instanceof Blob)) {
      let detail = 'EPUB file is not available.';
      try {
        const t = await downloadRes.data?.text?.();
        if (t && t.trim().startsWith('{')) {
          const j = JSON.parse(t);
          if (j.error || j.message) detail = j.error || j.message;
        }
      } catch (_) { /* ignore */ }
      throw new Error(
        downloadRes.status === 404
          ? skipAutoPublish
            ? `${detail} For imported EPUBs, add narration in FXL Sync Studio, then export from Zoning Studio.`
            : `${detail} Run Export FXL EPUB 3 (Publish) from Zoning Studio, or ensure kitaboo_${jobId} output still exists on the server.`
          : detail,
      );
    }
    const suggestedFilename =
      downloadRes.headers['content-disposition']?.match(/filename="?([^";]+)"?/)?.[1] || `fxl_${jobId}.epub`;
    return { blob: downloadRes.data, suggestedFilename };
  },

  /** Download FXL EPUB file (blob) and trigger browser download.
   * If the EPUB hasn't been published yet, publishes it first then downloads.
   */
  downloadFxlEpub: async (jobId, filename = null, onStatus = null, options = {}) => {
    const { blob, suggestedFilename } = await kitabooService.fetchFxlEpubBlob(jobId, onStatus, options);
    const name = filename || suggestedFilename;
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
