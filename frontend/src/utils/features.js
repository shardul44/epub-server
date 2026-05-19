/** Plan feature keys from `/auth/login` and `/auth/me` (`user.features`). */
export function hasFeature(user, key) {
  const f = user?.features || [];
  return f.includes('*') || f.includes(key);
}

export function hasAnyFeature(user, keys) {
  if (!user || !keys?.length) return false;
  const f = user.features || [];
  if (f.includes('*')) return true;
  return keys.some((k) => f.includes(k));
}

/** Features that unlock library routes (exports, media). */
export const WORKFLOW_LIBRARY_FEATURES = [
  'conversion.basic',
  'kitaboo.import',
  'sync_studio',
  'interactive.content',
];
