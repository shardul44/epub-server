/**
 * useMediaAssetsQuery — single source of truth for media assets.
 *
 * Fetches GET /media and caches under queryKeys.media.list().
 * All consumers share the same cache entry — no duplicate requests.
 *
 * @returns {{ assets, isLoading, error, refresh, invalidate }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

async function fetchMediaAssets() {
  const res = await api.get('/media');
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

export function useMediaAssetsQuery({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey:             queryKeys.media.list(),
    queryFn:              fetchMediaAssets,
    enabled,
    staleTime:            5 * 60 * 1000,  // 5 min — media changes infrequently
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.media.list() });

  return {
    assets:    query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error:     query.error?.message ?? '',
    refresh,
  };
}
