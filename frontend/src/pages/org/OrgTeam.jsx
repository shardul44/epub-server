import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { orgTeamService } from '../../services/orgTeamService';
import '../Login.css';

export default function OrgTeam() {
  const { user, refreshUser } = useAuth();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [role, setRole] = useState('member');

  const load = async () => {
    if (!user?.organizationId) return;
    setError('');
    try {
      const res = await api.get('/users');
      setMembers(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.organizationId]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await orgTeamService.createUser({
        name,
        email,
        password,
        phoneNumber: phoneNumber || undefined,
        role: role === 'org_admin' ? 'org_admin' : 'member'
      });
      setName('');
      setEmail('');
      setPassword('');
      setPhoneNumber('');
      setRole('member');
      await load();
      await refreshUser();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this user?')) return;
    setError('');
    try {
      await orgTeamService.deleteUser(id);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 720, padding: '24px' }}>
      <h1 style={{ marginBottom: 8 }}>Team</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Add users in your organization.</p>
      {error && <div className="auth-error">{error}</div>}

      <form onSubmit={create} style={{ marginBottom: 32, padding: 16, border: '1px solid #e0e0e0', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Invite user</h3>
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Phone (optional)</label>
          <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="org_admin">Org admin</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          Create user
        </button>
      </form>

      <h3>Members</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: 8 }}>Name</th>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Role</th>
            <th style={{ padding: 8 }} />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{m.name}</td>
              <td style={{ padding: 8 }}>{m.email}</td>
              <td style={{ padding: 8 }}>{m.role}</td>
              <td style={{ padding: 8 }}>
                {m.id !== user?.id && (
                  <button type="button" className="btn btn-secondary" onClick={() => remove(m.id)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
