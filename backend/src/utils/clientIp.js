/**
 * Normalize client IP for storage and display.
 * ::1 is IPv6 loopback (same machine as 127.0.0.1).
 */
export function normalizeClientIp(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (s === '::1') return '127.0.0.1';
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  return s;
}

export function getClientIpFromRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return normalizeClientIp(first);
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) return normalizeClientIp(realIp);
  const raw = req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || null;
  return normalizeClientIp(raw);
}
