import express from 'express';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';
import pool from '../config/database.js';
import { OrganizationModel } from '../models/Organization.js';
import { PlanModel } from '../models/Plan.js';
import { FeatureCatalogModel } from '../models/FeatureCatalog.js';
import { OrganizationSubscriptionModel } from '../models/OrganizationSubscription.js';
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

const router = express.Router();

router.use(authenticate);
router.use(requireRole(ROLES.PLATFORM_ADMIN));

function toOrgDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: Boolean(row.active),
    memberSeatLimit: row.member_seat_limit != null ? row.member_seat_limit : null,
    pdfPageQuota: row.pdf_page_quota != null ? Number(row.pdf_page_quota) : null,
    pdfPagesUsed: row.pdf_pages_used != null ? Number(row.pdf_pages_used) : 0,
    validFrom: row.sub_valid_from ?? null,
    validUntil: row.sub_valid_until ?? null,
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Required positive integers when creating an organization */
function parseRequiredOrgQuota(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} is required`);
  }
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return n;
}

function parseIsoDateOptional(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error('Invalid date (use YYYY-MM-DD)');
  }
  return s;
}

function parseIsoDateRequired(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`${label} is required`);
  }
  return parseIsoDateOptional(v);
}

function toPlanDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    seatLimit: row.seat_limit != null ? Number(row.seat_limit) : null,
    monthlyPageLimit: row.monthly_page_limit != null ? Number(row.monthly_page_limit) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** @returns {number|null|undefined} undefined = omit field; null = unlimited */
function parsePlanLimit(value, fieldLabel) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new Error(`${fieldLabel} must be a positive integer or empty for unlimited`);
  }
  return n;
}

function toSubDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// --- Organizations ---
router.get('/organizations', async (_req, res) => {
  try {
    const rows = await OrganizationModel.findAllWithPlan();
    return successResponse(res, rows.map(toOrgDto));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/organizations', async (req, res) => {
  try {
    const { name, slug, active = true, planId } = req.body || {};
    if (!name || !String(name).trim()) return badRequestResponse(res, 'name is required');
    if (planId == null || planId === '') {
      return badRequestResponse(res, 'planId is required');
    }

    let validFrom;
    let validUntil;
    try {
      validFrom = parseIsoDateRequired(req.body?.validFrom, 'validFrom');
      validUntil = parseIsoDateRequired(req.body?.validUntil, 'validUntil');
      if (validUntil < validFrom) {
        return badRequestResponse(res, 'validUntil must be on or after validFrom');
      }
    } catch (e) {
      return badRequestResponse(res, e.message);
    }

    let memberSeatLimit;
    let pdfPageQuota;
    try {
      memberSeatLimit = parseRequiredOrgQuota(req.body?.memberSeatLimit, 'memberSeatLimit');
      const pq = req.body?.pdfPageQuota ?? req.body?.monthlyPageLimit;
      pdfPageQuota = parseRequiredOrgQuota(pq, 'pdfPageQuota');
    } catch (e) {
      return badRequestResponse(res, e.message);
    }

    let s = slug && String(slug).trim() ? String(slug).trim() : name;
    s = s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120);
    if (!s) return badRequestResponse(res, 'slug could not be derived');

    if (await OrganizationModel.findBySlug(s)) {
      return badRequestResponse(res, 'Slug already exists');
    }

    let org;
    try {
      org = await OrganizationModel.create({
        name: name.trim(),
        slug: s,
        active,
        memberSeatLimit,
        pdfPageQuota
      });
    } catch (e) {
      if (
        e.message?.includes('memberSeatLimit') ||
        e.message?.includes('pdfPageQuota') ||
        e.message?.includes('monthlyPageLimit')
      ) {
        return badRequestResponse(res, e.message);
      }
      throw e;
    }
    const pid = parseInt(planId, 10);
    if (Number.isNaN(pid)) {
      return badRequestResponse(res, 'Invalid planId');
    }
    const plan = await PlanModel.findById(pid);
    if (!plan) return badRequestResponse(res, 'Plan not found');
    await OrganizationSubscriptionModel.upsertForOrganization(org.id, {
      planId: plan.id,
      status: 'active',
      validFrom,
      validUntil
    });
    const sub = await OrganizationSubscriptionModel.findByOrganizationId(org.id);
    return successResponse(
      res,
      {
        organization: toOrgDto({
          ...org,
          sub_valid_from: sub?.valid_from ?? null,
          sub_valid_until: sub?.valid_until ?? null,
          plan_id: sub?.plan_id ?? null,
          plan_name: plan.name
        }),
        subscription: toSubDto(sub)
      },
      201
    );
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/organizations/:id', async (req, res) => {
  try {
    const org = await OrganizationModel.findById(parseInt(req.params.id, 10));
    if (!org) return notFoundResponse(res, 'Organization not found');
    const sub = await OrganizationSubscriptionModel.findByOrganizationId(org.id);
    const row = {
      ...org,
      sub_valid_from: sub?.valid_from ?? null,
      sub_valid_until: sub?.valid_until ?? null,
      plan_id: sub?.plan_id ?? null,
      plan_name: null
    };
    if (sub?.plan_id) {
      const pl = await PlanModel.findById(sub.plan_id);
      row.plan_name = pl?.name ?? null;
    }
    return successResponse(res, { organization: toOrgDto(row), subscription: toSubDto(sub) });
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/organizations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrganizationModel.findById(id);
    if (!existing) return notFoundResponse(res, 'Organization not found');
    const { name, slug, active, memberSeatLimit, pdfPageQuota, monthlyPageLimit } = req.body || {};
    const pdfQuotaBody = pdfPageQuota !== undefined ? pdfPageQuota : monthlyPageLimit;

    if (memberSeatLimit !== undefined) {
      let newLimit;
      try {
        newLimit =
          memberSeatLimit === null || memberSeatLimit === ''
            ? null
            : OrganizationModel.normalizeMemberSeatLimit(memberSeatLimit);
      } catch (e) {
        return badRequestResponse(res, e.message);
      }
      if (newLimit != null) {
        const cnt = Number(await UserModel.countMembersByOrganizationId(id));
        if (cnt > newLimit) {
          return badRequestResponse(
            res,
            `Cannot set seat limit below current seat count (${cnt})`
          );
        }
      }
    }

    if (pdfQuotaBody !== undefined) {
      try {
        if (pdfQuotaBody !== null && pdfQuotaBody !== '') {
          OrganizationModel.normalizePdfPageQuota(pdfQuotaBody);
        }
      } catch (e) {
        return badRequestResponse(res, e.message);
      }
    }

    let org;
    try {
      org = await OrganizationModel.update(id, {
        name,
        slug: slug
          ? String(slug)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 120)
          : undefined,
        active,
        memberSeatLimit,
        pdfPageQuota: pdfQuotaBody
      });
    } catch (e) {
      if (
        e.message?.includes('memberSeatLimit') ||
        e.message?.includes('pdfPageQuota') ||
        e.message?.includes('monthlyPageLimit')
      ) {
        return badRequestResponse(res, e.message);
      }
      throw e;
    }
    return successResponse(res, toOrgDto(org));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/organizations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrganizationModel.findById(id);
    if (!existing) return notFoundResponse(res, 'Organization not found');
    await OrganizationModel.delete(id);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/organizations/:id/subscription', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const org = await OrganizationModel.findById(orgId);
    if (!org) return notFoundResponse(res, 'Organization not found');
    const { planId, status, validFrom, validUntil } = req.body || {};
    if (!planId) return badRequestResponse(res, 'planId is required');
    const plan = await PlanModel.findById(parseInt(planId, 10));
    if (!plan) return badRequestResponse(res, 'Plan not found');

    let vf;
    let vu;
    try {
      vf = parseIsoDateRequired(validFrom, 'validFrom');
      vu = parseIsoDateRequired(validUntil, 'validUntil');
      if (vu < vf) {
        return badRequestResponse(res, 'validUntil must be on or after validFrom');
      }
    } catch (e) {
      return badRequestResponse(res, e.message);
    }

    const sub = await OrganizationSubscriptionModel.upsertForOrganization(orgId, {
      planId: plan.id,
      status: status || 'active',
      validFrom: vf,
      validUntil: vu
    });
    return successResponse(res, toSubDto(sub));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/organizations/:id/users', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const org = await OrganizationModel.findById(orgId);
    if (!org) return notFoundResponse(res, 'Organization not found');
    const users = await UserService.getUsersByOrganizationId(orgId);
    return successResponse(res, users);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/organizations/:id/users', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    const org = await OrganizationModel.findById(orgId);
    if (!org) return notFoundResponse(res, 'Organization not found');

    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, password, phoneNumber, role = ROLES.MEMBER } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (role === ROLES.PLATFORM_ADMIN) {
      return badRequestResponse(res, 'Invalid role');
    }

    if (await UserModel.existsByEmail(email)) {
      return badRequestResponse(res, 'Email already exists');
    }

    if (role === ROLES.MEMBER || role === ROLES.ORG_ADMIN) {
      try {
        await UserService.assertMemberSeatsAvailable(orgId);
      } catch (e) {
        if (e.code === 'SEAT_LIMIT') return forbiddenResponse(res, e.message);
        throw e;
      }
    }

    const user = await UserModel.create({
      name,
      email,
      password,
      phoneNumber,
      role,
      organizationId: orgId
    });
    return successResponse(res, UserService.convertToDTO(await UserModel.findById(user.id)), 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// --- Platform user directory (all tenants) ---
router.get('/users', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.organization_id, u.status, u.last_active,
              u.created_at, u.updated_at,
              o.name AS organization_name,
              pl.name AS plan_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN organization_subscriptions sub ON sub.organization_id = u.organization_id
       LEFT JOIN plans pl ON pl.id = sub.plan_id
       ORDER BY u.name ASC, u.id ASC`
    );
    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      organizationId: r.organization_id,
      organizationName: r.organization_name || null,
      planName: r.plan_name || null,
      status: r.status || 'active',
      lastActive: r.last_active || r.updated_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return successResponse(res, data);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/users', async (req, res) => {
  try {
    const validation = validateUserDTO(req.body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const { name, password, phoneNumber, role = ROLES.MEMBER } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();
    let organizationId = req.body.organizationId;
    if (organizationId === '' || organizationId === undefined) organizationId = null;
    else organizationId = parseInt(organizationId, 10);

    if (![ROLES.MEMBER, ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(role)) {
      return badRequestResponse(res, 'Invalid role');
    }

    if (role === ROLES.PLATFORM_ADMIN) {
      organizationId = null;
    } else {
      if (!organizationId || Number.isNaN(organizationId)) {
        return badRequestResponse(res, 'organizationId is required for this role');
      }
      const org = await OrganizationModel.findById(organizationId);
      if (!org) return badRequestResponse(res, 'Organization not found');
      if (role === ROLES.MEMBER || role === ROLES.ORG_ADMIN) {
        try {
          await UserService.assertMemberSeatsAvailable(organizationId);
        } catch (err) {
          if (err.code === 'SEAT_LIMIT') return forbiddenResponse(res, err.message);
          throw err;
        }
      }
    }

    if (await UserModel.existsByEmail(email)) {
      return badRequestResponse(res, 'Email already exists');
    }

    const user = await UserModel.create({
      name: String(name).trim(),
      email,
      password,
      phoneNumber,
      role,
      organizationId
    });
    return successResponse(res, UserService.convertToDTO(await UserModel.findById(user.id)), 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const target = await UserModel.findById(id);
    if (!target) return notFoundResponse(res, 'User not found');

    const body = { ...req.body };
    const validation = validateUserUpdateDTO(body);
    if (!validation.isValid) {
      return badRequestResponse(res, validation.errors.join(', '));
    }

    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.email !== undefined) patch.email = String(body.email).trim().toLowerCase();
    if (body.password) patch.password = body.password;
    if (body.phoneNumber !== undefined) patch.phoneNumber = body.phoneNumber;

    if (body.role !== undefined) {
      if (![ROLES.MEMBER, ROLES.ORG_ADMIN, ROLES.PLATFORM_ADMIN].includes(body.role)) {
        return badRequestResponse(res, 'Invalid role');
      }
      patch.role = body.role;
    }
    if (body.organizationId !== undefined) {
      if (body.organizationId === '' || body.organizationId === null) {
        patch.organizationId = null;
      } else {
        const oid = parseInt(body.organizationId, 10);
        if (Number.isNaN(oid)) return badRequestResponse(res, 'Invalid organizationId');
        const org = await OrganizationModel.findById(oid);
        if (!org) return badRequestResponse(res, 'Organization not found');
        patch.organizationId = oid;
      }
    }

    const nextRole = patch.role !== undefined ? patch.role : target.role;
    let nextOrg = patch.organizationId !== undefined ? patch.organizationId : target.organization_id;
    if (nextRole === ROLES.PLATFORM_ADMIN) {
      patch.organizationId = null;
      nextOrg = null;
    } else if (nextOrg == null) {
      return badRequestResponse(res, 'organizationId is required for this role');
    }

    if (
      (patch.role === ROLES.MEMBER || patch.role === ROLES.ORG_ADMIN || patch.organizationId !== undefined) &&
      (nextRole === ROLES.MEMBER || nextRole === ROLES.ORG_ADMIN)
    ) {
      const orgIdForSeat = patch.organizationId !== undefined ? patch.organizationId : target.organization_id;
      const wasSeat = UserService.consumesOrgSeat(target.role, target.organization_id);
      const willSeat = UserService.consumesOrgSeat(nextRole, orgIdForSeat);
      if (willSeat && (!wasSeat || orgIdForSeat !== target.organization_id)) {
        try {
          await UserService.assertMemberSeatsAvailable(orgIdForSeat);
        } catch (err) {
          if (err.code === 'SEAT_LIMIT') return forbiddenResponse(res, err.message);
          throw err;
        }
      }
    }

    const user = await UserService.updateUser(id, patch);
    return successResponse(res, user);
  } catch (e) {
    if (e.message?.includes('not found')) return notFoundResponse(res, e.message);
    if (e.message?.includes('already exists')) return badRequestResponse(res, e.message);
    return errorResponse(res, e.message, 500);
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return badRequestResponse(res, 'Invalid id');
    const { status } = req.body || {};
    const allowed = ['active', 'suspended', 'pending_verification'];
    if (!allowed.includes(status)) {
      return badRequestResponse(res, `status must be one of: ${allowed.join(', ')}`);
    }
    if (req.user.id === id && status === 'suspended') {
      return badRequestResponse(res, 'Cannot suspend your own account');
    }
    const target = await UserModel.findById(id);
    if (!target) return notFoundResponse(res, 'User not found');
    await UserModel.update(id, { status });
    return successResponse(res, UserService.convertToDTO(await UserModel.findById(id)));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// --- Plans ---
router.get('/plans', async (_req, res) => {
  try {
    const rows = await PlanModel.findAll();
    return successResponse(res, rows.map(toPlanDto));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/plans', async (req, res) => {
  try {
    const { name, description, seatLimit, monthlyPageLimit } = req.body || {};
    if (!name || !String(name).trim()) return badRequestResponse(res, 'name is required');
    let sl;
    let mpl;
    try {
      sl = parsePlanLimit(seatLimit, 'seatLimit');
      mpl = parsePlanLimit(monthlyPageLimit, 'monthlyPageLimit');
    } catch (err) {
      return badRequestResponse(res, err.message);
    }
    const plan = await PlanModel.create({
      name: name.trim(),
      description,
      seatLimit: sl,
      monthlyPageLimit: mpl
    });
    return successResponse(res, toPlanDto(plan), 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/plans/:id', async (req, res) => {
  try {
    const plan = await PlanModel.findById(parseInt(req.params.id, 10));
    if (!plan) return notFoundResponse(res, 'Plan not found');
    const features = await PlanModel.listFeatures(plan.id);
    return successResponse(res, {
      plan: toPlanDto(plan),
      features: features.map((f) => ({
        featureKey: f.feature_key,
        limits: f.limits_json
      }))
    });
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/plans/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await PlanModel.findById(id);
    if (!existing) return notFoundResponse(res, 'Plan not found');
    const { name, description, seatLimit, monthlyPageLimit } = req.body || {};
    let sl;
    let mpl;
    try {
      if (seatLimit !== undefined) sl = parsePlanLimit(seatLimit, 'seatLimit');
      if (monthlyPageLimit !== undefined) mpl = parsePlanLimit(monthlyPageLimit, 'monthlyPageLimit');
    } catch (err) {
      return badRequestResponse(res, err.message);
    }
    const plan = await PlanModel.update(id, { name, description, seatLimit: sl, monthlyPageLimit: mpl });
    return successResponse(res, toPlanDto(plan));
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await PlanModel.findById(id);
    if (!existing) return notFoundResponse(res, 'Plan not found');
    await PlanModel.delete(id);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/plans/:planId/features/:featureKey', async (req, res) => {
  try {
    const planId = parseInt(req.params.planId, 10);
    const { featureKey } = req.params;
    const plan = await PlanModel.findById(planId);
    if (!plan) return notFoundResponse(res, 'Plan not found');
    if (!(await FeatureCatalogModel.exists(featureKey))) {
      return badRequestResponse(res, 'Unknown feature key');
    }
    const { limitsJson } = req.body || {};
    await PlanModel.setPlanFeature(planId, featureKey, limitsJson ?? null);
    const features = await PlanModel.listFeatures(planId);
    return successResponse(
      res,
      features.map((f) => ({ featureKey: f.feature_key, limits: f.limits_json }))
    );
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/plans/:planId/features/:featureKey', async (req, res) => {
  try {
    const planId = parseInt(req.params.planId, 10);
    const { featureKey } = req.params;
    const plan = await PlanModel.findById(planId);
    if (!plan) return notFoundResponse(res, 'Plan not found');
    await PlanModel.removePlanFeature(planId, featureKey);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// --- Feature catalog ---
router.get('/features', async (_req, res) => {
  try {
    const rows = await FeatureCatalogModel.findAll();
    return successResponse(
      res,
      rows.map((r) => ({ featureKey: r.feature_key, description: r.description }))
    );
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/features', async (req, res) => {
  try {
    const { featureKey, description } = req.body || {};
    if (!featureKey || !String(featureKey).trim()) {
      return badRequestResponse(res, 'featureKey is required');
    }
    if (await FeatureCatalogModel.exists(featureKey.trim())) {
      return badRequestResponse(res, 'Feature key already exists');
    }
    const row = await FeatureCatalogModel.create({
      featureKey: featureKey.trim(),
      description
    });
    return successResponse(
      res,
      { featureKey: row.feature_key, description: row.description },
      201
    );
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

export default router;
