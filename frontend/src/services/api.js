import axios from 'axios';
import { queryClient } from '../lib/queryClient';

// Single source of truth for API origin (axios + <img>/<iframe>/pdf.js direct fetches).
// Prod nginx serves the API under /api; local backend listens without that prefix.
const PRODUCTION_API = 'https://epub.kodeit.digital/api';
const DEVELOPMENT_API = 'http://localhost:8082';

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PRODUCTION_API : DEVELOPMENT_API)
).replace(/\/+$/, '');

/** Normalized base (no trailing slash) — use for manual fetch/img/iframe URLs. */
export function getApiBase() {
  return API_BASE_URL;
}

/**
 * Absolute URL for protected assets (PDF view, thumbnails, etc.).
 * Browser elements cannot send Authorization headers, so JWT is appended as ?token=.
 */
export function apiAssetUrl(path, { hash = '' } = {}) {
  const segment = path.startsWith('/') ? path : `/${path}`;
  let url = `${getApiBase()}${segment}`;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
  if (hash) {
    url += hash.startsWith('#') ? hash : `#${hash}`;
  }
  return url;
}

/** Authenticated PDF inline-view URL for iframes and pdf.js. */
export function pdfViewUrl(pdfId, page = 1) {
  const hash = page > 1 ? `#page=${page}` : '';
  return apiAssetUrl(`/pdfs/${pdfId}/view`, { hash });
}

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

    // Prevent browser HTTP cache from serving stale list data after upload/delete.
    if ((config.method || 'get').toLowerCase() === 'get') {
      config.headers['Cache-Control'] = 'no-cache';
      config.headers.Pragma = 'no-cache';
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
      queryClient.clear();
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






