/**
 * cacheService.js
 * Centralised in-memory cache using node-cache.
 *
 * TTLs (seconds):
 *   SHORT  – 2 min  – frequently mutated data (job lists, status)
 *   MEDIUM – 5 min  – semi-stable data (PDF list, org stats)
 *   LONG   – 10 min – rarely mutated data (user list, health)
 */

import NodeCache from 'node-cache';

// stdTTL = default TTL in seconds; checkperiod = how often expired keys are deleted
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

export const TTL = {
  SHORT:  120,   // 2 min
  MEDIUM: 300,   // 5 min
  LONG:   600,   // 10 min
};

/**
 * Get a value from cache.
 * @param {string} key
 * @returns {any|undefined}
 */
export function cacheGet(key) {
  return cache.get(key);
}

/**
 * Set a value in cache.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttl] - seconds; defaults to MEDIUM (5 min)
 */
export function cacheSet(key, value, ttl = TTL.MEDIUM) {
  cache.set(key, value, ttl);
}

/**
 * Delete one or more keys.
 * @param {string|string[]} keys
 */
export function cacheDel(keys) {
  const arr = Array.isArray(keys) ? keys : [keys];
  cache.del(arr);
}

/**
 * Delete all keys that start with a given prefix.
 * @param {string} prefix
 */
export function cacheDelByPrefix(prefix) {
  const keys = cache.keys().filter(k => k.startsWith(prefix));
  if (keys.length) cache.del(keys);
}

/**
 * Wrap an async function with cache-aside logic.
 * If the key is cached, returns the cached value.
 * Otherwise calls fn(), stores the result, and returns it.
 *
 * @param {string}   key
 * @param {Function} fn   - async function that returns the value to cache
 * @param {number}   [ttl]
 * @returns {Promise<any>}
 */
export async function cacheWrap(key, fn, ttl = TTL.MEDIUM) {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const value = await fn();
  cache.set(key, value, ttl);
  return value;
}

/**
 * Return cache statistics (useful for debugging / health endpoint).
 */
export function cacheStats() {
  return cache.getStats();
}

export default cache;
