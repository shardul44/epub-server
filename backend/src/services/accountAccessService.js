import { ROLES } from '../constants/roles.js';
import { OrganizationModel } from '../models/Organization.js';

const STATUS_MESSAGES = {
  suspended: 'Your account has been Deactivated. Contact your administrator.',
  pending_verification: 'Your account is pending verification.',
};

/**
 * Returns a user-facing message when sign-in / API access should be denied, or null if allowed.
 * @param {object|null} userRow - Raw users table row
 * @returns {Promise<string|null>}
 */
export async function getAccountAccessBlockReason(userRow) {
  if (!userRow) return 'User not found';

  const status = userRow.status ?? 'active';
  if (status !== 'active') {
    return STATUS_MESSAGES[status] || 'Your account is not active.';
  }

  if (userRow.role === ROLES.PLATFORM_ADMIN || !userRow.organization_id) {
    return null;
  }

  const org = await OrganizationModel.findById(userRow.organization_id);
  if (!org) {
    return 'Your organization is no longer available.';
  }
  if (!org.active) {
    return 'Your organization has been deactivated. Contact your administrator.';
  }

  return null;
}
