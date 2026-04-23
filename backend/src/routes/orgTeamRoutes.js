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
router.use(requireRole(ROLES.ORG_ADMIN));

router.use((req, res, next) => {
  if (!req.user.organizationId) {
    return forbiddenResponse(res, 'No organization assigned');
  }
  next();
});

// GET /org/license — subscription, seats, monthly PDF page usage (DB-backed)
router.get('/license', async (req, res) => {
  try {
    const status = await LicenseService.getOrgLicenseStatus(req.user.organizationId);
    return successResponse(res, status);
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

// DELETE /org/users/:id
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
