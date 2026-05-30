import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, Briefcase, Package, Loader2 } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { queryKeys } from '../../lib/queryKeys';
import './AdminGlobalSearch.css';

const MIN_QUERY = 1;
const MAX_PER_GROUP = 5;

function norm(s) {
  return String(s ?? '').toLowerCase().trim();
}

function matchesQuery(q, ...fields) {
  if (!q) return true;
  const hay = fields.map(norm).filter(Boolean).join(' ');
  return hay.includes(q);
}

function useDebounced(value, ms = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function AdminGlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQ = useDebounced(query.trim().toLowerCase(), 180);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const shouldFetch = open && debouncedQ.length >= MIN_QUERY;

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => adminService.getAllUsers(),
    enabled: shouldFetch,
    staleTime: 60 * 1000,
  });

  const orgsQuery = useQuery({
    queryKey: ['admin', 'organizations', 'global-search'],
    queryFn: () => adminService.getOrganizations(),
    enabled: shouldFetch,
    staleTime: 60 * 1000,
  });

  const plansQuery = useQuery({
    queryKey: ['admin', 'plans', 'global-search'],
    queryFn: () => adminService.getPlans(),
    enabled: shouldFetch,
    staleTime: 60 * 1000,
  });

  const isLoading =
    shouldFetch &&
    (usersQuery.isLoading || orgsQuery.isLoading || plansQuery.isLoading);

  const results = useMemo(() => {
    const q = debouncedQ;
    if (!q) return { users: [], orgs: [], plans: [] };

    const users = (Array.isArray(usersQuery.data) ? usersQuery.data : []).filter((u) =>
      matchesQuery(q, u.name, u.email, u.role, u.status),
    );
    const orgs = (Array.isArray(orgsQuery.data) ? orgsQuery.data : []).filter((o) =>
      matchesQuery(q, o.name, o.slug, o.planName, o.id),
    );
    const plans = (Array.isArray(plansQuery.data) ? plansQuery.data : []).filter((p) =>
      matchesQuery(q, p.name, p.slug, p.description, p.id),
    );

    return {
      users: users.slice(0, MAX_PER_GROUP),
      orgs: orgs.slice(0, MAX_PER_GROUP),
      plans: plans.slice(0, MAX_PER_GROUP),
    };
  }, [debouncedQ, usersQuery.data, orgsQuery.data, plansQuery.data]);

  const totalCount = results.users.length + results.orgs.length + results.plans.length;
  const showPanel = open && query.trim().length >= MIN_QUERY;

  const close = useCallback(() => setOpen(false), []);

  const pickResult = useCallback(() => {
    setQuery('');
    close();
  }, [close]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        close();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        inputRef.current?.blur();
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className="ags-wrap" ref={wrapRef}>
      <label className="pah-search ags-search" htmlFor="pah-global-search">
        <span className="pah-search-icon" aria-hidden>
          <Search size={18} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          id="pah-global-search"
          className="pah-search-input"
          type="search"
          placeholder="Search users, orgs, plans…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="pah-search-results"
          aria-autocomplete="list"
        />
      </label>

      {showPanel && (
        <div
          id="pah-search-results"
          className="ags-panel"
          role="listbox"
          aria-label="Search results"
        >
          {isLoading ? (
            <p className="ags-status">
              <Loader2 size={16} className="ags-spin" aria-hidden />
              Searching…
            </p>
          ) : totalCount === 0 ? (
            <p className="ags-status ags-status--empty">
              No results for &ldquo;<strong>{query.trim()}</strong>&rdquo;
            </p>
          ) : (
            <>
              {results.orgs.length > 0 && (
                <section className="ags-group">
                  <h3 className="ags-group-title">
                    <Briefcase size={14} aria-hidden />
                    Organizations
                  </h3>
                  <ul className="ags-list">
                    {results.orgs.map((o) => (
                      <li key={o.id}>
                        <Link
                          to="/admin/organizations"
                          className="ags-item"
                          role="option"
                          onClick={pickResult}
                        >
                          <span className="ags-item-title">{o.name || `Org #${o.id}`}</span>
                          <span className="ags-item-meta">
                            {o.slug ? `${o.slug} · ` : ''}
                            {o.planName || 'No plan'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {results.users.length > 0 && (
                <section className="ags-group">
                  <h3 className="ags-group-title">
                    <Users size={14} aria-hidden />
                    Users
                  </h3>
                  <ul className="ags-list">
                    {results.users.map((u) => (
                      <li key={u.id}>
                        <Link
                          to="/admin/users"
                          className="ags-item"
                          role="option"
                          onClick={pickResult}
                        >
                          <span className="ags-item-title">{u.name || u.email}</span>
                          <span className="ags-item-meta">
                            {u.email}
                            {u.role ? ` · ${u.role.replace(/_/g, ' ')}` : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {results.plans.length > 0 && (
                <section className="ags-group">
                  <h3 className="ags-group-title">
                    <Package size={14} aria-hidden />
                    Plans
                  </h3>
                  <ul className="ags-list">
                    {results.plans.map((p) => (
                      <li key={p.id}>
                        <Link
                          to="/admin/plans"
                          className="ags-item"
                          role="option"
                          onClick={pickResult}
                        >
                          <span className="ags-item-title">{p.name}</span>
                          {p.description && (
                            <span className="ags-item-meta">{p.description}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
