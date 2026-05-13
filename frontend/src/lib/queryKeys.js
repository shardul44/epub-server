/**
 * queryKeys.js — single source of truth for all React Query cache keys.
 *
 * RULE: conversion/job data always uses queryKeys.conversions.list()
 * (cache key `['conversions']`). This guarantees every consumer shares the same
 * cache entry and there is exactly ONE network request for job data at any point in time.
 */

export const queryKeys = {
  // ── App Bootstrap (bundled: media + license + activities + users + health) ──
  appBootstrap: () => ['app-bootstrap'],

  // ── Conversions (jobs) ─────────────────────────────────────────
  // All consumers MUST use conversions.list() as their queryKey.
  // Status filtering is done client-side — never via separate keys.
  conversions: {
    /** Job list cache — `all()` is the same key for broad invalidations. */
    all:    () => ['conversions'],
    list:   () => ['conversions'],
    detail: (jobId) => ['conversions', 'detail', jobId],
    status: (jobId) => ['conversion', jobId], // for useConversionStatus polling
  },

  // ── PDFs ───────────────────────────────────────────────────────
  pdfs: {
    all:     () => ['pdfs'],
    list:    () => ['pdfs', 'list'],
    grouped: () => ['pdfs', 'grouped'],
    detail:  (id) => ['pdfs', 'detail', id],
  },

  // ── Dashboard (derived from conversions — no separate fetch) ───
  dashboard: {
    org:  () => ['dashboard', 'org'],
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
    list: () => ['media', 'list'],
  },

  // ── Platform admin directory ───────────────────────────────────
  admin: {
    users: () => ['admin', 'users'],
  },
};
