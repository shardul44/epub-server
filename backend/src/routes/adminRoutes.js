import express from 'express';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';
import pool from '../config/database.js';
import { OrganizationModel } from '../models/Organization.js';
import { PlanModel } from '../models/Plan.js';
import { FeatureCatalogModel } from '../models/FeatureCatalog.js';
import { OrganizationSubscriptionModel } from '../models/OrganizationSubscription.js';
import { PlatformSettingsModel } from '../models/PlatformSettings.js';
import { PlatformApiKeyModel } from '../models/PlatformApiKey.js';
import { UserModel } from '../models/User.js';
import { UserActivityModel } from '../models/UserActivity.js';
import { UserService } from '../services/userService.js';
import { PlanRequestService } from '../services/planRequestService.js';
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

function toPlatformSettingsDto(row, plans) {
  const r = row || {};
  const num = (v, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    const n = typeof v === 'bigint' ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const defaultPlanId =
    r.default_plan_id === null || r.default_plan_id === undefined
      ? null
      : (() => {
          const n = typeof r.default_plan_id === 'bigint' ? Number(r.default_plan_id) : Number(r.default_plan_id);
          return Number.isFinite(n) && n > 0 ? n : null;
        })();
  return {
    platformName: r.platform_name ?? 'PDF to EPUB Converter',
    defaultPlanId,
    maxUploadMb: num(r.max_upload_mb, 100),
    sessionTimeoutMinutes: num(r.session_timeout_minutes, 60),
    smtpHost: r.smtp_host ?? '',
    smtpPort: num(r.smtp_port, 587),
    smtpFromEmail: r.smtp_from_email ?? '',
    smtpAdminAlertEmail: r.smtp_admin_alert_email ?? '',
    updatedAt: r.updated_at ?? null,
    plans: (plans || []).map((p) => ({
      id: typeof p.id === 'bigint' ? Number(p.id) : p.id,
      name: p.name
    }))
  };
}

/** MySQL ER_NO_SUCH_TABLE = 1146 — surface a clear message when migration was not applied */
function platformSettingsDbError(res, e) {
  const errno = e?.errno;
  const msg = e?.message || String(e);
  if (
    errno === 1146 ||
    (/doesn't exist/i.test(msg) && /platform_settings/i.test(msg)) ||
    /Unknown table.*platform_settings/i.test(msg)
  ) {
    return errorResponse(
      res,
      'Table platform_settings is missing. Run the SQL migration: backend/database/migrations/012_platform_settings.sql',
      503
    );
  }
  return errorResponse(res, msg, 500);
}

function parseActivityMetadata(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function inferActivityLogLevel(action, summary) {
  const t = `${action || ''} ${summary || ''}`.toLowerCase();
  if (/\b(error|fail|fatal|denied|exception|forbidden)\b/.test(t)) return 'ERROR';
  if (/\b(warn|warning|threshold|usage|quota|limit|cancelled|canceled)\b/.test(t)) return 'WARN';
  return 'INFO';
}

function activityLogCategory(action, entityType) {
  const a = (action || '').trim();
  if (a.includes('.')) return a;
  if (entityType) return `${String(entityType).replace(/_/g, '.')}.event`;
  return 'system';
}

function formatLogEventCode(action, entityType) {
  const a = (action || '').trim();
  if (a.includes('.')) return a.replace(/\./g, '_').toUpperCase();
  if (entityType) return `${String(entityType).replace(/_/g, '_')}_EVENT`.toUpperCase();
  return 'SYSTEM';
}

function buildActivityLogMessage(row) {
  const meta = parseActivityMetadata(row.metadata);
  const parts = [];
  if (row.summary) parts.push(String(row.summary).trim());
  const actor = row.actor_email || row.actor_name;
  if (actor) parts.push(`by ${actor}`);
  if (row.organization_name) parts.push(`(org: ${row.organization_name})`);
  const pages = meta && (meta.totalPages ?? meta.pages ?? meta.pageCount);
  if (pages != null && Number.isFinite(Number(pages))) parts.push(`${pages} pages`);
  const msg = parts.join(' ').replace(/\s+/g, ' ').trim();
  return msg || row.action || 'Event';
}

function buildActivityLogFields(row) {
  const meta = parseActivityMetadata(row.metadata);
  const summary = row.summary ? String(row.summary).trim() : '';
  const detailParts = [];
  const actor = row.actor_email || row.actor_name;
  if (actor) detailParts.push(`by ${actor}`);
  const pages = meta && (meta.totalPages ?? meta.pages ?? meta.pageCount);
  if (pages != null && Number.isFinite(Number(pages))) {
    detailParts.push(`${pages} pages`);
  }
  return {
    event: formatLogEventCode(row.action, row.entity_type),
    title: summary || row.action || 'Event',
    detail: detailParts.join(' · ') || 'Platform activity recorded',
    organizationName: row.organization_name || null,
    ipAddress: meta?.ipAddress ?? meta?.ip ?? null,
    host: meta?.hostname ?? meta?.host ?? meta?.source ?? 'web-01'
  };
}

// --- Platform settings (single row) ---
router.get('/platform-settings', async (_req, res) => {
  try {
    const row = await PlatformSettingsModel.getRow();
    const plans = await PlanModel.findAll();
    return successResponse(res, toPlatformSettingsDto(row, plans));
  } catch (e) {
    return platformSettingsDbError(res, e);
  }
});

router.put('/platform-settings/general', async (req, res) => {
  try {
    const { platformName, defaultPlanId, maxUploadMb, sessionTimeoutMinutes } = req.body || {};
    let pid = defaultPlanId;
    if (pid !== undefined && pid !== null && pid !== '') {
      pid = parseInt(pid, 10);
      if (Number.isNaN(pid)) return badRequestResponse(res, 'Invalid defaultPlanId');
      const pl = await PlanModel.findById(pid);
      if (!pl) return badRequestResponse(res, 'Plan not found');
    } else {
      pid = null;
    }
    const updated = await PlatformSettingsModel.updateGeneral({
      platformName,
      defaultPlanId: pid,
      maxUploadMb,
      sessionTimeoutMinutes
    });
    const plans = await PlanModel.findAll();
    return successResponse(res, toPlatformSettingsDto(updated, plans));
  } catch (e) {
    return platformSettingsDbError(res, e);
  }
});

router.put('/platform-settings/email', async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpFromEmail, smtpAdminAlertEmail } = req.body || {};
    const updated = await PlatformSettingsModel.updateEmail({
      smtpHost,
      smtpPort,
      smtpFromEmail,
      smtpAdminAlertEmail
    });
    const plans = await PlanModel.findAll();
    return successResponse(res, toPlatformSettingsDto(updated, plans));
  } catch (e) {
    return platformSettingsDbError(res, e);
  }
});

/**
 * GET /admin/system-logs
 * Merges platform-wide user_activities with recent failed conversion_jobs for a live audit feed.
 * Query: level=all|INFO|WARN|ERROR, limit=1..500 (default 400)
 */
router.get('/system-logs', async (req, res) => {
  try {
    const levelRaw = (req.query.level || 'all').toString().toUpperCase();
    const level = ['ALL', 'INFO', 'WARN', 'ERROR'].includes(levelRaw) ? levelRaw : 'ALL';

    let lim = parseInt(String(req.query.limit), 10);
    if (Number.isNaN(lim) || lim < 1) lim = 400;
    lim = Math.min(lim, 500);

    const activityLimit = Math.min(500, lim + 100);
    const rows = await UserActivityModel.listForViewer({
      viewerRole: 'platform_admin',
      viewerId: req.user.id,
      viewerOrgId: null,
      limit: activityLimit
    });

    const fromActivities = rows.map((r) => {
      const aid = typeof r.id === 'bigint' ? Number(r.id) : r.id;
      const ts = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
      const fields = buildActivityLogFields(r);
      return {
        id: `a-${aid}`,
        source: fields.host,
        ts,
        level: inferActivityLogLevel(r.action, r.summary),
        category: activityLogCategory(r.action, r.entity_type),
        message: buildActivityLogMessage(r),
        event: fields.event,
        title: fields.title,
        detail: fields.detail,
        organizationName: fields.organizationName,
        ipAddress: fields.ipAddress
      };
    });

    const [jobRows] = await pool.execute(
      `SELECT cj.id, cj.updated_at AS ts, cj.error_message AS error_message,
              pd.original_file_name AS pdf_name, o.name AS org_name
       FROM conversion_jobs cj
       INNER JOIN pdf_documents pd ON pd.id = cj.pdf_document_id
       LEFT JOIN organizations o ON o.id = pd.organization_id
       WHERE cj.status = 'FAILED'
       ORDER BY cj.updated_at DESC
       LIMIT 120`
    );

    const fromJobs = jobRows.map((j) => {
      const jid = typeof j.id === 'bigint' ? Number(j.id) : j.id;
      const pdf = j.pdf_name || 'PDF';
      const org = j.org_name ? ` (org: ${j.org_name})` : '';
      const err = (j.error_message || 'Unknown error').replace(/\s+/g, ' ').trim().slice(0, 420);
      const jobTag = `JOB-${String(jid).padStart(3, '0')}`;
      const ts = j.ts instanceof Date ? j.ts.toISOString() : j.ts;
      return {
        id: `j-${jid}`,
        source: 'api',
        ts,
        level: 'ERROR',
        category: 'conversion',
        message: `Job #${jobTag} failed: ${err} on ${pdf}${org}`,
        event: 'CONVERSION_FAILED',
        title: `Job #${jobTag} failed`,
        detail: `${err} on ${pdf}`,
        organizationName: j.org_name || null,
        ipAddress: null
      };
    });

    let logs = [...fromActivities, ...fromJobs];
    logs.sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime());

    if (level !== 'ALL') {
      logs = logs.filter((L) => L.level === level);
    }

    logs = logs.slice(0, lim);

    return successResponse(res, {
      logs,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

/** Role × capability matrix (reflects how this product gates routes today). */
function getRolePermissionMatrix() {
  return [
    {
      role: 'platform_admin',
      roleLabel: 'Platform Admin',
      orgs: 'Full',
      plans: 'Full',
      users: 'Full',
      billing: 'Full'
    },
    {
      role: 'org_admin',
      roleLabel: 'Org Admin',
      orgs: 'Read',
      plans: 'Read',
      users: 'Full',
      billing: 'Read'
    },
    {
      role: 'member',
      roleLabel: 'Member',
      orgs: 'None',
      plans: 'None',
      users: 'None',
      billing: 'None'
    }
  ];
}

router.get('/security/overview', async (_req, res) => {
  try {
    const apiKeys = await PlatformApiKeyModel.listForAdmin();
    return successResponse(res, {
      rolePermissions: getRolePermissionMatrix(),
      apiKeys
    });
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/security/api-keys', async (req, res) => {
  try {
    const { name, environment = 'staging' } = req.body || {};
    const { dto, plainSecret } = await PlatformApiKeyModel.create({ name, environment });
    return successResponse(res, { key: dto, plainSecret }, 201);
  } catch (e) {
    if (e.message === 'name is required') return badRequestResponse(res, e.message);
    return errorResponse(res, e.message, 500);
  }
});

router.patch('/security/api-keys/:id/revoke', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return badRequestResponse(res, 'Invalid id');
    const ok = await PlatformApiKeyModel.revoke(id);
    if (!ok) return notFoundResponse(res, 'Key not found or already revoked');
    const list = await PlatformApiKeyModel.listForAdmin();
    const key = list.find((k) => k.id === id);
    return successResponse(res, key || { id, revoked: true });
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.patch('/security/api-keys/:id/renew', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return badRequestResponse(res, 'Invalid id');
    const dto = await PlatformApiKeyModel.renew(id);
    return successResponse(res, dto);
  } catch (e) {
    if (e.message === 'API key not found') return notFoundResponse(res, e.message);
    if (e.message === 'Cannot renew a revoked key') return badRequestResponse(res, e.message);
    return errorResponse(res, e.message, 500);
  }
});

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

// --- Plan requests (member upgrade / add-on → platform admin) ---
router.get('/plan-requests/pending-count', async (_req, res) => {
  try {
    const count = await PlanRequestService.pendingCount();
    return successResponse(res, { count });
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.errno === 1146 || /plan_requests/i.test(msg)) {
      return errorResponse(
        res,
        'Table plan_requests is missing. Run: backend/database/migrations/014_plan_requests.sql',
        503,
      );
    }
    return errorResponse(res, msg, 500);
  }
});

router.get('/plan-requests', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const list = await PlanRequestService.listForAdmin({ status });
    return successResponse(res, list);
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.errno === 1146 || /plan_requests/i.test(msg)) {
      return errorResponse(
        res,
        'Table plan_requests is missing. Run: backend/database/migrations/014_plan_requests.sql',
        503,
      );
    }
    return errorResponse(res, msg, 500);
  }
});

router.post('/plan-requests/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return badRequestResponse(res, 'Invalid request id');
    const { adminNote } = req.body || {};
    const dto = await PlanRequestService.approve(id, {
      reviewerUserId: req.user.id,
      adminNote: adminNote ? String(adminNote).slice(0, 2000) : null,
    });
    return successResponse(res, dto);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return notFoundResponse(res, e.message);
    if (e.code === 'INVALID_STATE' || e.code === 'INVALID_ADDON') {
      return badRequestResponse(res, e.message);
    }
    const msg = e?.message || String(e);
    if (e?.errno === 1146 || /plan_requests/i.test(msg)) {
      return errorResponse(
        res,
        'Table plan_requests is missing. Run: backend/database/migrations/014_plan_requests.sql',
        503,
      );
    }
    return errorResponse(res, msg, 500);
  }
});

router.post('/plan-requests/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || Number.isNaN(id)) return badRequestResponse(res, 'Invalid request id');
    const { adminNote } = req.body || {};
    const dto = await PlanRequestService.reject(id, {
      reviewerUserId: req.user.id,
      adminNote: adminNote ? String(adminNote).slice(0, 2000) : null,
    });
    return successResponse(res, dto);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return notFoundResponse(res, e.message);
    if (e.code === 'INVALID_STATE') return badRequestResponse(res, e.message);
    const msg = e?.message || String(e);
    if (e?.errno === 1146 || /plan_requests/i.test(msg)) {
      return errorResponse(
        res,
        'Table plan_requests is missing. Run: backend/database/migrations/014_plan_requests.sql',
        503,
      );
    }
    return errorResponse(res, msg, 500);
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
