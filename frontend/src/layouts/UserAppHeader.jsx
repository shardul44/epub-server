import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import HealthCheck from '../components/HealthCheck';
import { useAppDispatch } from '../store/hooks';
import { logout } from '../features/auth/authSlice';
import './UserAppHeader.css';

/**
 * Top strip for regular users — backend status + logout (matches org/platform
 * shell: no duplicate product title in the main column).
 */
export default function UserAppHeader() {
  const navigate = useNavigate();
  const appDispatch = useAppDispatch();

  const handleLogout = () => {
    appDispatch(logout());
    navigate('/login', { replace: true });
  };

  return (
    <header className="uah" role="banner">
      <div className="uah-right">
        <HealthCheck />
        <button type="button" onClick={handleLogout} className="navbar-logout-btn uah-logout">
          <LogOut className="navbar-logout-icon" size={18} strokeWidth={2} aria-hidden />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
