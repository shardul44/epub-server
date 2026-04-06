import api from './api';

export const audioSyncService = {
  getAudioSyncsByPdf: (pdfId) =>
    api.get(`/audio-sync/pdf/${pdfId}`).then(res => res.data.data),

  getAudioSyncsByJob: (jobId) =>
    api.get(`/audio-sync/job/${jobId}`).then(res => res.data.data),

  getAudioSyncs: (pdfId, jobId) =>
    api.get(`/audio-sync/pdf/${pdfId}/job/${jobId}`).then(res => res.data.data),

  createAudioSync: (syncData) =>
    api.post('/audio-sync', syncData).then(res => res.data.data),

  updateAudioSync: (id, syncData) =>
    api.put(`/audio-sync/${id}`, syncData).then(res => res.data.data),

  deleteAudioSync: (id) => api.delete(`/audio-sync/${id}`),

  deleteAudioSyncsByJob: (jobId) => api.delete(`/audio-sync/job/${jobId}`),

  extractTextFromPdf: (pdfId) =>
    api.get(`/audio-sync/pdf/${pdfId}/extract-text`).then(res => res.data.data),

  extractTextFromEpub: (jobId) =>
    api.get(`/audio-sync/job/${jobId}/extract-text`).then(res => res.data.data),

  generateAudio: (pdfId, jobId, voice, textBlocks, granularity = 'sentence', speakingRate) =>
    api.post('/audio-sync/generate', { pdfId, jobId, voice, textBlocks, granularity, speakingRate }).then(res => res.data.data),

  getAvailableVoices: () =>
    api.get('/audio-sync/voices').then(res => res.data.data),

  getAudioUrl: (syncId) =>
    `${api.defaults.baseURL}/audio-sync/${syncId}/audio`,

  saveSyncBlocks: (jobId, syncBlocks, audioFileName, granularity = 'sentence', playbackSpeed = 1.0) =>
    api.post('/audio-sync/save-sync-blocks', { jobId, syncBlocks, audioFileName, granularity, playbackSpeed }).then(res => res.data.data),

  uploadAudioFile: (jobId, audioFile) => {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('jobId', jobId);
    return api.post('/audio-sync/upload-audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },

  // Check if Aeneas forced aligner is available
  checkAeneas: () =>
    api.get('/audio-sync/check-aeneas').then(res => res.data.data),

  // Automated forced alignment (Kitaboo-style)
  autoSync: (jobId, options = {}) =>
    api.post('/audio-sync/auto-sync', {
      jobId,
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      propagateWords: options.propagateWords !== false,
      audioPath: options.audioPath
    }).then(res => res.data.data),

  // Batch auto-sync for multiple pages
  batchAutoSync: (jobId, options = {}) =>
    api.post('/audio-sync/batch-auto-sync', {
      jobId,
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      audioPath: options.audioPath
    }).then(res => res.data.data),

  // Linear spread sync (fallback when Aeneas not available)
  linearSpread: (jobId, startTime, endTime, options = {}) =>
    api.post('/audio-sync/linear-spread', {
      jobId,
      startTime,
      endTime,
      granularity: options.granularity || 'sentence',
      propagateWords: options.propagateWords !== false
    }).then(res => res.data.data),

  // Hybrid Gemini Alignment (Magic Sync)
  magicSync: (jobId, options = {}) =>
    api.post('/audio-sync/magic-align', {
      jobId,
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      audioPath: options.audioPath
    }).then(res => res.data.data),

  // Reflowable Sync Studio (same API shape as FXL Sync Studio)
  getSyncStudio: (jobId) =>
    api.get(`/audio-sync/sync-studio/${jobId}`).then(res => res.data.data ?? res.data),

  getJobAudioUrl: (jobId) =>
    `${api.defaults.baseURL.replace(/\/?$/, '')}/audio-sync/job/${jobId}/audio`,

  alignSyncStudio: (jobId, options = {}) => {
    const body = {
      language: options.language || 'eng',
      granularity: options.granularity || 'sentence',
      propagateWords: options.propagateWords !== false
    };
    if (Array.isArray(options.sectionBoundaries) && options.sectionBoundaries.length > 0) {
      body.sectionBoundaries = options.sectionBoundaries;
    }
    if (options.perSectionAudio) {
      body.perSectionAudio = true;
    }
    // CRITICAL: Include currentSidebarOrder if provided (for Aeneas text reordering)
    if (options.currentSidebarOrder && typeof options.currentSidebarOrder === 'object') {
      body.currentSidebarOrder = options.currentSidebarOrder;
      console.log(`[alignSyncStudio] 📤 Sending currentSidebarOrder to backend:`, body.currentSidebarOrder);
    }
    return api.post(`/audio-sync/sync-studio/${jobId}/align`, body, { timeout: 600000 }).then(res => res.data.data ?? res.data);
  },

  saveSyncStudio: (jobId, segments, readingOrder = null, pageNumber = null, orderKey = null) => {
    const payload = {
      segments,
      ...(Array.isArray(readingOrder) && readingOrder.length > 0 ? { readingOrder, pageNumber, orderKey } : {})
    };
    console.log(`[audioSyncService] 📤 Sending to saveSyncStudio (page ${pageNumber}, orderKey ${orderKey}):`, payload);
    return api.put(`/audio-sync/sync-studio/${jobId}`, payload).then(res => {
      console.log(`[audioSyncService] 📥 Response from saveSyncStudio:`, res.data);
      return res.data.data ?? res.data;
    });
  },

  // Per-section audio: upload an audio file for a specific section index
  uploadSectionAudio: (jobId, sectionIndex, audioFile) => {
    const formData = new FormData();
    formData.append('audio', audioFile);
    formData.append('jobId', jobId);
    formData.append('sectionIndex', sectionIndex);
    return api.post(`/audio-sync/upload-audio/section/${jobId}/${sectionIndex}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }).then(res => res.data.data);
  },

  // Get URL to stream per-section audio
  getSectionAudioUrl: (jobId, sectionIndex) =>
    `${api.defaults.baseURL.replace(/\/?$/, '')}/audio-sync/job/${jobId}/audio/section/${sectionIndex}`,

  // Generate TTS audio for a specific section only
  generateSectionAudio: (pdfId, jobId, sectionIndex, voice, textBlocks, granularity = 'sentence', speakingRate) =>
    api.post('/audio-sync/generate-section', { pdfId, jobId, sectionIndex, voice, textBlocks, granularity, speakingRate }).then(res => res.data.data),

};

