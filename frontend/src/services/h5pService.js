import api, { getApiBase } from './api';

/** Public H5P base URL (ajax, core, editor static files) — must match page origin in dev (Vite proxy). */
export function getH5pBaseUrl() {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return `${window.location.origin.replace(/\/$/, '')}/api/h5p`;
  }
  return `${getApiBase()}/h5p`;
}

export const h5pService = {
  async listLibraries() {
    const res = await api.get('/h5p/libraries');
    return res.data?.data?.libraries ?? [];
  },

  async listContentTypes() {
    const res = await api.get('/h5p/content-types');
    return res.data?.data ?? { categories: [] };
  },

  async getSetupStatus() {
    const res = await api.get('/h5p/setup-status');
    return res.data?.data;
  },

  async createContent(payload) {
    const res = await api.post('/h5p/content', payload);
    return res.data?.data;
  },

  async getContent(id) {
    const res = await api.get(`/h5p/content/${id}`);
    return res.data?.data;
  },

  async updateContent(id, payload) {
    const res = await api.put(`/h5p/content/${id}`, payload);
    return res.data?.data;
  },

  async deleteContent(id) {
    const res = await api.delete(`/h5p/content/${id}`);
    return res.data?.data;
  },

  async getEditorModel(contentId, { machineName, language = 'en' } = {}) {
    const res = await api.get(`/h5p/editor/${contentId}/model`, {
      params: { machineName, language }
    });
    return res.data?.data;
  },

  async getPlayerModel(contentId, { language = 'en' } = {}) {
    const res = await api.get(`/h5p/player/${contentId}/model`, {
      params: { language }
    });
    return res.data?.data;
  }
};
