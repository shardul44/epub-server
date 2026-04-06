import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Login.css';

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const passwordStrength = useMemo(() => {
    const pwd = String(password || '');
    if (!pwd) return { label: '—', tier: 'weak', percent: 0, color: 'rgba(100,116,139,0.5)' };

    let s = 0;
    if (pwd.length >= 6) s += 1;
    if (pwd.length >= 10) s += 1;
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
    if (hasLetter) s += 1;
    if (hasNumber) s += 1;
    if (hasSpecial) s += 1;

    // Map score(0..5) -> tier
    if (s <= 2) return { label: 'Weak', tier: 'weak', percent: 25, color: '#ef4444' };
    if (s === 3) return { label: 'Fair', tier: 'fair', percent: 50, color: '#f59e0b' };
    if (s === 4) return { label: 'Good', tier: 'good', percent: 75, color: '#3b82f6' };
    return { label: 'Strong', tier: 'strong', percent: 100, color: '#16a34a' };
  }, [password]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (!name || name.trim().length < 2) {
        setError('Please enter your name');
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('Please enter a valid email');
        return;
      }
      if (!password || String(password).length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setError('Password must be at least 6 characters and include letters and numbers');
        return;
      }
      const phone = phoneNumber ? phoneNumber.trim() : '';
      if (phone && !/^[0-9]{10,15}$/.test(phone)) {
        setError('Phone number must be numeric and 10-15 digits');
        return;
      }

      const payload = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        ...(phoneNumber && phoneNumber.trim().length > 0 ? { phoneNumber: phoneNumber.trim() } : {})
      };

      const response = await api.post('/auth/register', payload);
      const data = response.data?.data ?? response.data;
      const token = data?.token;

      if (!token) throw new Error('Registration failed: missing token from server response.');

      localStorage.setItem('token', token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Registration failed');
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h2>Create your account</h2>
        <p className="login-subtitle">Register to unlock conversions, studio tools, and accessibility checks.</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" required />
          </div>
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
            <label>Phone (optional)</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="10-15 digits"
              inputMode="numeric"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="pw-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters, includes letters and numbers"
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
            {password ? (
              <div className="pw-meter" role="status" aria-live="polite">
                <div className="pw-meter-top">
                  <span className="pw-meter-label">Password strength</span>
                  <span className={`pw-meter-badge pw-meter-badge-${passwordStrength.tier}`}>
                    {passwordStrength.label}
                  </span>
                </div>
                <div className="pw-meter-bar">
                  <div
                    className="pw-meter-bar-fill"
                    style={{ width: `${passwordStrength.percent}%`, backgroundColor: passwordStrength.color }}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="auth-actions">
            <button type="submit" className="auth-btn auth-btn-primary">
              Create account
            </button>
          </div>
        </form>

        <div className="auth-footer">
          <span>Already have an account?</span>
          <button type="button" className="auth-link-button" onClick={() => navigate('/login')}>
            Log in
          </button>
        </div>
      </div>
    </div>
  );
};

export default Register;

