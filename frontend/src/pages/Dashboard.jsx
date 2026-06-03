import { useAuth } from '../context/AuthContext';
import OrgDashboard from './org/OrgDashboard';
import AdminDashboard from './admin/AdminDashboard';
import UserDashboard from './user/UserDashboard';

/**
 * Route `/` — role-specific home: org admin, platform admin, or member dashboard.
 * Job list cache is warmed by ConversionsJobsPoller in RootLayout.
 */
const Dashboard = () => {
  const { user } = useAuth();

  if (user?.role === 'org_admin') {
    return <OrgDashboard />;
  }
  if (user?.role === 'platform_admin') {
    return <AdminDashboard />;
  }
  return <UserDashboard />;
};

export default Dashboard;
