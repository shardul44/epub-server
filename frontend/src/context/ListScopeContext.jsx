import { createContext, useContext, useMemo } from 'react';
import { getListScopeForUser } from '../utils/listScope';

const ListScopeContext = createContext(/** @type {import('../utils/listScope').ListScope} */ ('org'));

export function ListScopeProvider({ user, children }) {
  const scope = useMemo(() => getListScopeForUser(user), [user?.role, user?.id]);

  return <ListScopeContext.Provider value={scope}>{children}</ListScopeContext.Provider>;
}

export function useListScope() {
  return useContext(ListScopeContext);
}
