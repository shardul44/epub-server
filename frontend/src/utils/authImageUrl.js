/**
 * Appends JWT as ?token= so native <img src> can load protected image URLs
 * (browsers do not send Authorization headers for img requests).
 * Pair with GET handler that accepts this query param (see authenticate middleware).
 */
export function withAuthImageQuery(url) {
  if (typeof window === 'undefined' || !url) return url;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (/[?&]token=/.test(url)) return url;
  const token = localStorage.getItem('token');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
