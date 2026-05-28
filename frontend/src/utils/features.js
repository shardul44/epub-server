/** Plan feature keys from `/auth/login` and `/auth/me` (`user.features`). */
const FEATURE_ALIASES = {
  'conversion.basic': ['reflowable.pdf_to_epub'],
  'kitaboo.import': ['hifi_fxl.pdf_to_epub'],
  'sync_studio': [
    'reflowable.audio_sync',
    'hifi_fxl.audio_sync',
    'reflowable_epub.audio_sync',
    'hifi_fxl_epub.audio_sync',
  ],
  accessibility_tools: ['accessibility'],
  epub_tools: ['epub_checker'],
  'interactive.content': ['interactive_books'],
  'reflowable.pdf_to_epub': ['conversion.basic'],
  'hifi_fxl.pdf_to_epub': ['kitaboo.import'],
  'reflowable.audio_sync': ['sync_studio'],
  'hifi_fxl.audio_sync': ['sync_studio'],
  'reflowable_epub.audio_sync': ['sync_studio'],
  'hifi_fxl_epub.audio_sync': ['sync_studio'],
  accessibility: ['accessibility_tools'],
  epub_checker: ['epub_tools'],
  interactive_books: ['interactive.content'],
};

function featureCandidates(key) {
  const aliases = FEATURE_ALIASES[key] || [];
  return [key, ...aliases];
}

export function hasFeature(user, key) {
  const f = user?.features || [];
  if (f.includes('*')) return true;
  return featureCandidates(key).some((k) => f.includes(k));
}

export function hasAnyFeature(user, keys) {
  if (!user || !keys?.length) return false;
  const f = user.features || [];
  if (f.includes('*')) return true;
  return keys.some((k) => featureCandidates(k).some((candidate) => f.includes(candidate)));
}

/** Features that unlock library routes (exports, media). */
export const WORKFLOW_LIBRARY_FEATURES = [
  'conversion.basic',
  'kitaboo.import',
  'sync_studio',
  'interactive.content',
];
