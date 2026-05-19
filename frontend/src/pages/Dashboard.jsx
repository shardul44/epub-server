import { useAuth } from '../context/AuthContext';
import { useListScope } from '../context/ListScopeContext';
import { useConversionsQuery } from '../hooks/queries/useConversionsQuery';
import { hasFeature } from '../utils/features';
import OrgDashboard from './org/OrgDashboard';
import AdminDashboard from './admin/AdminDashboard';
import UserDashboard from './user/UserDashboard';

/**
 * Route `/` — role-specific home: org admin, platform admin, or member dashboard.
 * Members warm the `own`-scoped conversions cache; org admin uses org-wide scope.
 */
const Dashboard = () => {
  const { user } = useAuth();
  const listScope = useListScope();
  const isOrgOrPlatform = user?.role === 'org_admin' || user?.role === 'platform_admin';

  useConversionsQuery({
    enabled: !isOrgOrPlatform && !!user && hasFeature(user, 'conversion.basic'),
    scope: listScope,
  });

  if (user?.role === 'org_admin') {
    return <OrgDashboard />;
  }
  if (user?.role === 'platform_admin') {
    return <AdminDashboard />;
  }
  return <UserDashboard />;
};

export default Dashboard;
