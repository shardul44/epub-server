import api from './api';

export const pdfService = {
  /** @param {{ scope?: 'own' }} [params] - scope=own: only PDFs uploaded by the current user (dashboard) */
  getAllPdfs: (params = {}) => api.get('/pdfs', { params }).then(res => {
    console.log('PDF API response:', res.data);
    return res.data.data || [];
  }).catch(error => {
    console.error('Error fetching PDFs:', error);
    // Return empty array instead of throwing
    return [];
  }),
  
  getPdfById: (id) => api.get(`/pdfs/${id}`).then(res => res.data.data),
  
  getPdfsGroupedByZip: () => api.get('/pdfs/grouped').then(res => res.data.data),
  
  uploadPdf: (file, layoutType = 'REFLOWABLE') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('layoutType', layoutType);
    // Do NOT set Content-Type manually — axios must set it with the multipart
    // boundary automatically. The api.js interceptor already deletes the
    // default Content-Type header when it detects FormData.
    return api.post('/pdfs/upload', formData).then(res => res.data.data);
  },
  
  uploadBulkPdfs: (files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    return api.post('/pdfs/upload/bulk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },
  
  downloadPdf: (id) => {
    return api.get(`/pdfs/${id}/download`, { responseType: 'blob' }).then(res => {
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `document_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  },
  
  deletePdf: async (id) => {
    try {
      const response = await api.delete(`/pdfs/${id}`);
      return response;
    } catch (error) {
      // 404 means the PDF was already deleted — treat as success so the
      // frontend can remove the stale entry from the list.
      if (error.response?.status === 404) {
        console.warn(`PDF ${id} not found (already deleted). Treating as success.`);
        return { status: 204, data: null };
      }
      console.error('Error deleting PDF:', error);
      // Extract the most descriptive message from the backend response
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.response?.data ||
        error.message ||
        'Failed to delete PDF';
      // Throw a plain Error so callers can read .message without needing .response
      throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    }
  }
};

