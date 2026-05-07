import api from './api';

export const conversionService = {
  /**
   * Upload EPUB for direct audio sync (reflowable → /sync-studio/:id, FXL → /fxl-sync-studio/:jobId).
   * @param {File} file
   * @param {'reflowable'|'fxl'} mode
   */
  importEpubForSync: (file, mode = 'reflowable') => {
    const formData = new FormData();
    formData.append('epub', file);
    formData.append('mode', mode);
    return api.post('/conversions/import-epub-for-sync', formData).then((res) => res.data.data);
  },

  startConversion: (pdfDocumentId, options = {}) =>
    api.post(`/conversions/start/${pdfDocumentId}`, options).then(res => res.data.data),
  
  startBulkConversion: (pdfIds) => 
    api.post('/conversions/start/bulk', { pdfIds }).then(res => res.data.data),
  
  getConversionJob: async (jobId) => {
    try {
      const res = await api.get(`/conversions/${jobId}`);
      return res.data.data;
    } catch (err) {
      // 404 = job was deleted — return null instead of throwing so callers
      // can handle it gracefully without spamming the console.
      if (err.response?.status === 404) return null;
      throw err;
    }
  },
  
  getConversionsByPdf: (pdfDocumentId) => 
    api.get(`/conversions/pdf/${pdfDocumentId}`).then(res => res.data.data),
  
  /** @param {{ scope?: 'own' }} [params] - scope=own: only conversions for PDFs this user created (dashboard) */
  getConversionsByStatus: (status, params = {}) =>
    api.get(`/conversions/status/${status}`, { params }).then(res => {
      console.log(`Conversion API response for ${status}:`, res.data);
      return res.data.data || [];
    }).catch(error => {
      console.error(`Error fetching conversions by status ${status}:`, error);
      // Return empty array instead of throwing
      return [];
    }),
  
  getReviewRequired: () => 
    api.get('/conversions/review-required').then(res => res.data.data),
  
  markAsReviewed: (jobId, reviewedBy) => 
    api.put(`/conversions/${jobId}/review`, null, { params: { reviewedBy } }).then(res => res.data.data),
  
  stopConversion: (jobId) => 
    api.post(`/conversions/${jobId}/stop`).then(res => res.data.data),
  
  retryConversion: (jobId) => 
    api.post(`/conversions/${jobId}/retry`).then(res => res.data.data),
  
  downloadEpub: async (jobId) => {
    const { API_BASE_URL } = await import('./api');
    const token = localStorage.getItem('token');

    const response = await fetch(`${API_BASE_URL}/conversions/${jobId}/download`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      // Try to extract a readable error message even from non-JSON responses
      let msg = `Download failed (${response.status})`;
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        msg = json.error || json.message || msg;
      } catch { /* ignore parse errors */ }
      throw new Error(msg);
    }

    const blob = await response.blob();

    // Derive filename from Content-Disposition header if present
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=(?:(['"])([^'"]*)\1|([^;\n]*))/i);
    const rawName = match ? (match[2] || match[3] || '').trim() : '';
    const fileName = rawName
      ? decodeURIComponent(rawName)
      : `converted_${jobId}.epub`;

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
  
  deleteConversionJob: (jobId) => api.delete(`/conversions/${jobId}`),
  
  getEpubSections: (jobId) =>
    api.get(`/conversions/${jobId}/epub-sections`).then(res => res.data.data),
  
  getEpubTextContent: (jobId) =>
    api.get(`/conversions/${jobId}/epub-text`).then(res => res.data.data),
  
  getSectionXhtml: (jobId, sectionId) =>
    api.get(`/conversions/${jobId}/epub-section/${sectionId}/xhtml`).then(res => res.data),
  
  getTextBlocks: (jobId) =>
    api.get(`/conversions/${jobId}/text-blocks`).then(res => res.data.data),
  
  // EPUB Image Editor APIs
  getPageXhtml: (jobId, pageNumber) =>
    api.get(`/conversions/${jobId}/xhtml/${pageNumber}`, { responseType: 'text' }).then(res => res.data),
  
  getJobImages: (jobId) =>
    api.get(`/conversions/${jobId}/images`).then(res => res.data.data),
  
  uploadJobImages: (jobId, formData) =>
    api.post(`/conversions/${jobId}/images/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data),
  
  getJobPages: async (jobId) => {
    try {
      const res = await api.get(`/conversions/${jobId}/pages`);
      return res.data.data;
    } catch (err) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  },

  savePageXhtml: (jobId, pageNumber, xhtml) =>
    api.put(`/conversions/${jobId}/xhtml/${pageNumber}`, { xhtml }).then(res => res.data.data),

  regenerateEpub: async (jobId, options = {}) => {
    try {
      const res = await api.post(`/conversions/${jobId}/regenerate`, options);
      return res.data.data;
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  },
  
  regeneratePageXhtml: (jobId, pageNumber) =>
    api.post(`/conversions/${jobId}/regenerate-page/${pageNumber}`).then(res => res.data.data)
};

