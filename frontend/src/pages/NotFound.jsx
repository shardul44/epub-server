import { Link } from 'react-router-dom';
import { Home, LogIn, FileQuestion } from 'lucide-react';
import { useAppSelector } from '../store/hooks';
import { selectUser } from '../features/auth/authSlice';
import useLogout from '../hooks/useLogout';
import './NotFound.css';

/**
 * 404 fallback — used for unknown paths inside the app shell and at the top level.
 */
export default function NotFound() {
  const user = useAppSelector(selectUser);
  const onLogout = useLogout();

  return (
    <div className="not-found">
      <div className="not-found-icon" aria-hidden>
        <FileQuestion size={40} strokeWidth={1.75} />
      </div>
      <h1 className="not-found-title">Page not found</h1>
      <p className="not-found-message">
        The page you requested does not exist or may have been moved.
      </p>
      <div className="not-found-actions">
        {user ? (
          <Link to="/" className="not-found-btn not-found-btn--primary">
            <Home size={18} aria-hidden />
            Back to dashboard
          </Link>
        ) : (
          <Link to="/login" className="not-found-btn not-found-btn--primary">
            <LogIn size={18} aria-hidden />
            Go to login
          </Link>
        )}
        {user && (
          <button type="button" onClick={onLogout} className="not-found-btn not-found-btn--ghost">
            Switch account
          </button>
        )}
      </div>
    </div>
  );
}
