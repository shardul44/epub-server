import api from './api';

export const planRequestService = {
  submitUpgrade: (planId, memberNote) =>
    api
      .post('/org/plan-requests', {
        requestType: 'upgrade',
        planId: Number(planId),
        ...(memberNote ? { memberNote: String(memberNote) } : {}),
      })
      .then((r) => r.data?.data ?? r.data),

  submitAddon: (addonKey, memberNote) =>
    api
      .post('/org/plan-requests', {
        requestType: 'addon',
        addonKey: String(addonKey),
        ...(memberNote ? { memberNote: String(memberNote) } : {}),
      })
      .then((r) => r.data?.data ?? r.data),

  listMine: () => api.get('/org/plan-requests').then((r) => r.data?.data ?? r.data),

  adminList: (params = {}) =>
    api.get('/admin/plan-requests', { params }).then((r) => r.data.data),

  adminPendingCount: () =>
    api.get('/admin/plan-requests/pending-count').then((r) => r.data.data?.count ?? 0),

  approve: (id, adminNote) =>
    api.post(`/admin/plan-requests/${id}/approve`, { adminNote }).then((r) => r.data.data),

  reject: (id, adminNote) =>
    api.post(`/admin/plan-requests/${id}/reject`, { adminNote }).then((r) => r.data.data),
};
