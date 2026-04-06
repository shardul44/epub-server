import express from 'express';
import jwt from 'jsonwebtoken';
import { UserService } from '../services/userService.js';
import { UserModel } from '../models/User.js';
import { validateUserDTO } from '../utils/validation.js';
import { authenticate } from '../middlewares/auth.js';
import { successResponse, errorResponse, badRequestResponse } from '../utils/responseHandler.js';

const router = express.Router();

const signToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name
  };

  const secret = process.env.JWT_SECRET || 'your-secret-key';
  return jwt.sign(payload, secret, { expiresIn: '7d' });
};

// POST /api/auth/register
// Creates a user and returns a JWT for immediate login.
router.post('/register', async (req, res) => {
  try {
    const validation = validateUserDTO(req.body || {});
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, email, password, phoneNumber } = req.body;

    if (await UserModel.existsByEmail(email)) {
      return badRequestResponse(res, 'Email already exists');
    }

    const created = await UserModel.create({ name, email, password, phoneNumber });
    const dto = UserService.convertToDTO ? UserService.convertToDTO(created) : {
      id: created.id,
      name: created.name,
      email: created.email,
      phoneNumber: created.phone_number,
      createdAt: created.created_at
    };

    const token = signToken(created);
    return successResponse(res, { token, user: dto }, 201);
  } catch (error) {
    return errorResponse(res, error.message || 'Registration failed', 500);
  }
});

// POST /api/auth/login
// Verifies user credentials and returns a JWT.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

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

    const token = signToken(userRow);

    const dto = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      phoneNumber: userRow.phone_number,
      createdAt: userRow.created_at
    };

    return successResponse(res, { token, user: dto });
  } catch (error) {
    return errorResponse(res, error.message || 'Login failed', 500);
  }
});

// GET /api/auth/me - return current user (requires auth)
router.get('/me', authenticate, async (req, res) => {
  try {
    const { id } = req.user || {};
    if (!id) return errorResponse(res, 'Invalid token payload', 401);

    const user = await UserService.getUserById(id);
    return successResponse(res, user);
  } catch (error) {
    return errorResponse(res, error.message || 'Failed to load current user', 500);
  }
});

export default router;

