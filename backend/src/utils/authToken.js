import jwt from 'jsonwebtoken';

/**
 * Issues a JWT with identity claims only. Plan features are resolved on each request
 * via EntitlementService (see authenticate middleware).
 */
/**
 * @param {object} userRow
 * @param {{ expiresIn?: string | number }} [options] - jwt `expiresIn` (e.g. '60m', '7d', or seconds as number)
 */
export function signToken(userRow, options = {}) {
  const payload = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    organizationId: userRow.organization_id ?? null
  };
  const secret = process.env.JWT_SECRET || 'your-secret-key';
  const expiresIn = options.expiresIn ?? process.env.JWT_EXPIRES_IN ?? '7d';
  return jwt.sign(payload, secret, { expiresIn });
}
