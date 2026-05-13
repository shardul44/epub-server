/**
 * queryClient.js — single React Query client for the entire app.
 *
 * staleTime  2 min  – data is fresh; no refetch within this window
 * gcTime    10 min  – unused cache entries are garbage-collected
 *
 * refetchOnWindowFocus / refetchOnReconnect are DISABLED to prevent
 * the request storm that occurs when the user clicks around the app.
 *
 * refetchOnMount: true — ensures a page always gets data on first mount
 *                         but React Query deduplicates concurrent calls.
 *
 * NOTE: useConversionsQuery sets its own staleTime / refetch rules for jobs.
 *
 * PDF list queries are intentionally excluded from localStorage
 * persistence (shouldDehydrateQuery filter below). Persisting the PDF
 * list causes deleted/stale PDFs to reappear on page reload because
 * the rehydrated cache is shown before the fresh server fetch completes.
 */

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            30 * 1000,       // 30 s default (conversions use ~20 s in useConversionsQuery)
      gcTime:               10 * 60 * 1000,  // 10 min
      retry:                1,
      refetchOnWindowFocus: false,
      refetchOnReconnect:   false,
      refetchOnMount:       true,
    },
  },
});

/* ─── localStorage persistence ────────────────────────────────── */
// Clear any existing rq-cache that may contain stale PDF data from
// before this fix was applied. This runs once on app startup.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('rq-cache');
  } catch { /* ignore */ }
}

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
      // Exclude PDF list/detail queries from persistence.
      // PDFs must always be fetched fresh from the server — persisting them
      // causes deleted PDFs to reappear and 404 thumbnail errors on reload.
      shouldDehydrateQuery: (q) => {
        const key = q.queryKey;
        // Exclude anything under the ['pdfs'] namespace
        if (Array.isArray(key) && key[0] === 'pdfs') return false;
        return q.state.status === 'success';
      },
    },
  });
}

export default queryClient;
