import api from './api';

export const adminService = {
  getOrganizations: () => api.get('/admin/organizations').then((r) => r.data.data),
  createOrganization: (body) => api.post('/admin/organizations', body).then((r) => r.data.data),
  getOrganization: (id) => api.get(`/admin/organizations/${id}`).then((r) => r.data.data),
  updateOrganization: (id, body) => api.put(`/admin/organizations/${id}`, body).then((r) => r.data.data),
  deleteOrganization: (id) => api.delete(`/admin/organizations/${id}`),
  setSubscription: (orgId, body) =>
    api.put(`/admin/organizations/${orgId}/subscription`, body).then((r) => r.data.data),
  getOrgUsers: (orgId) => api.get(`/admin/organizations/${orgId}/users`).then((r) => r.data.data),
  createOrgUser: (orgId, body) =>
    api.post(`/admin/organizations/${orgId}/users`, body).then((r) => r.data.data),

  getAllUsers: () => api.get('/admin/users').then((r) => r.data.data),
  createUser: (body) => api.post('/admin/users', body).then((r) => r.data.data),
  updateUser: (id, body) => api.put(`/admin/users/${id}`, body).then((r) => r.data.data),
  updateUserStatus: (id, status) =>
    api.patch(`/admin/users/${id}/status`, { status }).then((r) => r.data.data),

  getPlans: () => api.get('/admin/plans').then((r) => r.data.data),
  getPlan: (id) => api.get(`/admin/plans/${id}`).then((r) => r.data.data),
  createPlan: (body) => api.post('/admin/plans', body).then((r) => r.data.data),
  updatePlan: (id, body) => api.put(`/admin/plans/${id}`, body).then((r) => r.data.data),
  deletePlan: (id) => api.delete(`/admin/plans/${id}`),
  setPlanFeature: (planId, featureKey, body) =>
    api.put(`/admin/plans/${planId}/features/${encodeURIComponent(featureKey)}`, body).then((r) => r.data.data),
  removePlanFeature: (planId, featureKey) =>
    api.delete(`/admin/plans/${planId}/features/${encodeURIComponent(featureKey)}`),

  getFeatures: () => api.get('/admin/features').then((r) => r.data.data),
  createFeature: (body) => api.post('/admin/features', body).then((r) => r.data.data)
};
