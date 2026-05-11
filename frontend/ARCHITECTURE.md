# Frontend Architecture — Org Pages

## Overview

All org pages (`/pages/org/*`) follow a **scalable production-level architecture** with clear separation of concerns:

- **Redux** — UI state that survives navigation (filters, view modes, modal state)
- **React Query** — Server state (jobs, media, members, license)
- **Custom hooks** — Reusable logic (mutations, actions, derived state)
- **Components** — Pure presentation (no business logic)

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      PAGE COMPONENT                          │
│  - Reads Redux UI state (useAppSelector)                    │
│  - Dispatches Redux actions (useAppDispatch)                │
│  - Calls React Query hooks for server data                  │
│  - Calls action hooks for mutations                         │
│  - Renders UI (no business logic)                           │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│    REDUX     │    │   REACT QUERY    │    │ ACTION HOOKS │
│  (UI State)  │    │ (Server State)   │    │  (Mutations) │
├──────────────┤    ├──────────────────┤    ├──────────────┤
│ • viewMode   │    │ • jobs           │    │ • handleDelete│
│ • statusFilter│   │ • assets         │    │ • handleUpload│
│ • search     │    │ • members        │    │ • handleRetry │
│ • activeTab  │    │ • license        │    │ • handleEdit  │
│ • focusedJobId│   │ (cached, shared) │    │ (+ dispatch)  │
└──────────────┘    └──────────────────┘    └──────────────┘
```

---

## File Structure

```
frontend/src/
├── features/                    # Redux slices (UI state only)
│   ├── conversions/
│   │   └── conversionsSlice.js  # focusedJobId, viewMode, statusFilter, actionError
│   ├── mediaLibrary/
│   │   └── mediaLibrarySlice.js # viewMode, activeTab, search, sort, showUpload
│   ├── orgTeam/
│   │   └── orgTeamSlice.js      # search, roleFilter, activeModal, editingMemberId
│   └── usage/
│       └── usageSlice.js        # showUpgrade, showAddOns
│
├── hooks/
│   ├── queries/                 # React Query hooks (server state)
│   │   ├── useConversionsQuery.js  # THE single source for all job data
│   │   ├── useMediaAssetsQuery.js  # GET /media/assets
│   │   ├── useOrgTeamQuery.js      # GET /org/users
│   │   └── useUsageQuery.js        # GET /org/license + /org/plans
│   │
│   ├── useConversionActions.js  # delete / stop / retry / openEditor
│   ├── useMediaActions.js       # upload / delete / download
│   ├── useOrgTeamActions.js     # create / edit / delete / changeRole
│   ├── useAppDispatch.js        # Typed Redux dispatch
│   └── useAppSelector.js        # Typed Redux selector
│
├── pages/org/
│   ├── ConversionJobs.jsx       # ✅ Refactored — uses Redux + hooks
│   ├── MediaLibrary.jsx         # ✅ Refactored — uses Redux + hooks
│   ├── OrgTeam.jsx              # ⚠️  Needs refactoring (see below)
│   ├── usage.jsx                # ✅ Refactored — uses Redux + hooks
│   ├── AudioSyncStudio.jsx      # ⚠️  Needs refactoring
│   ├── DownloadEpub.jsx         # ⚠️  Needs refactoring
│   └── ImageFxlEditor.jsx       # ⚠️  Needs refactoring
│
└── store/
    └── store.js                 # Redux store (all slices registered)
```

---

## Redux Slices (UI State)

### `conversionsSlice.js`
```javascript
{
  focusedJobId:  null,      // ID of job shown in FocusedJobBanner
  viewMode:      'card',    // 'card' | 'list'
  statusFilter:  'all',     // dropdown value
  actionError:   '',        // last mutation error
}
```

### `mediaLibrarySlice.js`
```javascript
{
  viewMode:    'grid',      // 'grid' | 'list'
  activeTab:   'All',       // 'All' | 'Images' | 'Videos' | 'Audio' | 'GIFs'
  search:      '',          // search string
  sort:        'newest',    // sort key
  showUpload:  false,       // upload panel expanded
  uploadError: '',          // last upload error
}
```

### `orgTeamSlice.js`
```javascript
{
  search:          '',      // member search string
  roleFilter:      'all',   // 'all' | 'org_admin' | 'editor' | 'member' | 'viewer'
  activeModal:     null,    // null | 'editUser' | 'bulkInvite' | 'auditLog' | 'sso' | 'permissions'
  editingMemberId: null,    // ID of member being edited
}
```

### `usageSlice.js`
```javascript
{
  showUpgrade: false,       // Upgrade Plan modal open
  showAddOns:  false,       // Buy Add-Ons modal open
}
```

---

## React Query Hooks (Server State)

### `useConversionsQuery({ statusFilter, enabled })`
**THE single source of truth for all job/conversion data.**

- **Cache key:** `['conversions', 'list']` — always the same
- **Fetches:** `GET /conversions` (reflow) + `GET /kitaboo/jobs` (FXL)
- **Merges:** Deduplicates by `jobType-jobId` composite key
- **Polls:** Every 5s while active jobs exist; stops when all terminal
- **Returns:** `{ jobs, allJobs, isLoading, isFetching, error, refresh }`

**Usage:**
```javascript
const { jobs, isLoading, refresh } = useConversionsQuery({ statusFilter: 'COMPLETED' });
```

### `useMediaAssetsQuery({ enabled })`
- **Cache key:** `['media', 'list']`
- **Fetches:** `GET /media/assets`
- **Returns:** `{ assets, isLoading, error, refresh }`

### `useOrgTeamQuery({ enabled })`
- **Cache key:** `['org-team', 'members']`
- **Fetches:** `GET /org/users`
- **Returns:** `{ members, isLoading, error, refresh }`

### `useUsageQuery({ enabled })`
- **Cache key:** `['usage', 'license']`
- **Fetches:** `GET /org/license`
- **Returns:** `{ license, isLoading, error, refresh }`

### `usePlansQuery({ enabled })`
- **Cache key:** `['usage', 'plans']`
- **Fetches:** `GET /org/plans` (lazy — only when enabled=true)
- **Returns:** `{ plans, isLoading, error }`

---

## Action Hooks (Mutations)

### `useConversionActions()`
Encapsulates all conversion job mutations.

**Returns:**
```javascript
{
  prepareDelete,       // (job) => void — stores job in ref
  confirmDelete,       // async () => void — deletes job, clears focusedJobId
  handleStop,          // async (jobId) => void
  handleRetry,         // async (jobId) => void
  handleOpenEditor,    // (job) => void — navigates to editor
  handleFocusNavigate, // (path, job) => void — navigates from banner
  MAX_RETRIES,         // 3
}
```

**Uses:**
- Redux dispatch for `setActionError`, `clearActionError`, `setFocusedJobId`
- `useConversionsQuery().refresh()` to invalidate cache after mutations
- `useNavigate` for routing

### `useMediaActions()`
Encapsulates all media asset mutations.

**Returns:**
```javascript
{
  handleUpload,   // async (files) => void
  handleDelete,   // async (asset) => void
  handleDownload, // (asset) => void
}
```

**Uses:**
- Redux dispatch for `setUploadError`, `clearUploadError`, `setShowUpload`
- `useMediaAssetsQuery().refresh()` to invalidate cache
- `useQueryClient` for optimistic delete

### `useOrgTeamActions({ onSuccess, onError })`
Encapsulates all org team member mutations.

**Returns:**
```javascript
{
  handleEditUser,      // (member) => void — opens edit modal
  handleSaveUser,      // async (memberId, body) => void
  handleChangeRole,    // async (member, newRole) => void
  handleDeleteMember,  // async (member) => void
  handleResendInvite,  // async (member) => void
  handleCreateUser,    // async (userData) => void
}
```

**Uses:**
- Redux dispatch for `openEditModal`, `closeModal`
- `useOrgTeamQuery().refresh()` to invalidate cache
- `orgTeamService` for all API calls

---

## Page Component Pattern

### ✅ Refactored Example: `ConversionJobs.jsx`

```javascript
const ConversionJobs = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  // ── Redux UI state ────────────────────────────────────────────
  const focusedJobId   = useAppSelector(selectFocusedJobId);
  const viewMode       = useAppSelector(selectViewMode);
  const statusFilter   = useAppSelector(selectStatusFilter);
  const actionError    = useAppSelector(selectActionError);

  // ── Local UI state (ephemeral — not worth persisting) ─────────
  const [deleteModal, setDeleteModal] = useState({ open: false, job: null, loading: false });

  // ── React Query (server state) ────────────────────────────────
  const { jobs, isLoading, error: pollError, refresh } = useConversionsQuery({ statusFilter });

  // ── Action hook (delete / stop / retry / navigate) ────────────
  const {
    prepareDelete,
    confirmDelete: runConfirmDelete,
    handleStop,
    handleRetry,
    handleOpenEditor,
    handleFocusNavigate,
  } = useConversionActions();

  // Derive the focused job object from the Redux-stored ID
  const focusedJob = focusedJobId
    ? jobs.find(j => String(j.id ?? j.jobId) === String(focusedJobId)) ?? null
    : null;

  /* auto-focus first completed job (only if nothing is focused yet) */
  useEffect(() => {
    if (focusedJobId) return;
    const first = jobs.find(j => j.status === 'COMPLETED');
    if (first) dispatch(setFocusedJobId(String(first.id ?? first.jobId)));
  }, [jobs, focusedJobId, dispatch]);

  /* ── Delete flow ── */
  const handleDelete = useCallback((job) => {
    prepareDelete(job);
    setDeleteModal({ open: true, job, loading: false });
  }, [prepareDelete]);

  const confirmDelete = useCallback(async () => {
    setDeleteModal(prev => ({ ...prev, loading: true }));
    await runConfirmDelete();
    dispatch(setFocusedJobId(null));
    setDeleteModal({ open: false, job: null, loading: false });
  }, [runConfirmDelete, dispatch]);

  // ... render
};
```

**Key points:**
- ✅ Redux for UI state (focusedJobId, viewMode, statusFilter, actionError)
- ✅ React Query for server state (jobs)
- ✅ Action hook for mutations (delete, stop, retry, navigate)
- ✅ Local state only for ephemeral UI (deleteModal)
- ✅ No business logic in the component — all extracted to hooks

---

## Navigation & Routing

All org pages are wrapped in `<BrowserRouter>` at the root (`main.jsx`), so routing context is global.

**Navigation pattern:**
```javascript
// Defer navigation to avoid "Cannot update a component while rendering" errors
setTimeout(() => navigate(path), 0);
```

**Route state:**
```javascript
navigate(path, { state: { jobId: job.id } });
```

---

## Best Practices

### ✅ DO
- Store UI state that survives navigation in Redux (filters, view modes, focused items)
- Store server state in React Query (jobs, assets, members, license)
- Extract mutation logic into action hooks
- Use `useAppDispatch` and `useAppSelector` everywhere (not raw `useDispatch` / `useSelector`)
- Keep components pure — no business logic, only rendering
- Use `useCallback` for stable callbacks passed to child components
- Defer navigation with `setTimeout(() => navigate(...), 0)` to avoid render-cycle errors

### ❌ DON'T
- Store server data in Redux (use React Query instead)
- Store ephemeral UI state in Redux (modals, loading flags — use local `useState`)
- Duplicate API calls (always use the shared React Query hook)
- Put business logic in components (extract to hooks)
- Use raw `useDispatch` / `useSelector` (use typed wrappers)

---

## Migration Checklist

To refactor a page to this architecture:

1. **Create Redux slice** (if UI state needs to survive navigation)
   - `features/<pageName>/<pageName>Slice.js`
   - Register in `store/store.js`

2. **Create React Query hook** (if page fetches server data)
   - `hooks/queries/use<PageName>Query.js`
   - Add cache key to `lib/queryKeys.js`

3. **Create action hook** (if page has mutations)
   - `hooks/use<PageName>Actions.js`
   - Extract all mutation logic (create, update, delete)
   - Use Redux dispatch for UI state updates
   - Use React Query `refresh()` to invalidate cache

4. **Refactor page component**
   - Replace `useState` for UI state with `useAppSelector` + `useAppDispatch`
   - Replace manual API calls with React Query hooks
   - Replace inline mutation logic with action hook calls
   - Keep only ephemeral UI state in local `useState` (modals, loading flags)

5. **Test**
   - Verify UI state survives navigation (filters, view modes)
   - Verify server data is cached and shared across components
   - Verify mutations invalidate the cache correctly
   - Verify no duplicate API calls (check Network tab)

---

## Example: Refactoring `OrgTeam.jsx`

**Current state:**
- ❌ Uses `useAppBootstrap` (bundled fetch — not ideal for team-specific data)
- ❌ All state is local `useState` (doesn't survive navigation)
- ❌ Mutation logic is inline (hard to test, hard to reuse)

**Target state:**
- ✅ Use `useOrgTeamQuery` (dedicated fetch for team members)
- ✅ Use Redux for search, roleFilter, activeModal, editingMemberId
- ✅ Use `useOrgTeamActions` for all mutations (create, edit, delete, changeRole)
- ✅ Component only renders — no business logic

**Steps:**
1. ✅ Create `orgTeamSlice.js` (done)
2. ✅ Create `useOrgTeamQuery.js` (done)
3. ✅ Create `useOrgTeamActions.js` (done)
4. ⚠️  Refactor `OrgTeam.jsx` (in progress — see below)

**Refactoring pattern:**
```javascript
// BEFORE
const [search, setSearch] = useState('');
const [roleFilter, setRoleFilter] = useState('all');
const [editTarget, setEditTarget] = useState(null);

// AFTER
const dispatch = useAppDispatch();
const search      = useAppSelector(selectOTSearch);
const roleFilter  = useAppSelector(selectOTRoleFilter);
const activeModal = useAppSelector(selectOTActiveModal);

// Update UI state
dispatch(setSearch('new value'));
dispatch(setRoleFilter('org_admin'));
dispatch(openEditModal(memberId));
```

---

## Summary

This architecture provides:

- **Scalability** — Clear separation of concerns, easy to add new pages
- **Performance** — Shared React Query cache, no duplicate requests
- **Maintainability** — Business logic extracted to hooks, components are pure
- **Testability** — Hooks can be tested in isolation
- **Developer Experience** — Typed Redux hooks, clear patterns, consistent structure

All org pages should follow this pattern for consistency and maintainability.
