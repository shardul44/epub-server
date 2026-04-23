import api from './api';

export const orgTeamService = {
  createUser: (body) => api.post('/org/users', body).then((r) => r.data.data),
  updateUser: (id, body) => api.put(`/org/users/${id}`, body).then((r) => r.data.data),
  deleteUser: (id) => api.delete(`/org/users/${id}`)
};
