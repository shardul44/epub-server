# Caching Implementation

This document describes the caching architecture added to the React + Node.js project.

---

## Backend Caching

### In-Memory Cache (`node-cache`)

**Location:** `backend/src/services/cacheService.js`

**TTL Strategy:**
- **SHORT (2 min)** — frequently mutated data (job lists, active conversions)
- **MEDIUM (5 min)** — semi-stable data (PDF lists, org stats)
- **LONG (10 min)** — rarely mutated data (user lists, health checks)

**Cached Endpoints:**
| Endpoint | TTL | Cache Key Pattern |
|---|---|---|
| `GET /pdfs` | MEDIUM | `pdfs:list:{orgId}:{userId}:{scope}` |
| `GET /pdfs/grouped` | MEDIUM | `pdfs:grouped:{orgId}` |
| `GET /conversions` | SHORT | `conversions:all:{orgId}:{userId}:{scope}` |
| `GET /conversions/status/:status` | SHORT/MEDIUM | `conversions:status:{status}:{orgId}:{userId}:{scope}` |
| `GET /kitaboo/jobs` | SHORT | `kitaboo:jobs:{orgId}` |

**Cache Invalidation:**
- **PDF mutations** (upload, delete) → invalidate all `pdfs:*` keys
- **Conversion mutations** (start, stop, retry, delete) → invalidate all `conversions:*` keys
- **Kitaboo mutations** (process, delete) → invalidate all `kitaboo:jobs:*` keys

**API:**
```js
import { cacheWrap, cacheDel, cacheDelByPrefix, TTL } from '../services/cacheService.js';

// Cache-aside pattern
const data = await cacheWrap('my-key', () => fetchFromDb(), TTL.MEDIUM);

// Invalidate specific key
cacheDel('my-key');

// Invalidate all keys with prefix
cacheDelByPrefix('pdfs:');
```

---

### HTTP Caching Headers

**Location:** `backend/src/middlewares/httpCache.js`

**Features:**
- `Cache-Control` headers with `max-age` and `stale-while-revalidate`
- ETag generation (MD5 hash of response body)
- Conditional GET support (304 Not Modified)

**Usage:**
```js
import { httpCache, noCache } from '../middlewares/httpCache.js';

// Cache for 5 minutes
router.get('/pdfs', httpCache(TTL.MEDIUM), handler);

// Explicitly disable caching
router.get('/jobs/:id', noCache, handler);
```

**Headers Set:**
```
Cache-Control: private, max-age=300, stale-while-revalidate=60
ETag: "a1b2c3d4..."
Vary: Authorization
```

---

## Frontend Caching

### React Query (`@tanstack/react-query`)

**Location:** `frontend/src/lib/queryClient.js`

**Configuration:**
- **staleTime: 5 min** — data is considered fresh; no background refetch within this window
- **gcTime: 10 min** — unused cache entries are garbage-collected after this period
- **Persistence:** full cache is serialised to `localStorage` under key `rq-cache`

**Query Hooks:**
| Hook | Replaces | Features |
|---|---|---|
| `usePdfsQuery` | Redux `fetchPdfs` thunk | 5 min stale time, localStorage persistence |
| `useConversionsQuery` | Redux `fetchConversionJobs` + `useJobPolling` | Smart polling (5s while active jobs exist), 2 min stale time |
| `useDashboardQuery` | Redux `loadOrgDashboardData` | 5 min stale time, background refresh |

**Query Keys:**
```js
// frontend/src/lib/queryKeys.js
queryKeys.pdfs.list('org')                    // ['pdfs', 'list', 'org']
queryKeys.conversions.byStatus('COMPLETED')   // ['conversions', 'status', 'COMPLETED', 'org']
queryKeys.kitaboo.jobs()                      // ['kitaboo', 'jobs']
```

**Invalidation:**
```js
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';

const queryClient = useQueryClient();

// Invalidate all PDF queries
queryClient.invalidateQueries({ queryKey: queryKeys.pdfs.all() });

// Invalidate specific status
queryClient.invalidateQueries({ queryKey: queryKeys.conversions.byStatus('COMPLETED') });
```

---

## Migration Guide

### Pages Updated

1. **OrgDashboard.jsx** — now uses `useDashboardQuery()` instead of Redux
2. **ConversionJobs.jsx** — now uses `useConversionsQuery()` instead of `useJobPolling()`
3. **Exports.jsx** — now uses `useConversionsQuery()` instead of manual `useEffect` fetch

### Backward Compatibility

The existing `usePdfs()` hook was updated to use React Query internally while preserving the same API surface, so all existing consumers work unchanged.

---

## Performance Improvements

### Before
- **Every page refresh** → full data refetch from server
- **No deduplication** → multiple components fetching the same data
- **Manual polling** → scattered `setInterval` calls, no smart stop logic

### After
- **Page refresh** → instant load from localStorage cache (if < 10 min old)
- **Automatic deduplication** → React Query merges identical requests
- **Smart polling** → stops automatically when all jobs reach terminal state
- **Background refetch** → stale data is refreshed in the background without blocking UI
- **HTTP caching** → browser can reuse responses with 304 Not Modified

---

## Cache Monitoring

### Backend
Check cache stats via the health endpoint:
```bash
curl http://localhost:8082/health
```

Response includes:
```json
{
  "status": "OK",
  "cache": {
    "keys": 12,
    "hits": 45,
    "misses": 8,
    "ksize": 12,
    "vsize": 12
  }
}
```

### Frontend
React Query DevTools (optional):
```bash
npm install @tanstack/react-query-devtools --save-dev
```

Then add to `App.jsx`:
```jsx
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen={false} />
</QueryClientProvider>
```

---

## Testing

### Backend Cache
```bash
# First request (cache miss)
curl -i http://localhost:8082/pdfs

# Second request (cache hit, ETag match → 304)
curl -i -H "If-None-Match: \"abc123...\"" http://localhost:8082/pdfs
```

### Frontend Cache
1. Load the dashboard
2. Refresh the page → data loads instantly from localStorage
3. Wait 5 minutes → background refetch updates stale data
4. Open DevTools → Application → Local Storage → `rq-cache`

---

## Configuration

### Adjust TTLs

**Backend:**
```js
// backend/src/services/cacheService.js
export const TTL = {
  SHORT:  120,   // 2 min
  MEDIUM: 300,   // 5 min
  LONG:   600,   // 10 min
};
```

**Frontend:**
```js
// frontend/src/lib/queryClient.js
staleTime: 5 * 60 * 1000,  // 5 min
gcTime:    10 * 60 * 1000, // 10 min
```

### Disable Persistence

```js
// frontend/src/lib/queryClient.js
// Comment out the persistQueryClient() call
```

---

## Troubleshooting

### Cache not invalidating
- Check that mutations call `cacheDelByPrefix()` on the backend
- Check that mutations call `queryClient.invalidateQueries()` on the frontend

### Stale data after mutation
- Ensure the cache key pattern matches between read and invalidate
- Check browser console for React Query errors

### localStorage quota exceeded
- React Query only persists successful queries
- Increase `maxAge` to reduce persisted data size
- Clear localStorage: `localStorage.removeItem('rq-cache')`

---

## Future Enhancements

- [ ] Add Redis for distributed caching (multi-server deployments)
- [ ] Add cache warming on server startup
- [ ] Add cache metrics dashboard
- [ ] Add optimistic updates for mutations
- [ ] Add prefetching for predictable navigation patterns
