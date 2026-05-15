import express from 'express';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';
import { UserModel } from '../models/User.js';
import { UserService } from '../services/userService.js';
import { validateUserDTO, validateUserUpdateDTO } from '../utils/validation.js';
import {
  successResponse,
  errorResponse,
  badRequestResponse,
  notFoundResponse,
  forbiddenResponse
} from '../utils/responseHandler.js';
import { LicenseService } from '../services/licenseService.js';

const router = express.Router();

router.use(authenticate);

function requireOrgAssigned(req, res, next) {
  if (!req.user.organizationId) {
    return forbiddenResponse(res, 'No organization assigned');
  }
  next();
}

// GET /org/license — org members and admins may read their org's subscription / usage.
// (Team management routes below remain org_admin only.)
router.get(
  '/license',
  requireRole(ROLES.ORG_ADMIN, ROLES.MEMBER),
  requireOrgAssigned,
  async (req, res) => {
    try {
      const status = await LicenseService.getOrgLicenseStatus(req.user.organizationId);
      return successResponse(res, status);
    } catch (error) {
      return errorResponse(res, error.message, 500);
    }
  }
);

router.use(requireRole(ROLES.ORG_ADMIN));
router.use(requireOrgAssigned);

// GET /org/plans — list all available plans (for upgrade modal)
router.get('/plans', async (_req, res) => {
  try {
    const { PlanModel } = await import('../models/Plan.js');
    const rows = await PlanModel.findAll();
    const plans = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      seatLimit: row.seat_limit != null ? Number(row.seat_limit) : null,
      monthlyPageLimit: row.monthly_page_limit != null ? Number(row.monthly_page_limit) : null,
    }));
    return successResponse(res, plans);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /org/users — list all members in the same org
router.get('/users', async (req, res) => {
  try {
    const members = await UserModel.findByOrganizationId(req.user.organizationId);
    return successResponse(res, members);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// POST /org/users — create member (or org_admin) in same org
router.post('/users', async (req, res) => {
  try {
    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, password, phoneNumber, role = ROLES.MEMBER } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await UserService.createOrgMember(req.user.organizationId, {
      name,
      email,
      password,
      phoneNumber,
      role
    });
    return successResponse(res, user, 201);
  } catch (error) {
    if (error.code === 'SEAT_LIMIT') {
      return forbiddenResponse(res, error.message);
    }
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    if (error.message.includes('Invalid role')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// PUT /org/users/:id
router.put('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await UserModel.findById(id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (target.organization_id !== req.user.organizationId) {
      return forbiddenResponse(res, 'Forbidden');
    }
    if (target.role === ROLES.PLATFORM_ADMIN) {
      return forbiddenResponse(res, 'Cannot modify this user');
    }

    const body = { ...req.body };
    delete body.role;
    delete body.organizationId;

    const validation = validateUserUpdateDTO(body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const user = await UserService.updateUser(id, body);
    return successResponse(res, user);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// PUT /org/users/:id/role — change a member's role
router.put('/users/:id/role', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await UserModel.findById(id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (target.organization_id !== req.user.organizationId) {
      return forbiddenResponse(res, 'Forbidden');
    }
    if (target.id === req.user.id) {
      return badRequestResponse(res, 'Cannot change your own role');
    }
    if (target.role === ROLES.PLATFORM_ADMIN) {
      return forbiddenResponse(res, 'Cannot modify this user');
    }

    const { role } = req.body || {};
    const allowed = [ROLES.ORG_ADMIN, ROLES.MEMBER, 'editor', 'viewer'];
    if (!role || !allowed.includes(role)) {
      return badRequestResponse(res, `Invalid role. Allowed: ${allowed.join(', ')}`);
    }

    const updated = await UserService.updateUser(id, { role });
    return successResponse(res, updated);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
router.delete('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await UserModel.findById(id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (target.organization_id !== req.user.organizationId) {
      return forbiddenResponse(res, 'Forbidden');
    }
    if (target.id === req.user.id) {
      return badRequestResponse(res, 'Cannot delete your own account');
    }
    if (target.role === ROLES.PLATFORM_ADMIN) {
      return forbiddenResponse(res, 'Cannot delete this user');
    }

    await UserService.deleteUser(id);
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

export default router;
