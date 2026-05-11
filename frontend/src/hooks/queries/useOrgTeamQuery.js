/**
 * useOrgTeamQuery — single source of truth for org team members.
 *
 * Fetches GET /org/users and caches under queryKeys.orgTeam.members().
 * All consumers share the same cache entry — no duplicate requests.
 *
 * @returns {{ members, isLoading, error, refresh }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

async function fetchOrgMembers() {
  const res = await api.get('/org/users');
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

export function useOrgTeamQuery({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey:             queryKeys.orgTeam.members(),
    queryFn:              fetchOrgMembers,
    enabled,
    staleTime:            3 * 60 * 1000,  // 3 min
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.orgTeam.members() });

  return {
    members:   query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error:     query.error?.message ?? '',
    refresh,
  };
}
