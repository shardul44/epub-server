import api from './api';

export const interactiveService = {
  async listBooks() {
    const res = await api.get('/interactive/books');
    return res.data?.data ?? [];
  },

  async createBook(payload) {
    const res = await api.post('/interactive/books', payload);
    return res.data?.data;
  },

  async getBook(bookId) {
    const res = await api.get(`/interactive/books/${bookId}`);
    return res.data?.data;
  },

  async updateBook(bookId, payload) {
    const res = await api.put(`/interactive/books/${bookId}`, payload);
    return res.data?.data;
  },

  async deleteBook(bookId) {
    await api.delete(`/interactive/books/${bookId}`);
  },

  async listChapters(bookId) {
    const res = await api.get(`/interactive/books/${bookId}/chapters`);
    return res.data?.data ?? [];
  },

  async createChapter(bookId, payload) {
    const res = await api.post(`/interactive/books/${bookId}/chapters`, payload);
    return res.data?.data;
  },

  async updateChapter(chapterId, payload) {
    const res = await api.put(`/interactive/chapters/${chapterId}`, payload);
    return res.data?.data;
  },

  async reorderChapters(bookId, chapterIds) {
    const res = await api.post(`/interactive/books/${bookId}/chapters/reorder`, { chapterIds });
    return res.data?.data ?? [];
  },

  async deleteChapter(chapterId) {
    await api.delete(`/interactive/chapters/${chapterId}`);
  },

  async listBlocks(chapterId) {
    const res = await api.get(`/interactive/chapters/${chapterId}/blocks`);
    return res.data?.data ?? [];
  },

  async createBlock(chapterId, payload) {
    const res = await api.post(`/interactive/chapters/${chapterId}/blocks`, payload);
    return res.data?.data;
  },

  async updateBlock(blockId, payload) {
    const res = await api.put(`/interactive/blocks/${blockId}`, payload);
    return res.data?.data;
  },

  async reorderBlocks(chapterId, blockIds) {
    const res = await api.post(`/interactive/chapters/${chapterId}/blocks/reorder`, { blockIds });
    return res.data?.data ?? [];
  },

  async deleteBlock(blockId) {
    await api.delete(`/interactive/blocks/${blockId}`);
  },

  async exportEpub(bookId, options = {}) {
    const interactiveEpub = options.interactiveEpub !== false;
    const res = await api.request({
      url: `/interactive/books/${bookId}/export/epub`,
      method: 'post',
      data: { interactiveEpub },
      responseType: 'blob'
    });
    return res.data;
  }
};

