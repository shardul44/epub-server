/**
 * Appends the JWT token as a query parameter to URLs used in
 * <img src>, <iframe src>, <audio src> etc. — native browser elements
 * that cannot send an Authorization header.
 *
 * The backend auth middleware already accepts ?token= for GET/HEAD requests.
 *
 * @param {string} url  - Relative or absolute URL (e.g. "/api/pdfs/8/thumbnail")
 * @returns {string}    - URL with ?token=<jwt> appended when a token exists
 */
export function mediaUrl(url) {
  if (!url) return url;
  const token = localStorage.getItem('token');
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
