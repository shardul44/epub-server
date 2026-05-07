/**
 * queryClient.js — single React Query client for the entire app.
 *
 * staleTime  2 min  – data is fresh; no refetch within this window
 * gcTime    10 min  – unused cache entries are garbage-collected
 *
 * refetchOnWindowFocus / refetchOnReconnect are DISABLED to prevent
 * the request storm that occurs when the user clicks around the app.
 *
 * refetchOnMount: true  – ensures a page always gets data on first mount
 *                         but React Query deduplicates concurrent calls.
 */

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            2  * 60 * 1000,  // 2 min
      gcTime:               10 * 60 * 1000,  // 10 min
      retry:                1,
      refetchOnWindowFocus: false,            // ← prevents storm on tab focus
      refetchOnReconnect:   false,            // ← prevents storm on reconnect
      refetchOnMount:       true,             // ← fetch once per mount if stale
    },
  },
});

/* ─── localStorage persistence ────────────────────────────────── */
const persister = createSyncStoragePersister({
  storage:      typeof window !== 'undefined' ? window.localStorage : undefined,
  key:          'rq-cache',
  throttleTime: 1000,
});

if (typeof window !== 'undefined') {
  persistQueryClient({
    queryClient,
    persister,
    maxAge: 10 * 60 * 1000, // discard persisted cache older than 10 min
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => q.state.status === 'success',
    },
  });
}

export default queryClient;
