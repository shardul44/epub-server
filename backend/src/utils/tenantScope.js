import { ROLES } from '../constants/roles.js';

/**
 * SQL fragment for pdf_documents alias `p` scoped to the current user (tenant).
 * @param {{ onlyOwn?: boolean }} [options] - If `onlyOwn` is true, only rows this user created (`p.user_id`),
 *   for any tenant role (use for dashboard). If false/omitted, org_admin sees the whole org; members always see own.
 */
export function pdfDocumentWhereClause(user, options = {}) {
  const onlyOwn = options.onlyOwn === true;
  if (!user) return { sql: '1=0', params: [] };
  if (user.role === ROLES.PLATFORM_ADMIN) return { sql: '1=0', params: [] };
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
 * PDF row access: members see own uploads; org_admin sees all PDFs in org; platform_admin has no product data access.
 */
export function canAccessPdfRow(user, pdfRow) {
  if (!user || !pdfRow) return false;
  if (user.role === ROLES.PLATFORM_ADMIN) return false;
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
