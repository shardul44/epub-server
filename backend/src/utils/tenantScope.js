import { ROLES } from '../constants/roles.js';

/**
 * SQL fragment for pdf_documents alias `p` scoped to the current user (tenant).
 * @param {{ onlyOwn?: boolean }} [options] - If `onlyOwn` is true, only rows this user created (`p.user_id`),
 *   for any tenant role (use for dashboard). If false/omitted, org_admin sees the whole org; members always see own.
 */
export function pdfDocumentWhereClause(user, options = {}) {
  const onlyOwn = options.onlyOwn === true;
  if (!user) return { sql: '1=0', params: [] };
  if (user.role === ROLES.PLATFORM_ADMIN) return { sql: '1=1', params: [] };
  if (onlyOwn || user.role === ROLES.MEMBER) {
    return { sql: 'p.user_id = ?', params: [user.id] };
  }
  if (user.role === ROLES.ORG_ADMIN) {
    if (user.organizationId == null) return { sql: '1=0', params: [] };
    return { sql: 'p.organization_id = ?', params: [user.organizationId] };
  }
  return { sql: '1=0', params: [] };
}

/**
 * Members are always restricted to own rows; org_admin may request ?scope=own.
 * Ignores malicious ?scope=org from members.
 */
export function resolveListScope(user, queryScope) {
  if (!user) return { onlyOwn: true };
  if (user.role === ROLES.MEMBER) return { onlyOwn: true };
  if (queryScope === 'own') return { onlyOwn: true };
  return { onlyOwn: false };
}

/** Cache / log key segment for list endpoints. */
export function listScopeKey(user, queryScope) {
  const scope = resolveListScope(user, queryScope);
  if (user?.role === ROLES.MEMBER) return 'own';
  return scope.onlyOwn ? 'own' : 'org';
}

export function isMemberRole(user) {
  return user?.role === ROLES.MEMBER;
}

/**
 * SQL fragment for media_assets (no alias).
 * Members: own uploads only. Org admin: org library. Others: own user row.
 */
export function mediaAssetWhereClause(user) {
  if (!user) return { sql: '1=0', params: [] };
  if (user.role === ROLES.MEMBER) {
    return { sql: 'user_id = ?', params: [user.id] };
  }
  if (user.role === ROLES.ORG_ADMIN && user.organizationId != null) {
    return { sql: 'organization_id = ?', params: [user.organizationId] };
  }
  if (user.organizationId != null) {
    return { sql: 'organization_id = ?', params: [user.organizationId] };
  }
  return { sql: 'user_id = ?', params: [user.id] };
}

/**
 * PDF row access: members see own uploads; org_admin sees all PDFs in org; platform_admin has no product data access.
 */
export function canAccessPdfRow(user, pdfRow) {
  if (!user || !pdfRow) return false;
  if (user.role === ROLES.PLATFORM_ADMIN) return true;
  if (user.role === ROLES.MEMBER) {
    return pdfRow.user_id != null && Number(pdfRow.user_id) === Number(user.id);
  }
  if (user.role === ROLES.ORG_ADMIN) {
    return (
      user.organizationId != null &&
      pdfRow.organization_id != null &&
      Number(pdfRow.organization_id) === Number(user.organizationId)
    );
  }
  return false;
}

/**
 * Media library row access (matches list rules).
 */
export function canAccessMediaAsset(user, assetRow) {
  if (!user || !assetRow) return false;
  if (user.role === ROLES.MEMBER) {
    return assetRow.user_id != null && Number(assetRow.user_id) === Number(user.id);
  }
  if (user.role === ROLES.ORG_ADMIN) {
    return (
      user.organizationId != null &&
      assetRow.organization_id != null &&
      Number(assetRow.organization_id) === Number(user.organizationId)
    );
  }
  if (user.role === ROLES.PLATFORM_ADMIN) return true;
  return assetRow.user_id != null && Number(assetRow.user_id) === Number(user.id);
}

/**
 * SQL fragment for interactive_books (alias `b` optional — use unqualified column names).
 * Members: own books only. Org admin: org library.
 */
export function interactiveBookWhereClause(user, alias = '') {
  const p = alias ? `${alias}.` : '';
  if (!user) return { sql: '1=0', params: [] };
  if (user.role === ROLES.MEMBER) {
    return { sql: `${p}created_by_user_id = ?`, params: [user.id] };
  }
  if (user.role === ROLES.ORG_ADMIN && user.organizationId != null) {
    return { sql: `${p}organization_id = ?`, params: [user.organizationId] };
  }
  if (user.organizationId != null) {
    return { sql: `${p}organization_id = ?`, params: [user.organizationId] };
  }
  return { sql: `${p}created_by_user_id = ?`, params: [user.id] };
}

/** Interactive book row access (matches list rules). */
export function canAccessInteractiveBook(user, bookRow) {
  if (!user || !bookRow) return false;
  if (user.role === ROLES.PLATFORM_ADMIN) return false;
  if (user.role === ROLES.MEMBER) {
    return (
      bookRow.created_by_user_id != null &&
      Number(bookRow.created_by_user_id) === Number(user.id)
    );
  }
  if (user.role === ROLES.ORG_ADMIN) {
    return (
      user.organizationId != null &&
      bookRow.organization_id != null &&
      Number(bookRow.organization_id) === Number(user.organizationId)
    );
  }
  return false;
}

/**
 * File-based accessibility job metadata (stored in report dir epubPath.json).
 * @param {{ userId?: number|null, organizationId?: number|null }} meta
 */
export function canAccessAccessibilityJob(user, meta) {
  if (!user || !meta) return false;
  if (user.role === ROLES.PLATFORM_ADMIN) return true;
  const ownerId = meta.userId ?? meta.user_id ?? null;
  const orgId = meta.organizationId ?? meta.organization_id ?? null;
  if (user.role === ROLES.MEMBER) {
    return ownerId != null && Number(ownerId) === Number(user.id);
  }
  if (user.role === ROLES.ORG_ADMIN) {
    if (ownerId != null && Number(ownerId) === Number(user.id)) return true;
    return (
      user.organizationId != null &&
      orgId != null &&
      Number(orgId) === Number(user.organizationId)
    );
  }
  return ownerId != null && Number(ownerId) === Number(user.id);
}
