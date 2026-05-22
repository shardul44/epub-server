import { PlanRequestModel } from '../models/PlanRequest.js';
import { PlanModel } from '../models/Plan.js';
import { OrganizationModel } from '../models/Organization.js';
import { OrganizationSubscriptionModel } from '../models/OrganizationSubscription.js';

const ADDON_DELTAS = {
  'pages-500': { pdfPageQuota: 500, label: '500 Extra Pages' },
  'pages-2000': { pdfPageQuota: 2000, label: '2,000 Extra Pages' },
  'seats-5': { memberSeatLimit: 5, label: '5 Extra Seats' },
  'tts-60': { label: '60 TTS Minutes' },
};

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? null,
    requestedByUserId: row.requested_by_user_id,
    requesterName: row.requester_name ?? null,
    requesterEmail: row.requester_email ?? null,
    requestType: row.request_type,
    status: row.status,
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    addonKey: row.addon_key ?? null,
    requestLabel: row.request_label,
    memberNote: row.member_note ?? null,
    adminNote: row.admin_note ?? null,
    reviewedByUserId: row.reviewed_by_user_id ?? null,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PlanRequestService {
  static getAddonMeta(key) {
    return ADDON_DELTAS[key] ?? null;
  }

  static async createUpgradeRequest({ organizationId, userId, planId, memberNote }) {
    const plan = await PlanModel.findById(planId);
    if (!plan) {
      const err = new Error('Plan not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const dup = await PlanRequestModel.findPendingDuplicate({
      organizationId,
      requestType: 'upgrade',
      planId: plan.id,
      addonKey: null,
    });
    if (dup) {
      const err = new Error('A pending upgrade request for this plan already exists');
      err.code = 'DUPLICATE';
      throw err;
    }
    const row = await PlanRequestModel.create({
      organizationId,
      requestedByUserId: userId,
      requestType: 'upgrade',
      planId: plan.id,
      requestLabel: `Upgrade to ${plan.name}`,
      memberNote,
    });
    return toDto(row);
  }

  static async createAddonRequest({ organizationId, userId, addonKey, memberNote }) {
    const meta = ADDON_DELTAS[addonKey];
    if (!meta) {
      const err = new Error('Unknown add-on');
      err.code = 'INVALID_ADDON';
      throw err;
    }
    const dup = await PlanRequestModel.findPendingDuplicate({
      organizationId,
      requestType: 'addon',
      planId: null,
      addonKey,
    });
    if (dup) {
      const err = new Error('A pending request for this add-on already exists');
      err.code = 'DUPLICATE';
      throw err;
    }
    const row = await PlanRequestModel.create({
      organizationId,
      requestedByUserId: userId,
      requestType: 'addon',
      addonKey,
      requestLabel: meta.label,
      memberNote,
    });
    return toDto(row);
  }

  static async listForOrg(organizationId) {
    const rows = await PlanRequestModel.findByOrganizationId(organizationId);
    return rows.map(toDto);
  }

  static async listForAdmin({ status } = {}) {
    const rows = await PlanRequestModel.findAll({ status: status || undefined });
    return rows.map(toDto);
  }

  static async pendingCount() {
    return PlanRequestModel.countPending();
  }

  static async approve(id, { reviewerUserId, adminNote }) {
    const row = await PlanRequestModel.findById(id);
    if (!row) {
      const err = new Error('Request not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (row.status !== 'pending') {
      const err = new Error('Request is no longer pending');
      err.code = 'INVALID_STATE';
      throw err;
    }

    const orgId = row.organization_id;

    if (row.request_type === 'upgrade') {
      const plan = await PlanModel.findById(row.plan_id);
      if (!plan) {
        const err = new Error('Plan not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      const sub = await OrganizationSubscriptionModel.findByOrganizationId(orgId);
      const today = new Date().toISOString().slice(0, 10);
      const validFrom = sub?.valid_from ? String(sub.valid_from).slice(0, 10) : today;
      const validUntil = sub?.valid_until
        ? String(sub.valid_until).slice(0, 10)
        : addDaysIso(365);

      await OrganizationSubscriptionModel.upsertForOrganization(orgId, {
        planId: plan.id,
        status: 'active',
        validFrom,
        validUntil,
      });

      const org = await OrganizationModel.findById(orgId);
      const orgUpdates = {};
      if (plan.seat_limit != null) {
        const cur = org.member_seat_limit;
        if (cur == null || Number(cur) < Number(plan.seat_limit)) {
          orgUpdates.memberSeatLimit = Number(plan.seat_limit);
        }
      }
      if (plan.monthly_page_limit != null) {
        const cur = org.pdf_page_quota;
        if (cur == null || Number(cur) < Number(plan.monthly_page_limit)) {
          orgUpdates.pdfPageQuota = Number(plan.monthly_page_limit);
        }
      }
      if (Object.keys(orgUpdates).length) {
        await OrganizationModel.update(orgId, orgUpdates);
      }
    } else if (row.request_type === 'addon') {
      const meta = ADDON_DELTAS[row.addon_key];
      if (!meta) {
        const err = new Error('Unknown add-on on request');
        err.code = 'INVALID_ADDON';
        throw err;
      }
      const org = await OrganizationModel.findById(orgId);
      const updates = {};
      if (meta.pdfPageQuota) {
        const base = org.pdf_page_quota != null ? Number(org.pdf_page_quota) : 0;
        updates.pdfPageQuota = base + meta.pdfPageQuota;
      }
      if (meta.memberSeatLimit) {
        const base = org.member_seat_limit != null ? Number(org.member_seat_limit) : 0;
        updates.memberSeatLimit = base + meta.memberSeatLimit;
      }
      if (Object.keys(updates).length) {
        await OrganizationModel.update(orgId, updates);
      }
    }

    const updated = await PlanRequestModel.updateStatus(id, {
      status: 'approved',
      adminNote,
      reviewedByUserId: reviewerUserId,
    });
    return toDto(updated);
  }

  static async reject(id, { reviewerUserId, adminNote }) {
    const row = await PlanRequestModel.findById(id);
    if (!row) {
      const err = new Error('Request not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (row.status !== 'pending') {
      const err = new Error('Request is no longer pending');
      err.code = 'INVALID_STATE';
      throw err;
    }
    const updated = await PlanRequestModel.updateStatus(id, {
      status: 'rejected',
      adminNote,
      reviewedByUserId: reviewerUserId,
    });
    return toDto(updated);
  }
}
