/**
 * OrgAdminLayout — premium sidebar layout for org_admin role.
 *
 * Replaces the org-admin branch of the old monolithic Layout.jsx.
 *
 * Key changes vs. the old version:
 *   - sidebarCollapsed lives in Redux (uiSlice), not local useState — so
 *     it's stable across remounts and any other component can read/toggle it.
 *   - Sidebar badges come from useSidebarBadges() which reads the React
 *     Query cache reactively. No more local-state mirrors that can drift.
 *   - Uses the existing OrgAdminSidebar component as-is (it owns its own
 *     internal layout & feature-flag rendering).
 */
import { useCallback, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import OrgAdminSidebar from '../components/layout/OrgAdminSidebar';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectSidebarCollapsed, setSidebarCollapsed } from '../slices/uiSlice';
import { useSidebarBadges } from '../hooks/useSidebarBadges';
import { queryKeys } from '../lib/queryKeys';
import { fetchAllJobs } from '../hooks/queries/useConversionsQuery';
import { pdfService } from '../services/pdfService';
import '../components/layout/Layout.css';

export default function OrgAdminLayout() {
  const dispatch      = useAppDispatch();
  const queryClient   = useQueryClient();
  const collapsed     = useAppSelector(selectSidebarCollapsed);
  const { pdfCount, conversionCount } = useSidebarBadges();

  // Warm the same React Query keys the sidebar reads so badge counts are
  // correct on first paint (no need to visit Conversion Jobs / PDFs first).
  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.conversions.list(),
      queryFn:  fetchAllJobs,
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.pdfs.list(),
      queryFn:  async () => {
        const data = await pdfService.getAllPdfs({});
        return data ?? [];
      },
    });
  }, [queryClient]);

  const handleSidebarCollapse = useCallback(
    (next) => dispatch(setSidebarCollapsed(next)),
    [dispatch],
  );

  return (
    <div className={`layout layout--org-admin${collapsed ? ' layout--sb-collapsed' : ''}`}>
      <OrgAdminSidebar
        onCollapse={handleSidebarCollapse}
        pdfCount={pdfCount}
        conversionCount={conversionCount}
      />
      <main className="main-content main-content--org-admin">
        <Outlet />
      </main>
    </div>
  );
}
