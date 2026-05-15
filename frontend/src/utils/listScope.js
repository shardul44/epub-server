/**
 * List scope for PDF / conversion queries.
 * Members always use `own`; org_admin uses org-wide lists (no scope query param).
 *
 * @typedef {'own'|'org'} ListScope
 */

/** @param {{ role?: string } | null | undefined} user */
export function getListScopeForUser(user) {
  if (!user) return 'own';
  if (user.role === 'org_admin' || user.role === 'platform_admin') return 'org';
  return 'own';
}

/** @param {ListScope} scope */
export function listScopeQueryParams(scope) {
  return scope === 'own' ? { scope: 'own' } : {};
}

/** @param {{ role?: string } | null | undefined} user */
export function isOrgScopedList(user) {
  return getListScopeForUser(user) === 'org';
}
