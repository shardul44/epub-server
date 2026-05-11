# Org Pages Refactoring Summary

## ✅ Completed

### 1. Redux Slices (UI State)
Created 4 new Redux slices for org page UI state:

- **`features/conversions/conversionsSlice.js`**
  - `focusedJobId`, `viewMode`, `statusFilter`, `actionError`
  - Selectors: `selectFocusedJobId`, `selectViewMode`, `selectStatusFilter`, `selectActionError`

- **`features/mediaLibrary/mediaLibrarySlice.js`**
  - `viewMode`, `activeTab`, `search`, `sort`, `showUpload`, `uploadError`
  - Selectors: `selectMLViewMode`, `selectMLActiveTab`, `selectMLSearch`, `selectMLSort`, `selectMLShowUpload`, `selectMLUploadError`

- **`features/orgTeam/orgTeamSlice.js`**
  - `search`, `roleFilter`, `activeModal`, `editingMemberId`
  - Selectors: `selectOTSearch`, `selectOTRoleFilter`, `selectOTActiveModal`, `selectOTEditingMemberId`

- **`features/usage/usageSlice.js`**
  - `showUpgrade`, `showAddOns`
  - Selectors: `selectShowUpgrade`, `selectShowAddOns`

### 2. React Query Hooks (Server State)
Created 3 new React Query hooks for server data:

- **`hooks/queries/useMediaAssetsQuery.js`**
  - Fetches `GET /media/assets`
  - Cache key: `['media', 'list']`
  - Returns: `{ assets, isLoading, isFetching, error, refresh }`

- **`hooks/queries/useOrgTeamQuery.js`**
  - Fetches `GET /org/users`
  - Cache key: `['org-team', 'members']`
  - Returns: `{ members, isLoading, isFetching, error, refresh }`

- **`hooks/queries/useUsageQuery.js`**
  - Fetches `GET /org/license`
  - Cache key: `['usage', 'license']`
  - Returns: `{ license, isLoading, error, refresh }`

- **`hooks/queries/usePlansQuery.js`** (lazy)
  - Fetches `GET /org/plans` (only when enabled=true)
  - Cache key: `['usage', 'plans']`
  - Returns: `{ plans, isLoading, error }`

### 3. Action Hooks (Mutations)
Created 3 new action hooks for mutation logic:

- **`hooks/useConversionActions.js`**
  - `prepareDelete`, `confirmDelete`, `handleStop`, `handleRetry`, `handleOpenEditor`, `handleFocusNavigate`
  - Uses Redux dispatch + `useConversionsQuery().refresh()`

- **`hooks/useMediaActions.js`**
  - `handleUpload`, `handleDelete`, `handleDownload`
  - Uses Redux dispatch + `useMediaAssetsQuery().refresh()`

- **`hooks/useOrgTeamActions.js`**
  - `handleEditUser`, `handleSaveUser`, `handleChangeRole`, `handleDeleteMember`, `handleResendInvite`, `handleCreateUser`
  - Uses Redux dispatch + `useOrgTeamQuery().refresh()`

### 4. Store Configuration
Updated `store/store.js` to register all new slices:
```javascript
{
  auth,
  dashboard,
  epub,
  pdfs,
  conversions,      // ← new
  mediaLibrary,     // ← new
  orgTeam,          // ← new
  usage,            // ← new
}
```

### 5. Query Keys
Updated `lib/queryKeys.js` with new cache keys:
```javascript
orgTeam: {
  all:        () => ['org-team'],
  members:    () => ['org-team', 'members'],
  activities: () => ['org-team', 'activities'],
},
usage: {
  license: () => ['usage', 'license'],
  plans:   () => ['usage', 'plans'],
},
media: {
  all:  () => ['media'],
  list: () => ['media', 'list'],
},
```

### 6. Page Refactoring
Refactored 3 org pages to use the new architecture:

- **`pages/org/ConversionJobs.jsx`** ✅
  - Uses Redux for `focusedJobId`, `viewMode`, `statusFilter`, `actionError`
  - Uses `useConversionsQuery` for server data
  - Uses `useConversionActions` for mutations
  - All business logic extracted to hooks

- **`pages/org/MediaLibrary.jsx`** ✅
  - Uses Redux for `viewMode`, `activeTab`, `search`, `sort`, `showUpload`, `uploadError`
  - Uses `useMediaAssetsQuery` for server data
  - Uses `useMediaActions` for mutations
  - All business logic extracted to hooks

- **`pages/org/usage.jsx`** ✅
  - Uses Redux for `showUpgrade`, `showAddOns`
  - Uses `useUsageQuery` + `usePlansQuery` for server data
  - Modal state managed by Redux
  - Clean, minimal component

### 7. Documentation
Created comprehensive architecture documentation:

- **`ARCHITECTURE.md`** — Full architecture guide with patterns, examples, and migration checklist
- **`REFACTORING_SUMMARY.md`** — This file

---

## ⚠️ Remaining Work

### Pages to Refactor
The following org pages still need refactoring to match the new architecture:

1. **`pages/org/OrgTeam.jsx`**
   - Currently uses `useAppBootstrap` (bundled fetch)
   - All state is local `useState`
   - Mutation logic is inline
   - **Target:** Use `useOrgTeamQuery`, Redux for UI state, `useOrgTeamActions` for mutations

2. **`pages/org/AudioSyncStudio.jsx`**
   - Currently uses `useConversions` (legacy wrapper)
   - All state is local `useState`
   - **Target:** Use `useConversionsQuery`, Redux for UI state

3. **`pages/org/DownloadEpub.jsx`**
   - Currently uses `useConversions` (legacy wrapper)
   - All state is local `useState`
   - **Target:** Use `useConversionsQuery`, Redux for UI state

4. **`pages/org/ImageFxlEditor.jsx`**
   - Currently uses `useConversionsQuery` ✅ (already correct)
   - All state is local `useState`
   - **Target:** Extract zone editing logic to hooks, consider Redux for UI state

---

## Migration Pattern

For each remaining page, follow this pattern:

### 1. Identify State
- **UI state** (survives navigation) → Redux
- **Server state** (from API) → React Query
- **Ephemeral state** (modals, loading) → Local `useState`

### 2. Create Slice (if needed)
```javascript
// features/<pageName>/<pageName>Slice.js
const initialState = {
  // UI state that survives navigation
};

const slice = createSlice({
  name: '<pageName>',
  initialState,
  reducers: {
    // Actions to update UI state
  },
});

export const { /* actions */ } = slice.actions;
export const select<State> = (s) => s.<pageName>.<state>;
export default slice.reducer;
```

### 3. Create Query Hook (if needed)
```javascript
// hooks/queries/use<PageName>Query.js
export function use<PageName>Query({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey:             queryKeys.<pageName>.list(),
    queryFn:              fetch<PageName>Data,
    enabled,
    staleTime:            5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.<pageName>.list() });

  return {
    data:      query.data ?? [],
    isLoading: query.isLoading,
    error:     query.error?.message ?? '',
    refresh,
  };
}
```

### 4. Create Action Hook (if needed)
```javascript
// hooks/use<PageName>Actions.js
export function use<PageName>Actions() {
  const dispatch = useAppDispatch();
  const { refresh } = use<PageName>Query({ enabled: false });

  const handleCreate = useCallback(async (data) => {
    await api.post('/endpoint', data);
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (id) => {
    await api.delete(`/endpoint/${id}`);
    await refresh();
  }, [refresh]);

  return { handleCreate, handleDelete };
}
```

### 5. Refactor Component
```javascript
const PageComponent = () => {
  const dispatch = useAppDispatch();

  // ── Redux UI state ────────────────────────────────────────────
  const uiState = useAppSelector(selectUIState);

  // ── Local UI state (ephemeral) ────────────────────────────────
  const [modal, setModal] = useState({ open: false });

  // ── React Query (server state) ────────────────────────────────
  const { data, isLoading, error, refresh } = use<PageName>Query();

  // ── Action hook (mutations) ───────────────────────────────────
  const { handleCreate, handleDelete } = use<PageName>Actions();

  // ... render
};
```

---

## Benefits

### Before Refactoring
- ❌ UI state lost on navigation (filters reset, focused items lost)
- ❌ Duplicate API calls (every component fetches independently)
- ❌ Business logic in components (hard to test, hard to reuse)
- ❌ Inconsistent patterns across pages

### After Refactoring
- ✅ UI state survives navigation (filters, view modes, focused items persist)
- ✅ Single shared cache (one API call, all components update)
- ✅ Business logic extracted to hooks (easy to test, easy to reuse)
- ✅ Consistent patterns across all pages
- ✅ Scalable architecture (easy to add new pages)

---

## Testing Checklist

For each refactored page, verify:

- [ ] UI state survives navigation (filters, view modes, focused items)
- [ ] Server data is cached and shared across components
- [ ] Mutations invalidate the cache correctly
- [ ] No duplicate API calls (check Network tab)
- [ ] No console errors or warnings
- [ ] Redux DevTools shows correct state updates
- [ ] React Query DevTools shows correct cache entries

---

## Next Steps

1. **Refactor `OrgTeam.jsx`**
   - Replace `useAppBootstrap` with `useOrgTeamQuery`
   - Move search, roleFilter, activeModal to Redux
   - Extract mutation logic to `useOrgTeamActions`

2. **Refactor `AudioSyncStudio.jsx`**
   - Replace `useConversions` with `useConversionsQuery`
   - Consider Redux for UI state (if needed)

3. **Refactor `DownloadEpub.jsx`**
   - Replace `useConversions` with `useConversionsQuery`
   - Consider Redux for UI state (if needed)

4. **Refactor `ImageFxlEditor.jsx`**
   - Extract zone editing logic to hooks
   - Consider Redux for UI state (if needed)

5. **Update Tests**
   - Add tests for new Redux slices
   - Add tests for new React Query hooks
   - Add tests for new action hooks

---

## Resources

- **Redux Toolkit:** https://redux-toolkit.js.org/
- **React Query:** https://tanstack.com/query/latest
- **Architecture Guide:** `frontend/ARCHITECTURE.md`
- **Existing Patterns:** See `ConversionJobs.jsx`, `MediaLibrary.jsx`, `usage.jsx`

---

## Questions?

Refer to `ARCHITECTURE.md` for detailed patterns and examples.
