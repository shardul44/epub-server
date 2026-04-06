import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState({ open: false, message: '' });
  const toastTimerRef = useRef(null);
  const navigate = useNavigate();

  // Prevent timer leakage across remounts (doesn't affect navigation, just UI robustness).
  React.useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message) => {
    setToast({ open: true, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, open: false }));
    }, 3000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (!email || !password) {
        setError('Please enter email and password');
        return;
      }

      const response = await api.post('/auth/login', { email, password });
      const payload = response.data?.data ?? response.data;
      const token = payload?.token;

      if (!token) throw new Error('Login failed: missing token from server response.');

      localStorage.setItem('token', token);
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Login failed';
      setError(msg);

      // If password is incorrect, backend returns 401 with "Invalid email or password".
      // Trigger a toast for better UX.
      const status = err.response?.status;
      const lower = String(msg).toLowerCase();
      if (status === 401 || lower.includes('invalid email or password') || lower.includes('invalid')) {
        showToast('Invalid email or password. Please try again.');
      }
    }
  };

  return (
    <div className="login-container">
      {toast.open && <div className="auth-toast">{toast.message}</div>}
      <div className="login-card">
        <h2>Log in</h2>
        <p className="login-subtitle">Access your PDFs, conversions, and accessibility tools securely.</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="pw-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="pw-toggle-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="auth-actions">
            <button type="submit" className="auth-btn auth-btn-primary">
            Login
            </button>
          </div>
        </form>
        <div className="auth-footer">
          <span>Don't have an account?</span>
          <button type="button" className="auth-link-button" onClick={() => navigate('/register')}>
            Create one
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;











