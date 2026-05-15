/**
 * useUsageQuery — fetches org license / usage data.
 *
 * Fetches GET /org/license (org_admin + member in an org) and caches under queryKeys.usage.license().
 * Separate query for plans (lazy — only fetched when upgrade modal opens).
 *
 * @returns {{ license, isLoading, error, refresh }}
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import api from '../../services/api';

async function fetchLicense() {
  const res = await api.get('/org/license');
  return res.data?.data ?? res.data ?? null;
}

async function fetchPlans() {
  const res = await api.get('/org/plans');
  const data = res.data?.data ?? res.data ?? [];
  return Array.isArray(data) ? data : [];
}

/**
 * Hook for license / usage data.
 */
export function useUsageQuery({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey:             queryKeys.usage.license(),
    queryFn:              fetchLicense,
    enabled,
    staleTime:            5 * 60 * 1000,  // 5 min
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.license() });

  return {
    license:   query.data ?? null,
    isLoading: query.isLoading,
    error:     query.error?.message ?? '',
    refresh,
  };
}

/**
 * Hook for available plans — lazy, only fetches when enabled=true.
 * Pass enabled={showUpgradeModal} to avoid fetching until needed.
 */
export function usePlansQuery({ enabled = false } = {}) {
  const query = useQuery({
    queryKey:             queryKeys.usage.plans(),
    queryFn:              fetchPlans,
    enabled,
    staleTime:            10 * 60 * 1000, // 10 min — plans rarely change
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       false,
  });

  return {
    plans:     query.data ?? [],
    isLoading: query.isLoading,
    error:     query.error?.message ?? '',
  };
}
