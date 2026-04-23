import jwt from 'jsonwebtoken';

/**
 * Issues a JWT with identity claims only. Plan features are resolved on each request
 * via EntitlementService (see authenticate middleware).
 */
export function signToken(userRow) {
  const payload = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    organizationId: userRow.organization_id ?? null
  };
  const secret = process.env.JWT_SECRET || 'your-secret-key';
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}
