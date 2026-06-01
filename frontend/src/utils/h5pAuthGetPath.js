/**
 * H5P builds media URLs as prefix + '/' + relativePath (content or temp-files).
 * JWT must appear in the query string before any #hash (e.g. #tmp).
 */
export function appendH5pAuthTokenToUrl(url, token) {
  if (!url || !token || url.includes('token=')) return url;
  const hashIdx = url.indexOf('#');
  const base = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : url.slice(hashIdx);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}${hash}`;
}

export function syncH5pAuthToken(token) {
  if (!token) return;
  window.__H5P_AUTH_TOKEN = token;
  if (window.H5PIntegration) {
    window.H5PIntegration.authToken = token;
  }
}

export function forceH5pAuthGetPathPatch(token) {
  if (typeof window === 'undefined') return;
  const jwt = token || localStorage.getItem('token');
  if (!jwt) return;

  syncH5pAuthToken(jwt);

  const patchGetPath = (h5pRoot) => {
    if (!h5pRoot?.getPath) return;
    if (!h5pRoot.__authGetPathOriginal) {
      h5pRoot.__authGetPathOriginal = h5pRoot.getPath.bind(h5pRoot);
    }
    const original = h5pRoot.__authGetPathOriginal;
    h5pRoot.getPath = (path, contentId) => {
      const url = original(path, contentId);
      return appendH5pAuthTokenToUrl(url, jwt);
    };
    h5pRoot.__authGetPathPatched = true;
  };

  patchGetPath(window.H5P);
}

/** Set cookie so <img src> to /api/h5p/temp-files/* can authenticate without ?token= */
export function setH5pAuthCookie(token) {
  if (typeof document === 'undefined' || !token) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `h5p_jwt=${encodeURIComponent(token)}; path=/api/h5p; SameSite=Lax${secure}`;
}

export function clearH5pAuthCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = 'h5p_jwt=; path=/api/h5p; max-age=0';
}

export function installH5pAuthGetPathPatch() {
  if (typeof window === 'undefined') return undefined;

  const token = localStorage.getItem('token');
  if (!token) return undefined;

  forceH5pAuthGetPathPatch(token);

  let currentH5p = window.H5P;
  try {
    Object.defineProperty(window, 'H5P', {
      configurable: true,
      get() {
        return currentH5p;
      },
      set(value) {
        currentH5p = value;
        forceH5pAuthGetPathPatch(token);
      }
    });
  } catch {
    // interval fallback below
  }

  let attempts = 0;
  const intervalId = window.setInterval(() => {
    forceH5pAuthGetPathPatch(token);
    if (++attempts > 400) window.clearInterval(intervalId);
  }, 50);

  return () => window.clearInterval(intervalId);
}
