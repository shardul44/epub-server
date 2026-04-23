import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Login.css';

export default function Activity() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      setLoading(true);
      try {
        const res = await api.get('/activities', { params: { limit: 200 } });
        const data = res.data?.data ?? res.data;
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message || 'Failed to load activity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const title =
    user?.role === 'platform_admin'
      ? 'Activity (all organizations)'
      : user?.role === 'org_admin'
        ? 'Activity (your organization)'
        : 'Your activity';

  if (loading) {
    return <div className="container" style={{ padding: 24 }}>Loading…</div>;
  }

  return (
    <div className="container" style={{ maxWidth: 960, padding: '24px' }}>
      <h1 style={{ marginBottom: 8 }}>{title}</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        {user?.role === 'member'
          ? 'Actions you performed in this application.'
          : user?.role === 'org_admin'
            ? 'Actions by users in your organization.'
            : 'Actions across tenants (platform administrator view).'}
      </p>
      {error && <div className="auth-error">{error}</div>}
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: 8 }}>When</th>
            <th style={{ padding: 8 }}>Action</th>
            <th style={{ padding: 8 }}>Summary</th>
            {user?.role !== 'member' && <th style={{ padding: 8 }}>User</th>}
            {user?.role === 'platform_admin' && <th style={{ padding: 8 }}>Organization</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
              </td>
              <td style={{ padding: 8 }}>{r.action}</td>
              <td style={{ padding: 8 }}>{r.summary || '—'}</td>
              {user?.role !== 'member' && (
                <td style={{ padding: 8 }}>{r.actorEmail || r.actorName || r.userId || '—'}</td>
              )}
              {user?.role === 'platform_admin' && (
                <td style={{ padding: 8 }}>{r.organizationName || r.organizationId || '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !error && <p style={{ color: '#666', marginTop: 16 }}>No activity yet.</p>}
    </div>
  );
}
