/**
 * useActivityQuery — scoped activity list (member: own events; org_admin: org-wide).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useListScope } from '../../context/ListScopeContext';
import api from '../../services/api';

async function fetchActivities(limit = 200) {
  const res = await api.get('/activities', { params: { limit } });
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

/**
 * @param {{ enabled?: boolean, limit?: number, scope?: 'own'|'org' }} [options]
 */
export function useActivityQuery({ enabled = true, limit = 200, scope: scopeOverride } = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const listKey = queryKeys.activities.list(scope);

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => fetchActivities(limit),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.activities.all() });

  return {
    activities: query.data ?? [],
    scope,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refresh,
  };
}
