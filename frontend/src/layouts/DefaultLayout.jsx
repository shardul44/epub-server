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
import { fetchAllJobs, CONVERSIONS_STALE_TIME_MS } from '../hooks/queries/useConversionsQuery';
import { pdfService } from '../services/pdfService';
import { listScopeQueryParams } from '../utils/listScope';
import { hasAnyFeature, hasFeature, WORKFLOW_LIBRARY_FEATURES } from '../utils/features';
import { useAppSelector } from '../store/hooks';
import { selectUser } from '../features/auth/authSlice';
import api from '../services/api';
import '../components/layout/Layout.css';
import './UserAppLayout.css';

const MEMBER_SCOPE = 'own';

export default function DefaultLayout() {
  const queryClient = useQueryClient();
  const user = useAppSelector(selectUser);

  useEffect(() => {
    if (!user) return;

    if (hasFeature(user, 'conversion.basic')) {
      const convKey = queryKeys.conversions.list(MEMBER_SCOPE);
      if (queryClient.getQueryData(convKey) == null) {
        void queryClient.prefetchQuery({
          queryKey: convKey,
          queryFn: () => fetchAllJobs(MEMBER_SCOPE),
          staleTime: CONVERSIONS_STALE_TIME_MS,
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
    }

    if (hasAnyFeature(user, WORKFLOW_LIBRARY_FEATURES)) {
      const mediaKey = queryKeys.media.list(MEMBER_SCOPE);
      if (queryClient.getQueryData(mediaKey) == null) {
        void queryClient.prefetchQuery({
          queryKey: mediaKey,
          queryFn: async () => {
            const res = await api.get('/media');
            const data = res.data?.data ?? res.data ?? [];
            return Array.isArray(data) ? data : [];
          },
          staleTime: 5 * 60 * 1000,
        });
      }
    }
  }, [queryClient, user]);

  return (
    <div className="layout layout--user app-ds">
      <UserAppSidebar />
      <main className="main-content main-content--user">
        <div className="user-app-scroll app-ds">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
