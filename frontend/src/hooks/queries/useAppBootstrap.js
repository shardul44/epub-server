/**
 * useAppBootstrap — single hook that fetches ALL shared app data in ONE request.
 *
 * Calls GET /app-bootstrap which returns:
 *   { media, license, activities, users, health }
 *
 * React Query deduplicates this automatically — no matter how many components
 * call this hook simultaneously, only ONE network request is ever made.
 *
 * Cache key : ['app-bootstrap']
 * staleTime : 5 minutes (data is considered fresh for 5 min after fetch)
 *
 * Usage:
 *   const { media, license, activities, users, health, isLoading, error } = useAppBootstrap();
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

async function fetchBootstrap() {
  const res = await api.get('/app-bootstrap');
  return res.data?.data ?? res.data ?? {};
}

export function useAppBootstrap({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey:             queryKeys.appBootstrap(userId),
    enabled:              enabled && userId != null,
    queryFn:              fetchBootstrap,
    staleTime:            5 * 60 * 1000,  // 5 min — data stays fresh
    gcTime:               10 * 60 * 1000, // 10 min — keep in cache after unmount
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       false,
    retry:                2,
  });

  const data = query.data ?? {};

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.appBootstrapPrefix() });

  return {
    // Destructured data slices
    media:      data.media      ?? [],
    license:    data.license    ?? null,
    activities: data.activities ?? [],
    users:      data.users      ?? [],
    health:     data.health     ?? null,

    // Query state
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error?.message ?? null,

    // Manual refresh — invalidates the shared cache, all consumers update
    invalidate,
    refetch: query.refetch,
  };
}
