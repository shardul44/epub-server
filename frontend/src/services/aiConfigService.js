import api from './api';

/** Backend uses { success, data, timestamp }; tolerate plain payloads */
function unwrapSuccess(res) {
  const body = res?.data;
  if (body == null) return null;
  if (typeof body === 'object' && 'data' in body && body.data !== undefined) {
    return body.data;
  }
  return body;
}

export const aiConfigService = {
  /** No row yet → backend returns 200 with data: null (legacy servers may still 404). */
  getCurrentConfig: async () => {
    try {
      const res = await api.get('/ai/config/current');
      return unwrapSuccess(res);
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 403) return null;
      throw err;
    }
  },

  /** Platform AI model name for display (members + admins; no API key). */
  getActiveModel: async () => {
    try {
      const res = await api.get('/ai/config/active-model');
      return unwrapSuccess(res);
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 403) return null;
      throw err;
    }
  },

  saveConfig: (config) => api.post('/ai/config', config).then((res) => unwrapSuccess(res)),

  getStatus: () => api.get('/ai/status').then((res) => unwrapSuccess(res)),

  getAvailableModels: () =>
    api
      .get('/ai/models')
      .then((res) => {
        const data = unwrapSuccess(res);
        return Array.isArray(data) ? data : [];
      })
      .catch(() => []),

  testConnection: (apiKey, modelName) =>
    api.post('/ai/test', { apiKey, modelName }).then((res) => unwrapSuccess(res)),
};
