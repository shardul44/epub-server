import axios from 'axios';

// Switch API base URL manually by commenting/uncommenting.
// Backend routes are mounted at the server root (example: POST /auth/login).
// Using `/api` here will cause 404s in development.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8082';
//const API_BASE_URL = 'https://epub.kodeit.digital/api';

// Optional: environment override (uncomment if you want)
// const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://epub.kodeit.digital/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  // Add timeout and credentials for production
  timeout: 180000, // 3 minute timeout for AI operations
  withCredentials: false// Disable credentials for CORS
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const fullUrl = config.baseURL + config.url;
    console.log('Making API request to:', fullUrl);
    console.log('Environment:', import.meta.env.DEV ? 'Development' : 'Production');

    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // If data is FormData, remove Content-Type header to let axios set it with boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      localStorage.removeItem('token');
      const path = window.location?.pathname || '';
      // Avoid forcing a full page reload if user is already on the auth screen.
      if (path !== '/login' && path !== '/register') {
        window.location.href = '/login';
      }
    } else if (status === 403) {
      const msg = error.response?.data?.error || 'You do not have access to this action or feature.';
      console.warn('Forbidden (403):', msg);
      window.dispatchEvent(new CustomEvent('app-forbidden', { detail: { message: msg } }));
    } else if (status === 404) {
      // 404s are often expected (e.g. deleted jobs, probe-before-publish) — never use console.error here
      console.warn('API resource not found:', error.config?.url);
    } else if (status >= 500) {
      console.error('Server error:', error.response?.status, error.response?.data);
    } else if (!error.response) {
      console.error('Network error - check if backend server is running');
    } else {
      // Other 4xx (400, 409, 422, …)
      console.error('API Error:', error.response?.status, error.response?.data ?? error.message);
    }

    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL };






