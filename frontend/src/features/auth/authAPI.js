/**
 * authAPI — raw API calls for authentication.
 * Kept separate from the slice so the slice stays pure Redux logic.
 */
import api from '../../services/api';

/**
 * POST /auth/login
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<{ token: string, user: object }>}
 */
export const loginRequest = ({ email, password }) =>
  api.post('/auth/login', { email, password }).then((res) => res.data);

/**
 * GET /auth/me — fetch the currently authenticated user.
 * @returns {Promise<object>}
 */
export const fetchMeRequest = () =>
  api.get('/auth/me').then((res) => res.data?.data ?? res.data);
