/**
 * DefaultLayout — app shell for members (and other non-admin tenant users).
 *
 * Same workflow routes as org admin (`/pdfs/upload`, `/conversions`, …) but
 * `layout--user` + UserAppSidebar. List queries use scope `own`.
 */
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import UserAppSidebar from '../components/layout/UserAppSidebar';
import { queryKeys } from '../lib/queryKeys';
import { fetchAllJobs } from '../hooks/queries/useConversionsQuery';
import { pdfService } from '../services/pdfService';
import { listScopeQueryParams } from '../utils/listScope';
import '../components/layout/Layout.css';
import './UserAppLayout.css';

const MEMBER_SCOPE = 'own';

export default function DefaultLayout() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const convKey = queryKeys.conversions.list(MEMBER_SCOPE);
    if (queryClient.getQueryData(convKey) == null) {
      void queryClient.prefetchQuery({
        queryKey: convKey,
        queryFn: () => fetchAllJobs(MEMBER_SCOPE),
        staleTime: 20 * 1000,
      });
    }

    const pdfKey = queryKeys.pdfs.list(MEMBER_SCOPE);
    if (queryClient.getQueryData(pdfKey) == null) {
      void queryClient.prefetchQuery({
        queryKey: pdfKey,
        queryFn: async () => {
          const data = await pdfService.getAllPdfs(listScopeQueryParams(MEMBER_SCOPE));
          return data ?? [];
        },
        staleTime: 0,
      });
    }
  }, [queryClient]);

  return (
    <div className="layout layout--user">
      <UserAppSidebar />
      <main className="main-content main-content--user">
        <div className="user-app-scroll">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
