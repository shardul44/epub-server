import jwt from 'jsonwebtoken';
import { UserModel } from '../models/User.js';
import { EntitlementService } from '../services/entitlementService.js';
import { forbiddenResponse } from '../utils/responseHandler.js';

const jwtSecret = () => process.env.JWT_SECRET || 'your-secret-key';

const FEATURE_ALIASES = {
  'conversion.basic': ['reflowable.pdf_to_epub'],
  'kitaboo.import': ['hifi_fxl.pdf_to_epub'],
  'sync_studio': [
    'reflowable.audio_sync',
    'hifi_fxl.audio_sync',
    'reflowable_epub.audio_sync',
    'hifi_fxl_epub.audio_sync'
  ],
  accessibility_tools: ['accessibility'],
  epub_tools: ['epub_checker'],
  'interactive.content': ['interactive_books'],
  'reflowable.pdf_to_epub': ['conversion.basic'],
  'hifi_fxl.pdf_to_epub': ['kitaboo.import'],
  'reflowable.audio_sync': ['sync_studio'],
  'hifi_fxl.audio_sync': ['sync_studio'],
  'reflowable_epub.audio_sync': ['sync_studio'],
  'hifi_fxl_epub.audio_sync': ['sync_studio'],
  accessibility: ['accessibility_tools'],
  epub_checker: ['epub_tools'],
  interactive_books: ['interactive.content']
};

function expandFeatureCandidates(featureKey) {
  const aliases = FEATURE_ALIASES[featureKey] || [];
  return [featureKey, ...aliases];
}

async function hydrateUserFromDb(decoded) {
  const row = await UserModel.findById(decoded.id);
  if (!row) return null;
  const features = await EntitlementService.getFeatureKeysForUser(row);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organization_id ?? null,
    features
  };
}

export const authenticate = async (req, res, next) => {
  try {
    let authHeader = req.headers.authorization;
    // Allow JWT on media URLs for native elements (<img>/<audio>) that cannot send Authorization.
    if (
      (!authHeader || !authHeader.startsWith('Bearer ')) &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      req.query?.token &&
      typeof req.query.token === 'string'
    ) {
      authHeader = `Bearer ${req.query.token.trim()}`;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, jwtSecret());

    if (!decoded?.id) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const hydrated = await hydrateUserFromDb(decoded);
    if (!hydrated) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = hydrated;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, jwtSecret());
      if (decoded?.id) {
        const hydrated = await hydrateUserFromDb(decoded);
        if (hydrated) req.user = hydrated;
      }
    }
    next();
  } catch (error) {
    next();
  }
};

/**
 * @param {...string} roles
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user?.role) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!roles.includes(req.user.role)) {
    return forbiddenResponse(res, 'Insufficient permissions');
  }
  next();
};

/**
 * @param {string} featureKey
 */
export const requireFeature = (featureKey) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const f = req.user.features || [];
  const candidates = expandFeatureCandidates(featureKey);
  if (f.includes('*') || candidates.some((k) => f.includes(k))) {
    return next();
  }
  return forbiddenResponse(res, 'This feature is not enabled for your plan');
};
