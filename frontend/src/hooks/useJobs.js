/**
 * useJobs — public alias for useJobPolling.
 *
 * Polls all conversion jobs (REFLOW + FXL) with smart polling:
 * - Polls every 5 s while active jobs exist.
 * - Stops automatically once all jobs reach a terminal state.
 * - Always cleans up on unmount.
 *
 * @param {string} [statusFilter='all'] — 'all' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
 * @returns {{ jobs, loading, error, refresh }}
 */
export { useJobPolling as useJobs } from './useJobPolling';
