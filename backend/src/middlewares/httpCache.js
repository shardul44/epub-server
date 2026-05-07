/**
 * httpCache.js
 * Express middleware helpers for HTTP caching headers.
 *
 * Usage:
 *   router.get('/pdfs', httpCache(TTL.MEDIUM), handler)
 *   router.get('/jobs', noCache, handler)
 */

import crypto from 'crypto';

/**
 * Generate a simple ETag from a JSON-serialisable value.
 * @param {any} data
 * @returns {string}
 */
export function generateETag(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return `"${crypto.createHash('md5').update(str).digest('hex')}"`;
}

/**
 * Middleware: set Cache-Control + ETag on the response.
 * Supports conditional GET (If-None-Match → 304).
 *
 * @param {number} maxAgeSeconds - browser max-age (also used as s-maxage)
 * @returns {import('express').RequestHandler}
 */
export function httpCache(maxAgeSeconds = 300) {
  return (req, res, next) => {
    // Only cache GET / HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Intercept res.json so we can inject ETag + Cache-Control
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.headersSent) return originalJson(body);

      const etag = generateETag(body);
      res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=60`);
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Authorization');

      // Conditional GET support
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware: explicitly disable caching (for mutable / real-time endpoints).
 */
export function noCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}
