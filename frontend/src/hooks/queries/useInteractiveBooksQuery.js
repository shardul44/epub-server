/**
 * useInteractiveBooksQuery — scoped interactive book list.
 * Backend filters by role; cache keys separate member vs org_admin data.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useListScope } from '../../context/ListScopeContext';
import { interactiveService } from '../../services/interactiveService';

/**
 * @param {{ enabled?: boolean, scope?: 'own'|'org' }} [options]
 */
export function useInteractiveBooksQuery({ enabled = true, scope: scopeOverride } = {}) {
  const queryClient = useQueryClient();
  const contextScope = useListScope();
  const scope = scopeOverride ?? contextScope;
  const listKey = queryKeys.interactive.list(scope);

  const query = useQuery({
    queryKey: listKey,
    queryFn: () => interactiveService.listBooks(),
    enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.interactive.all() });

  return {
    books: query.data ?? [],
    scope,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    refresh,
  };
}
