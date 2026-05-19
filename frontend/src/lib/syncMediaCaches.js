/**
 * Scoped media list cache helpers (mirrors syncPdfCaches / syncConversionCaches).
 */

import { queryKeys } from './queryKeys';

/** @param {import('@tanstack/react-query').QueryClient} queryClient */
export function mediaListCacheKey(scope) {
  return queryKeys.media.list(scope);
}

/** @param {import('@tanstack/react-query').QueryClient} queryClient */
export function upsertMediaInListCache(queryClient, scope, asset) {
  if (!asset?.id) return;
  queryClient.setQueryData(mediaListCacheKey(scope), (prev = []) => {
    const list = Array.isArray(prev) ? prev : [];
    const idx = list.findIndex((a) => a.id === asset.id);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = { ...next[idx], ...asset };
      return next;
    }
    return [asset, ...list];
  });
}

/** @param {import('@tanstack/react-query').QueryClient} queryClient */
export function removeMediaFromListCache(queryClient, scope, assetId) {
  queryClient.setQueryData(mediaListCacheKey(scope), (prev = []) =>
    Array.isArray(prev) ? prev.filter((a) => a.id !== assetId) : prev
  );
}
