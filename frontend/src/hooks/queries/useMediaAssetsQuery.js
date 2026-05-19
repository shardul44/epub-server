/**
 * useMediaAssetsQuery — single source of truth for media assets.
 *
 * Scope from useListScope(): members see own uploads; org_admin sees org library.
 * Cache key: ['media', 'list', scope]
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useListScope } from '../../context/ListScopeContext';
import api from '../../services/api';

async function fetchMediaAssets() {
  const res = await api.get('/media');
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

/**
 * @param {{ enabled?: boolean, scope?: 'own'|'org' }} [options]
 */
export function useMediaAssetsQuery({ enabled = true, scope: scopeOverride } = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const listKey = queryKeys.media.list(scope);

  const query = useQuery({
    queryKey: listKey,
    queryFn: fetchMediaAssets,
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.media.all() });

  return {
    assets: query.data ?? [],
    scope,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? '',
    refresh,
  };
}
