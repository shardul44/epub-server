import { PlanRequestModel } from '../models/PlanRequest.js';

/**
 * Ensures the plan_requests table exists.
 * Runs once at server startup (see server.js).
 */
export async function ensurePlanRequests() {
  try {
    await PlanRequestModel.ensureSchema();
    console.log('[bootstrap] plan_requests schema OK');
  } catch (e) {
    console.warn('[bootstrap] ensurePlanRequests failed:', e.message);
  }
}
