import express from 'express';
import { UserService } from '../services/userService.js';
import { UserModel } from '../models/User.js';
import { validateUserDTO, validateUserUpdateDTO } from '../utils/validation.js';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  badRequestResponse,
  forbiddenResponse
} from '../utils/responseHandler.js';

const router = express.Router();

router.use(authenticate);

async function loadTargetUser(id) {
  return UserModel.findById(parseInt(id, 10));
}

function canAccessUser(req, target) {
  if (!target) return false;
  if (req.user.role === ROLES.PLATFORM_ADMIN) return true;
  if (req.user.role === ROLES.ORG_ADMIN) {
    return (
      req.user.organizationId != null &&
      target.organization_id === req.user.organizationId
    );
  }
  if (req.user.role === ROLES.MEMBER) {
    return target.id === req.user.id;
  }
  return false;
}

// GET /users — platform admin: all; org admin: org only
router.get('/', requireRole(ROLES.PLATFORM_ADMIN, ROLES.ORG_ADMIN), async (req, res) => {
  try {
    if (req.user.role === ROLES.PLATFORM_ADMIN) {
      const users = await UserService.getAllUsers();
      return successResponse(res, users);
    }
    if (!req.user.organizationId) {
      return forbiddenResponse(res, 'No organization assigned');
    }
    const users = await UserService.getUsersByOrganizationId(req.user.organizationId);
    return successResponse(res, users);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

// GET /users/:id
router.get('/:id', async (req, res) => {
  try {
    const target = await loadTargetUser(req.params.id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (!canAccessUser(req, target)) return forbiddenResponse(res, 'Forbidden');
    const user = await UserService.getUserById(parseInt(req.params.id, 10));
    return successResponse(res, user);
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// POST /users — platform admin only (create user in any org)
router.post('/', requireRole(ROLES.PLATFORM_ADMIN), async (req, res) => {
  try {
    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, password, phoneNumber, role, organizationId } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!organizationId && role !== ROLES.PLATFORM_ADMIN) {
      return badRequestResponse(res, 'organizationId is required for non-platform users');
    }
    if (!role) {
      return badRequestResponse(res, 'role is required');
    }

    const user = await UserService.createUser({
      name,
      email,
      password,
      phoneNumber,
      role,
      organizationId: role === ROLES.PLATFORM_ADMIN ? null : organizationId
    });
    return successResponse(res, user, 201);
  } catch (error) {
    if (error.code === 'SEAT_LIMIT') {
      return forbiddenResponse(res, error.message);
    }
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// PUT /users/:id
router.put('/:id', async (req, res) => {
  try {
    const target = await loadTargetUser(req.params.id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (!canAccessUser(req, target)) return forbiddenResponse(res, 'Forbidden');

    if (req.user.role === ROLES.ORG_ADMIN) {
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
      const user = await UserService.updateUser(parseInt(req.params.id, 10), body);
      return successResponse(res, user);
    }

    if (req.user.role === ROLES.MEMBER) {
      const body = { ...req.body };
      delete body.role;
      delete body.organizationId;
      const validation = validateUserUpdateDTO(body);
      if (!validation.isValid) {
        return badRequestResponse(res, validation.errors.join(', '));
      }
      const user = await UserService.updateUser(parseInt(req.params.id, 10), body);
      return successResponse(res, user);
    }

    const validation = validateUserUpdateDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const user = await UserService.updateUser(parseInt(req.params.id, 10), req.body);
    return successResponse(res, user);
  } catch (error) {
    if (error.code === 'SEAT_LIMIT') {
      return forbiddenResponse(res, error.message);
    }
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    if (error.message.includes('already exists')) {
      return badRequestResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

// DELETE /users/:id
router.delete('/:id', async (req, res) => {
  try {
    const target = await loadTargetUser(req.params.id);
    if (!target) return notFoundResponse(res, 'User not found');
    if (!canAccessUser(req, target)) return forbiddenResponse(res, 'Forbidden');
    if (req.user.role === ROLES.ORG_ADMIN && target.role === ROLES.PLATFORM_ADMIN) {
      return forbiddenResponse(res, 'Cannot delete this user');
    }
    if (target.id === req.user.id) {
      return badRequestResponse(res, 'Cannot delete your own account here');
    }

    await UserService.deleteUser(parseInt(req.params.id, 10));
    return res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return notFoundResponse(res, error.message);
    }
    return errorResponse(res, error.message, 500);
  }
});

export default router;
