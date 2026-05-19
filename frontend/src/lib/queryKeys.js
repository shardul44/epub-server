/**
 * queryKeys.js — single source of truth for all React Query cache keys.
 *
 * RULE: conversion/job data uses queryKeys.conversions.list(scope) so member (`own`)
 * and org_admin (`org`) caches never mix. Pass scope from useListScope() or
 * getListScopeForUser(user).
 */

export const queryKeys = {
  // ── App Bootstrap (bundled: media + license + activities + users + health) ──
  appBootstrap: (userId) => ['app-bootstrap', userId ?? 'anon'],
  appBootstrapPrefix: () => ['app-bootstrap'],

  // ── Conversions (jobs) ─────────────────────────────────────────
  // All consumers MUST use conversions.list() as their queryKey.
  // Status filtering is done client-side — never via separate keys.
  conversions: {
    /** Job list cache — `all()` invalidates every scope. */
    all:    () => ['conversions'],
    list:   (scope = 'org') => ['conversions', scope],
    detail: (jobId) => ['conversions', 'detail', jobId],
    status: (jobId) => ['conversion', jobId], // for useConversionStatus polling
  },

  /** Alias for invalidations tied to GET /kitaboo/jobs (merged into conversions cache today). */
  kitabooJobs: {
    all: () => ['kitaboo-jobs'],
  },

  // ── PDFs ───────────────────────────────────────────────────────
  pdfs: {
    all:     () => ['pdfs'],
    list:    (scope = 'org') => ['pdfs', 'list', scope],
    grouped: (scope = 'org') => ['pdfs', 'grouped', scope],
    detail:  (id) => ['pdfs', 'detail', id],
  },

  // ── Dashboard (derived from conversions — no separate fetch) ───
  dashboard: {
    /** `full` = GET /users + /health (org_admin); `health` = /health only (members). */
    org:  (mode = 'full') => ['dashboard', 'org', mode],
    orgPrefix: () => ['dashboard', 'org'],
    user: () => ['dashboard', 'user'],
  },

  // ── Org Team (members + activities) ───────────────────────────
  orgTeam: {
    all:        () => ['org-team'],
    members:    () => ['org-team', 'members'],
    activities: () => ['org-team', 'activities'],
  },

  // ── Usage / License ───────────────────────────────────────────
  usage: {
    license: () => ['usage', 'license'],
    plans:   () => ['usage', 'plans'],
  },

  // ── Media Assets ──────────────────────────────────────────────
  media: {
    all:  () => ['media'],
    list: (scope = 'org') => ['media', 'list', scope],
  },

  // ── Activity feed ─────────────────────────────────────────────
  activities: {
    all:  () => ['activities'],
    list: (scope = 'org') => ['activities', 'list', scope],
  },

  // ── Interactive books ───────────────────────────────────────────
  interactive: {
    all:  () => ['interactive'],
    list: (scope = 'org') => ['interactive', 'list', scope],
  },

  // ── Platform admin directory ───────────────────────────────────
  admin: {
    users: () => ['admin', 'users'],
  },
};
