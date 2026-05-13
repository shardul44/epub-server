import express from 'express';
import { UserService } from '../services/userService.js';
import { UserModel } from '../models/User.js';
import { validateUserDTO } from '../utils/validation.js';
import { authenticate } from '../middlewares/auth.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';
import { signToken } from '../utils/authToken.js';
import { EntitlementService } from '../services/entitlementService.js';
import { LicenseService } from '../services/licenseService.js';
import { OrganizationModel } from '../models/Organization.js';
import { PlatformSettingsModel } from '../models/PlatformSettings.js';
import { ROLES } from '../constants/roles.js';
import { LICENSING_MODE } from '../constants/licensingMode.js';

const router = express.Router();

function withLicensing(dto, features) {
  return { ...dto, features, licensingMode: LICENSING_MODE };
}

async function licensePayloadForUser(userRow) {
  if (!userRow || userRow.role === ROLES.PLATFORM_ADMIN || !userRow.organization_id) {
    return null;
  }
  return LicenseService.getOrgLicenseStatus(userRow.organization_id);
}

const registrationAllowed = () => process.env.ALLOW_PUBLIC_REGISTRATION === 'true';

async function resolveDefaultRegistrationOrgId() {
  if (process.env.DEFAULT_REGISTRATION_ORG_ID) {
    const id = parseInt(process.env.DEFAULT_REGISTRATION_ORG_ID, 10);
    if (!Number.isNaN(id)) return id;
  }
  const org = await OrganizationModel.findBySlug('default-org');
  return org ? org.id : null;
}

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    if (!registrationAllowed()) {
      return errorResponse(res, 'Public registration is disabled', 403);
    }

    const validation = validateUserDTO(req.body || {});
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, password, phoneNumber } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (await UserModel.existsByEmail(email)) {
      return badRequestResponse(res, 'Email already exists');
    }

    const organizationId = await resolveDefaultRegistrationOrgId();
    if (!organizationId) {
      return errorResponse(res, 'No default organization configured', 500);
    }

    const created = await UserModel.create({
      name,
      email,
      password,
      phoneNumber,
      role: ROLES.MEMBER,
      organizationId
    });
    const full = await UserModel.findByEmail(email);
    const sessionMin = await PlatformSettingsModel.getSessionTimeoutMinutes();
    const token = signToken(full, { expiresIn: `${sessionMin}m` });
    const dto = UserService.convertToDTO(created);
    const features = await EntitlementService.getFeatureKeysForUser(full);
    const license = await licensePayloadForUser(full);

    return successResponse(res, { token, user: { ...withLicensing(dto, features), license } }, 201);
  } catch (error) {
    return errorResponse(res, error.message || 'Registration failed', 500);
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const password = req.body?.password;
    const email = String(rawEmail || '').trim().toLowerCase();

    if (!email || !password) {
      return badRequestResponse(res, 'Email and password are required');
    }

    const userRow = await UserModel.findByEmail(email);
    if (!userRow) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    const isValid = await UserModel.verifyPassword(password, userRow.password);
    if (!isValid) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    const sessionMin = await PlatformSettingsModel.getSessionTimeoutMinutes();
    const token = signToken(userRow, { expiresIn: `${sessionMin}m` });

    const dto = UserService.convertToDTO(await UserModel.findById(userRow.id));
    const features = await EntitlementService.getFeatureKeysForUser(userRow);
    const license = await licensePayloadForUser(userRow);

    return successResponse(res, { token, user: { ...withLicensing(dto, features), license } });
  } catch (error) {
    return errorResponse(res, error.message || 'Login failed', 500);
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const { id } = req.user || {};
    if (!id) return errorResponse(res, 'Invalid token payload', 401);

    const user = await UserModel.findById(id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const features = await EntitlementService.getFeatureKeysForUser(user);
    const dto = UserService.convertToDTO(user);
    const license = await licensePayloadForUser(user);
    return successResponse(res, { ...withLicensing(dto, features), license });
  } catch (error) {
    return errorResponse(res, error.message || 'Failed to load current user', 500);
  }
});

export default router;
