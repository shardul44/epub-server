/**
 * useDashboardQuery — derives dashboard stats from the shared conversions cache.
 *
 * Does NOT make its own /conversions call. Reads from the same
 * ['conversions'] cache that every other component uses.
 * Only fetches /users and /health (once, cached 5 min).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useConversionsQuery } from './useConversionsQuery';
import api from '../../services/api';

/* ─── Throughput helpers ──────────────────────────────────────── */
const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildThroughput(completedArr) {
  const now  = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const countMap = {};
  days.forEach(d => { countMap[d.toDateString()] = 0; });
  completedArr.forEach(job => {
    const ts = job.completedAt || job.updatedAt || job.createdAt;
    if (!ts) return;
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const key = d.toDateString();
    if (key in countMap) countMap[key]++;
  });
  return days.map(d => ({
    day:     DAY_NAMES[d.getDay()],
    fullDay: `${FULL_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`,
    count:   countMap[d.toDateString()],
    date:    d.toISOString(),
  }));
}

function buildThroughputMeta(data) {
  const totalWeek = data.reduce((s, d) => s + d.count, 0);
  const peakEntry = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  const peakDay   = peakEntry?.count > 0 ? peakEntry.fullDay : '—';
  const first  = data.slice(0, 3).reduce((s, d) => s + d.count, 0);
  const second = data.slice(4).reduce((s, d) => s + d.count, 0);
  const trend  = first > 0 ? Math.round(((second - first) / first) * 100) : second > 0 ? 100 : 0;
  return { peakDay, trend, totalWeek };
}

/* ─── Team + health query (separate, cached 5 min) ───────────── */
async function fetchTeamAndHealth() {
  const [membersRes, healthRes] = await Promise.all([
    api.get('/users').catch(() => ({ data: { data: [] } })),
    api.get('/health').catch(() => ({ data: { status: 'ERROR' } })),
  ]);
  const members = Array.isArray(membersRes.data?.data)
    ? membersRes.data.data
    : Array.isArray(membersRes.data) ? membersRes.data : [];
  const hStatus = healthRes.data?.status;
  return {
    members,
    systemHealth: {
      api: hStatus === 'OK' || hStatus === 'SERVICE_UNAVAILABLE' ? 'healthy' : 'unhealthy',
      db:  hStatus === 'OK' ? 'healthy' : 'unhealthy',
    },
  };
}

export function useDashboardQuery({ enabled = true } = {}) {
  const queryClient = useQueryClient();

  // ── Read from the shared conversions cache (no extra fetch) ───
  const { allJobs, isLoading: jobsLoading, isFetching: jobsFetching } = useConversionsQuery({ enabled });

  // ── Fetch team + health separately (cached 5 min) ─────────────
  const teamQuery = useQuery({
    queryKey: queryKeys.dashboard.org(),
    queryFn:  fetchTeamAndHealth,
    enabled,
    staleTime:            5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
  });

  // ── Derive stats from the shared jobs list ─────────────────────
  const completedArr  = allJobs.filter(j => j.status === 'COMPLETED');
  const inProgressArr = allJobs.filter(j => j.status === 'IN_PROGRESS');
  const failedArr     = allJobs.filter(j => j.status === 'FAILED');

  const stats = {
    totalPdfs:        0,
    totalConversions: allJobs.length,
    inProgress:       inProgressArr.length,
    completed:        completedArr.length,
    failed:           failedArr.length,
  };

  const recentJobs = [...allJobs]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 5);

  const throughputData = buildThroughput(completedArr);
  const throughputMeta = buildThroughputMeta(throughputData);

  const teamData = {
    members:  teamQuery.data?.members  ?? [],
    seatUsed: teamQuery.data?.members?.length ?? 0,
  };
  const systemHealth = teamQuery.data?.systemHealth ?? { api: 'checking', db: 'checking' };

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversions.list() });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.org() });
  };

  return {
    stats,
    recentJobs,
    throughputData,
    throughputMeta,
    teamData,
    systemHealth,
    lastUpdated:  null,
    isLoading:    jobsLoading || teamQuery.isLoading,
    isFetching:   jobsFetching || teamQuery.isFetching,
    isRefreshing: (jobsFetching && !jobsLoading) || (teamQuery.isFetching && !teamQuery.isLoading),
    error:        teamQuery.error?.message ?? null,
    refetch,
  };
}
