/**
 * ConversionsJobsPoller — the only component that polls /conversions + /kitaboo/jobs.
 *
 * Mount once under ListScopeProvider (see RootLayout). All pages use
 * useConversionsQuery() as read-only subscribers to the shared React Query cache.
 *
 * Uses a manual interval (not useQuery refetchInterval) so child observers cannot
 * override or duplicate polling options on the shared query.
 *
 * Polling stops when no jobs are IN_PROGRESS, PENDING, or PROCESSING.
 *
 * Future: replace the interval with SSE/WebSocket push and queryClient.setQueryData.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppSelector } from '../store/hooks';
import { selectUser } from '../features/auth/authSlice';
import { useListScope } from '../context/ListScopeContext';
import { queryKeys } from '../lib/queryKeys';
import { hasFeature } from '../utils/features';
import {
  fetchAllJobs,
  hasActiveJobs,
  CONVERSIONS_POLL_INTERVAL_MS,
  CONVERSIONS_STALE_TIME_MS,
} from '../hooks/queries/useConversionsQuery';

function shouldRunPoller(user) {
  if (!user) return false;
  if (user.role === 'org_admin' || user.role === 'platform_admin') return true;
  return hasFeature(user, 'conversion.basic') || hasFeature(user, 'kitaboo.import');
}

export default function ConversionsJobsPoller() {
  const user = useAppSelector(selectUser);
  const scope = useListScope();
  const queryClient = useQueryClient();
  const listKey = queryKeys.conversions.list(scope);
  const pollerEnabled = shouldRunPoller(user);

  useQuery({
    queryKey: listKey,
    queryFn: () => fetchAllJobs(scope, { source: 'ConversionsJobsPoller', kind: 'fetch' }),
    enabled: pollerEnabled,
    staleTime: CONVERSIONS_STALE_TIME_MS,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!pollerEnabled) return undefined;

    let cancelled = false;

    const poll = () => {
      if (cancelled) return;
      const jobs = queryClient.getQueryData(listKey);
      if (!hasActiveJobs(jobs)) return;

      void queryClient.fetchQuery({
        queryKey: listKey,
        queryFn: () => fetchAllJobs(scope, { source: 'ConversionsJobsPoller', kind: 'poll' }),
        staleTime: CONVERSIONS_STALE_TIME_MS,
      });
    };

    const id = setInterval(poll, CONVERSIONS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollerEnabled, queryClient, listKey, scope]);

  return null;
}
