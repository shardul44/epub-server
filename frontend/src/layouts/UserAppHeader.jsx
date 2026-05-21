import { LogOut } from 'lucide-react';
import HealthCheck from '../components/HealthCheck';
import useLogout from '../hooks/useLogout';
import './UserAppHeader.css';

/**
 * Top strip for regular users — backend status + logout (matches org/platform
 * shell: no duplicate product title in the main column).
 */
export default function UserAppHeader() {
  const onLogout = useLogout();

  return (
    <header className="uah" role="banner">
      <div className="uah-right">
        <HealthCheck />
        <button type="button" onClick={onLogout} className="navbar-logout-btn uah-logout">
          <LogOut className="navbar-logout-icon" size={18} strokeWidth={2} aria-hidden />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
