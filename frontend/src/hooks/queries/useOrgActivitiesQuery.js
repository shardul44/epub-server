/**
 * useOrgActivitiesQuery — fetches org activity log.
 *
 * Fetches GET /activities?limit=100 and caches under ['org-team', 'activities'].
 * Lazy by default — only fetches when enabled=true (e.g. when audit modal opens).
 *
 * @returns {{ activities, isLoading, error }}
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

async function fetchActivities() {
  const res = await api.get('/activities?limit=100');
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

export function useOrgActivitiesQuery({ enabled = false } = {}) {
  const query = useQuery({
    queryKey:             queryKeys.orgTeam.activities(),
    queryFn:              fetchActivities,
    enabled,
    staleTime:            2 * 60 * 1000,  // 2 min
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       false,
  });

  return {
    activities: query.data ?? [],
    isLoading:  query.isLoading,
    error:      query.error?.message ?? '',
  };
}
